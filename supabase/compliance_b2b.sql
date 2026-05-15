-- ============================================================
-- compliance_b2b.sql — multi-tenant ALyC foundation (samas-0.4.93)
-- ============================================================
-- Cohen meeting (2026-05-15) — pivot/expand SAMAS into a B2B
-- platform for ALyCs (Agentes de Liquidación y Compensación).
-- This migration is ADDITIVE — it does not touch any existing
-- retail tables. New surfaces (productor view, compliance docs)
-- use these tables; retail users continue working unchanged.
--
-- Hierarchy:
--   orgs (ALyCs)
--     └─ productores (broker agents, FK to auth.users)
--          └─ clientes (end clients, by CUIT)
--               └─ cuentas (brokerage accounts)
--
-- compliance_documents stores each parse-contract run for productor
-- history + audit trail.
--
-- Run order: paste in Supabase SQL editor and Run.
-- ============================================================

-- ----- orgs (ALyCs) -----------------------------------------------------------
create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  cuit        text unique,
  alyc_number text,                    -- CNV registry number
  brand_color text default '#5b8def',  -- white-label theming
  logo_url    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Seed Cohen + SAMAS-host org (idempotent).
insert into public.orgs (name, cuit, alyc_number) values
  ('Cohen S.A.', null, null),
  ('SAMAS (host)', null, null)
on conflict do nothing;

-- ----- productores ------------------------------------------------------------
-- A productor is a broker agent. One auth.users row → at most one productor
-- (a single person operating under exactly one ALyC). Future iterations can
-- relax this if we hire someone who works for multiple ALyCs.
create table if not exists public.productores (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  org_id        uuid not null references public.orgs(id) on delete restrict,
  display_name  text not null,
  role          text not null default 'productor'
                check (role in ('productor', 'back_office', 'admin')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_productores_org_id on public.productores(org_id);

-- ----- clientes ---------------------------------------------------------------
-- End-clients of the productor. CUIT is the natural key per Argentine
-- regulation. A cliente belongs to exactly one productor in this V1; later
-- we may add a productor_clientes junction if reassignment is needed.
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  productor_id   uuid not null references public.productores(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete restrict,
  cuit           text not null,
  display_name   text not null,
  email          text,
  phone          text,
  kyc_status     text not null default 'pending'
                 check (kyc_status in ('pending', 'in_review', 'approved', 'rejected')),
  notes          text,
  created_at     timestamptz not null default now(),
  unique (productor_id, cuit)
);
create index if not exists idx_clientes_productor_id on public.clientes(productor_id);
create index if not exists idx_clientes_org_id on public.clientes(org_id);
create index if not exists idx_clientes_cuit on public.clientes(cuit);

-- ----- cuentas (brokerage accounts) ------------------------------------------
-- A cliente can have multiple cuentas (e.g. cuenta comitente USD + ARS).
create table if not exists public.cuentas (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  org_id       uuid not null references public.orgs(id) on delete restrict,
  numero       text not null,            -- número de cuenta comitente
  currency     text not null default 'ARS' check (currency in ('ARS', 'USD', 'EUR')),
  status       text not null default 'active'
               check (status in ('active', 'suspended', 'closed')),
  opened_at    date,
  created_at   timestamptz not null default now(),
  unique (cliente_id, numero, currency)
);
create index if not exists idx_cuentas_cliente_id on public.cuentas(cliente_id);

-- ----- compliance_documents --------------------------------------------------
-- Per-productor history of parsed contracts. user_id is the productor's
-- auth.users.id (matches existing app conventions). cliente_id is optional
-- — productores can parse a generic contract before associating it with
-- a specific cliente.
create table if not exists public.compliance_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  cliente_id    uuid references public.clientes(id) on delete set null,
  kind          text not null default 'otro',
  source_text   text,                -- truncated to 8k chars in the Edge Function
  parsed        jsonb not null,      -- full ParsedContract shape
  flag_count    int not null default 0,
  max_severity  text not null default 'none'
                check (max_severity in ('none', 'low', 'medium', 'high')),
  created_at    timestamptz not null default now()
);
create index if not exists idx_compliance_documents_user_id_created
  on public.compliance_documents(user_id, created_at desc);
create index if not exists idx_compliance_documents_cliente_id
  on public.compliance_documents(cliente_id);

-- ============================================================
-- RLS — strict per-productor isolation, with back_office seeing
-- the whole org's clientes/cuentas, and admin seeing everything.
-- ============================================================

alter table public.orgs                  enable row level security;
alter table public.productores           enable row level security;
alter table public.clientes              enable row level security;
alter table public.cuentas               enable row level security;
alter table public.compliance_documents  enable row level security;

-- orgs: any authenticated user can see active orgs (needed so
-- productores can pick their ALyC on signup). admin / back_office
-- members of the org can update brand_color + logo_url for
-- white-label branding (samas-0.4.95).
drop policy if exists "orgs_select_active" on public.orgs;
create policy "orgs_select_active" on public.orgs
  for select using (active = true);

drop policy if exists "orgs_update_branding_by_org_admin" on public.orgs;
create policy "orgs_update_branding_by_org_admin" on public.orgs
  for update using (
    exists (
      select 1 from public.productores p
      where p.user_id = auth.uid()
        and p.org_id = orgs.id
        and p.role in ('admin', 'back_office')
        and p.active = true
    )
  );

-- productores: a user sees their own productor row. back_office /
-- admin within the same org also see siblings.
drop policy if exists "productores_select_self_or_org_staff" on public.productores;
create policy "productores_select_self_or_org_staff" on public.productores
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.productores p
      where p.user_id = auth.uid()
        and p.org_id = productores.org_id
        and p.role in ('back_office', 'admin')
    )
  );

-- clientes: productor sees own; back_office sees org-wide; admin sees all.
drop policy if exists "clientes_select_scoped" on public.clientes;
create policy "clientes_select_scoped" on public.clientes
  for select using (
    exists (
      select 1 from public.productores p
      where p.user_id = auth.uid()
        and (
          p.id = clientes.productor_id
          or (p.org_id = clientes.org_id and p.role in ('back_office', 'admin'))
        )
    )
  );

-- clientes: productor can insert their own clientes.
drop policy if exists "clientes_insert_own" on public.clientes;
create policy "clientes_insert_own" on public.clientes
  for insert with check (
    exists (
      select 1 from public.productores p
      where p.user_id = auth.uid()
        and p.id = clientes.productor_id
        and p.org_id = clientes.org_id
        and p.active = true
    )
  );

-- clientes: productor can update their own; back_office org-wide.
drop policy if exists "clientes_update_scoped" on public.clientes;
create policy "clientes_update_scoped" on public.clientes
  for update using (
    exists (
      select 1 from public.productores p
      where p.user_id = auth.uid()
        and (
          p.id = clientes.productor_id
          or (p.org_id = clientes.org_id and p.role in ('back_office', 'admin'))
        )
    )
  );

-- cuentas: same scoping as clientes (walk through clientes).
drop policy if exists "cuentas_select_scoped" on public.cuentas;
create policy "cuentas_select_scoped" on public.cuentas
  for select using (
    exists (
      select 1
      from public.clientes c
      join public.productores p on p.id = c.productor_id
      where c.id = cuentas.cliente_id
        and (
          p.user_id = auth.uid()
          or exists (
            select 1 from public.productores px
            where px.user_id = auth.uid()
              and px.org_id = c.org_id
              and px.role in ('back_office', 'admin')
          )
        )
    )
  );

-- compliance_documents: the productor who parsed it sees it; back_office
-- sees the whole org via cliente_id; admin sees all.
drop policy if exists "compliance_documents_select_scoped" on public.compliance_documents;
create policy "compliance_documents_select_scoped" on public.compliance_documents
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.productores p
      where p.user_id = auth.uid()
        and p.role in ('back_office', 'admin')
        and (
          compliance_documents.cliente_id is null
          or exists (
            select 1 from public.clientes c
            where c.id = compliance_documents.cliente_id and c.org_id = p.org_id
          )
        )
    )
  );

-- compliance_documents: productores can insert their own (Edge Function
-- uses service_role anyway, but this allows direct inserts from app code).
drop policy if exists "compliance_documents_insert_own" on public.compliance_documents;
create policy "compliance_documents_insert_own" on public.compliance_documents
  for insert with check (user_id = auth.uid());

-- ============================================================
-- Helper: is the caller a productor? Convenience for UI gating.
-- ============================================================
create or replace function public.is_productor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.productores p
    where p.user_id = auth.uid() and p.active = true
  );
$$;

grant execute on function public.is_productor() to authenticated;
