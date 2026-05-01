// ============================================================
// seed-social-demo — investor-pitch social network seed
// ============================================================
// The Social tab would otherwise be empty during the Cohen pitch.
// This Edge Function bulk-creates a curated cast of 12 AR-flavored
// fake users, gives each of them a handful of posts (text, $TICKER
// calls, and trade cards), threads them with replies, builds a
// realistic follower mesh that includes the caller, sprinkles likes
// and reposts so Trending has ranked content, and drops a few DMs
// into the caller's inbox.
//
// Why an Edge Function and not the client:
//   Every social table FKs author_id → auth.users(id), and every RLS
//   insert policy clamps `auth.uid() = author_id`. The caller can't
//   create posts AS @lucia.invierte from the client. The service-role
//   key bypasses RLS, and the admin auth API (`auth.admin.createUser`)
//   is the only way to mint the underlying auth.users rows in the
//   first place.
//
// IDEMPOTENCY
//   - Each seed user has a stable handle (e.g. @luciainvierte) and
//     a stable email (seed-luciainvierte@samas-demo.local). Before
//     creating, we look up profiles_social.handle. If it exists we
//     reuse the user_id; otherwise we mint a new auth user + profile.
//   - Posts are only inserted when the seed user has zero posts.
//     Replies, likes, reposts, follows, and DMs all use composite-PK
//     or unique-pair guards so re-running is a no-op rather than a
//     duplicate-data hazard.
//
// HOW TO DEPLOY
//   Mac Terminal (in your samas-cli folder):
//     supabase functions deploy seed-social-demo
//   The function uses SUPABASE_SERVICE_ROLE_KEY which is auto-injected
//   by the Supabase platform — no extra secret needed.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, rateLimit429,
} from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ----------------------------------------------------------
// Cast — 12 AR-flavored seed users
// ----------------------------------------------------------
// Handles, display names, bios, and avatar palette pinned so the
// demo looks the same every run. Bios skew toward the investor-
// pitch crowd: students, retail traders, fixed-income, crypto,
// macro, fintech advisors. A few claim a university but with
// gmail-style demo emails — so the profiles_social BEFORE INSERT
// trigger leaves university_verified false. We do NOT want to
// hand out university badges to fake users.

type SeedUser = {
  handle: string;          // without leading @ in the DB
  displayName: string;
  bio: string;
  avatarColor: string;
};

const SEED_USERS: SeedUser[] = [
  { handle: "luciainvierte",  displayName: "Lucía Pérez",         bio: "Estudiante UBA · Cartera diversificada con CEDEARs y bonos. DCA mensual.",  avatarColor: "#16C784" },
  { handle: "juan.merval",    displayName: "Juan Lopresti",       bio: "Trader retail · Long-only acciones argentinas. Sin apalancamiento.",          avatarColor: "#F59E0B" },
  { handle: "marti.bonos",    displayName: "Martina Aguilar",     bio: "Renta fija · GD30 / AL30 / Bopreal. Dolarización defensiva.",                avatarColor: "#3B82F6" },
  { handle: "santi.cripto",   displayName: "Santiago Rodríguez",  bio: "BTC maxi · DCA semanal. Cold storage. Nada de shitcoins.",                   avatarColor: "#EC4899" },
  { handle: "fede.cedear",    displayName: "Federico Acuña",      bio: "CEDEARs > acciones AR. Dolarizo cartera vía AAPL / MSFT / SPY.",             avatarColor: "#8B5CF6" },
  { handle: "paula.fintech",  displayName: "Paula Vázquez",       bio: "Asesora financiera · Educación a clientes minoristas. CNV en proceso.",     avatarColor: "#06B6D4" },
  { handle: "diego.dolar",    displayName: "Diego Ortega",        bio: "Macro AR · Dólar, tasa, brecha. Sin recomendaciones, solo data.",            avatarColor: "#EF4444" },
  { handle: "camila.utdt",    displayName: "Camila Quiroga",      bio: "Lic. Economía UTDT · Mercados emergentes. Research en progreso.",            avatarColor: "#10B981" },
  { handle: "nico.yields",    displayName: "Nicolás Cabrera",     bio: "Cazador de yields · LECAPs, FCI money market, plazos fijos UVA.",            avatarColor: "#F97316" },
  { handle: "sofi.etf",       displayName: "Sofía Martín",        bio: "Pasiva 100% · ETFs globales y rebalanceo trimestral. Sin trading.",          avatarColor: "#A855F7" },
  { handle: "maxi.options",   displayName: "Maximiliano Heredia", bio: "Derivados US · Spreads y covered calls sobre CEDEARs.",                      avatarColor: "#22C55E" },
  { handle: "valen.research", displayName: "Valentina López",     bio: "Equity research · Coverage YPF / GGAL / PAMP. Side project.",                avatarColor: "#0EA5E9" },
];

// Stable email pattern — lets us look the user up by listing or by
// re-reading profiles_social.handle. We never log in as these.
function emailFor(u: SeedUser) { return `seed-${u.handle.replace(/\./g, "-")}@samas-demo.local`; }

// ----------------------------------------------------------
// Posts — 2 to 4 per seed user. Mix of text, $TICKER calls, and
// trade cards. Spanish, conversational, AR-flavored.
// ----------------------------------------------------------
type SeedPost = {
  body: string;
  ticker?: string;                                         // top-level filter axis
  trade?: { side: "buy" | "sell"; ticker: string; qty: number; price: number };
};

const POSTS_BY_HANDLE: Record<string, SeedPost[]> = {
  "luciainvierte": [
    { body: "Sumé GGAL después de la baja de hoy. El piso de los 7800 me parece sólido para el contexto.", ticker: "GGAL",
      trade: { side: "buy", ticker: "GGAL", qty: 100, price: 7820 } },
    { body: "Tip a estudiantes: empezá con 10 mil pesos al mes en un FCI money market. La constancia te hace la cartera, no el timing." },
    { body: "Comparto mi distribución actual: 40% CEDEARs · 25% acciones AR · 20% bonos en USD · 15% cash. ¿Qué cambiarían?" },
  ],
  "juan.merval": [
    { body: "$YPF cotizando con volumen raro en after hours. Alguien siguiendo el flujo?", ticker: "YPF" },
    { body: "Cerré la posición en ALUA con un 18% arriba del promedio. La tendencia se cansó.", ticker: "ALUA",
      trade: { side: "sell", ticker: "ALUA", qty: 800, price: 1860 } },
    { body: "Recordatorio: el spread del MERVAL en pre-market no refleja nada útil. Esperá la apertura real." },
    { body: "Me sumo a YPF acá. La curva de bonos está pidiendo esto.", ticker: "YPF",
      trade: { side: "buy", ticker: "YPF", qty: 50, price: 38500 } },
  ],
  "marti.bonos": [
    { body: "$AL30 rindiendo 18.5% en USD a estos precios. Para perfil conservador con horizonte 3+ años, difícil pedir más.", ticker: "AL30" },
    { body: "Bopreal serie 1 vs GD30: prefiero el primero por la tasa fija y el calendario de pagos más cercano." },
    { body: "Dolarización defensiva: 60% bonos hard-dollar AR · 30% CEDEARs · 10% cash dólar MEP. Aburrido y funciona." },
  ],
  "santi.cripto": [
    { body: "BTC en 95k usd. DCA semanal sigue. No miro precios, miro reloj.", ticker: "BTC",
      trade: { side: "buy", ticker: "BTC", qty: 0.02, price: 95200 } },
    { body: "Recordatorio anual: si tu seed phrase está en una nota de Apple, no es tuya tu cripto." },
    { body: "Hardware wallet + multisig. Es plata, tratala como plata." },
    { body: "Compré más BTC en este dip. Same plan, same conviction.", ticker: "BTC",
      trade: { side: "buy", ticker: "BTC", qty: 0.015, price: 92800 } },
  ],
  "fede.cedear": [
    { body: "$NVDA sigue siendo la única acción que me deja dormir tranquilo. Earnings la semana que viene.", ticker: "NVDA" },
    { body: "Comparativa rápida: AAPL CEDEAR vs comprar AAPL en USD. Para minoristas argentinos, casi siempre el CEDEAR gana.", ticker: "AAPL" },
    { body: "Subí MSFT.", ticker: "MSFT",
      trade: { side: "buy", ticker: "MSFT", qty: 30, price: 47200 } },
  ],
  "paula.fintech": [
    { body: "Charla con clientes nuevos: el primer trimestre solo configuramos cartera modelo y aporte automático. Cero trading. Después vemos." },
    { body: "Educación financiera para minoristas en Argentina sigue siendo el mayor cuello de botella del sector. Por eso construyo." },
    { body: "Pregunta para la timeline: ¿cuál fue el primer libro de finanzas que les voló la cabeza?" },
  ],
  "diego.dolar": [
    { body: "Brecha en 28%. La autoridad monetaria sigue defendiendo el crawl, pero el carry trade está empezando a aflojar." },
    { body: "Curva de tasa fija mostrando lo que el discurso oficial todavía no admite: expectativas de inflación pegadas." },
    { body: "Sin recomendaciones, solo data: dólar MEP +1.2% semana, blue +0.8%, oficial +1.0%. Convergencia lenta." },
    { body: "Hilo corto sobre el bopreal serie 4 mañana. Spoiler: la TIR está rara." },
  ],
  "camila.utdt": [
    { body: "Working paper de Di Tella sobre el efecto de los CEDEARs en el ahorro minorista AR — me sorprendió la magnitud del flujo desde 2020." },
    { body: "Para los que hacen tesis: la base del BCRA tiene series limpias desde 2003 si filtran bien. Mejor que muchas privadas." },
    { body: "Charla mañana en UTDT con un PM de un fondo emergentes. Si están en CABA, entrada libre." },
  ],
  "nico.yields": [
    { body: "$LECAP nueva licitación esta semana. Spoiler: a estas tasas los plazos fijos UVA empiezan a perder atractivo.", ticker: "LECAP" },
    { body: "Money market FCI rindiendo 38% TNA en pesos. Para liquidez de corto, todavía es la mejor caja del mercado." },
    { body: "Nota mental: revisar duration de cartera de bonos cuando entre la curva nueva." },
  ],
  "sofi.etf": [
    { body: "Trimestre cerrado, rebalanceo hecho. 5 minutos. Eso es. Volveremos en 3 meses." },
    { body: "El mejor portafolio es el que podés mantener cuando hay drawdown. Repetir hasta convencerse." },
    { body: "$SPY + un poco de ex-US es todo lo que necesita el 95% de los retail. Lo demás es ruido para alimentar comisiones.", ticker: "SPY" },
    { body: "Sumando al core como cada mes.", ticker: "SPY",
      trade: { side: "buy", ticker: "SPY", qty: 10, price: 6420 } },
  ],
  "maxi.options": [
    { body: "Covered call sobre AAPL strike 240 vencimiento mensual. Premium decente para una posición que ya pensaba mantener.", ticker: "AAPL" },
    { body: "Recordatorio: vender opciones desnudas sobre acciones AR no es estrategia, es regalar plata al market maker." },
    { body: "Iron condor sobre SPY ancho 30 puntos. Si la vol implícita sigue así, semana tranquila.", ticker: "SPY" },
  ],
  "valen.research": [
    { body: "Update de coverage: subí mi precio objetivo de YPF post resultados. Vaca Muerta sigue sorprendiendo del lado bueno.", ticker: "YPF" },
    { body: "GGAL sigue siendo mi top pick del sector financiero AR. Múltiplos descontados, ROE recuperándose.", ticker: "GGAL" },
    { body: "Modelo DCF de PAMP actualizado. Mando el Excel a quien me lo pida por DM.", ticker: "PAMP" },
  ],
};

// ----------------------------------------------------------
// Replies — keyed by the post's body prefix (first 40 chars)
// so we can match without depending on uuids that don't exist
// at code-write time. Each entry is [responder_handle, body].
// ----------------------------------------------------------
const REPLIES_BY_POST_PREFIX: Record<string, Array<[string, string]>> = {
  "Sumé GGAL después de la baja de hoy.": [
    ["juan.merval", "Mismo, pero ojo con el carry. Si tasa sube otra vez la deja sin aire."],
    ["valen.research", "Mi precio objetivo a 12 meses es 9200. Coincido con el piso."],
  ],
  "$YPF cotizando con volumen raro": [
    ["valen.research", "Probablemente reposicionamiento institucional pre-resultados. Lo cubro mañana."],
    ["fede.cedear", "Acá lo mismo. Spread asiático rarísimo."],
  ],
  "BTC en 95k usd. DCA semanal sigue.": [
    ["paula.fintech", "Esto. La gente quema más plata mirando el gráfico que en comisiones."],
    ["sofi.etf", "Mismo principio que con índices. Reloj > timing."],
  ],
  "$NVDA sigue siendo la única acción": [
    ["maxi.options", "Si comprás antes de earnings, considerá un collar. La vol implícita está al 78%."],
    ["camila.utdt", "Pregunta de tesis: ¿cómo modelan el guidance de capex en sus targets?"],
  ],
  "Charla con clientes nuevos:": [
    ["sofi.etf", "Esto es exactamente lo que hace falta más. Aporte automático antes que análisis."],
    ["luciainvierte", "Perfecto para mandar a amigos que recién empiezan."],
  ],
  "Brecha en 28%.": [
    ["nico.yields", "Carry desde junio bajó del 4% mensual al 1.8%. Ya nadie lo arma con convicción."],
    ["marti.bonos", "Por eso me corro a hard-dollar. La fiesta del peso se está terminando."],
  ],
  "Trimestre cerrado, rebalanceo hecho.": [
    ["paula.fintech", "Esto le cuento a todos los clientes nuevos. Aburrido y eficaz."],
    ["fede.cedear", "Coincido. Los míos son anuales para reducir aún más impacto fiscal."],
  ],
  "Update de coverage: subí mi precio": [
    ["juan.merval", "Excelente, gracias por el update. ¿Vaca Muerta lo metiste full o discount?"],
    ["valen.research", "Discount del 15%. El break-even en USD bajó al doble dígito por barril."],
  ],
};

// ----------------------------------------------------------
// Follow mesh — caller_follows is who Manuel ends up following.
// inter_follows is a list of [follower, following] pairs among
// the seed users themselves to make the graph feel real.
// ----------------------------------------------------------
const CALLER_FOLLOWS = [
  "luciainvierte", "juan.merval", "marti.bonos", "fede.cedear",
  "diego.dolar", "valen.research",
];

const INTER_FOLLOWS: Array<[string, string]> = [
  ["luciainvierte", "paula.fintech"],
  ["luciainvierte", "sofi.etf"],
  ["luciainvierte", "fede.cedear"],
  ["juan.merval", "valen.research"],
  ["juan.merval", "diego.dolar"],
  ["juan.merval", "marti.bonos"],
  ["marti.bonos", "diego.dolar"],
  ["marti.bonos", "nico.yields"],
  ["santi.cripto", "diego.dolar"],
  ["santi.cripto", "fede.cedear"],
  ["fede.cedear", "valen.research"],
  ["fede.cedear", "maxi.options"],
  ["paula.fintech", "luciainvierte"],
  ["paula.fintech", "sofi.etf"],
  ["paula.fintech", "camila.utdt"],
  ["diego.dolar", "camila.utdt"],
  ["diego.dolar", "valen.research"],
  ["camila.utdt", "valen.research"],
  ["camila.utdt", "diego.dolar"],
  ["nico.yields", "marti.bonos"],
  ["sofi.etf", "fede.cedear"],
  ["maxi.options", "fede.cedear"],
  ["maxi.options", "valen.research"],
  ["valen.research", "juan.merval"],
  ["valen.research", "diego.dolar"],
];

// Likes / reposts — handle prefix → list of voters. We only
// pick a handful of posts so Trending has clear winners.
const LIKES_BY_POST_PREFIX: Record<string, string[]> = {
  "Sumé GGAL después de la baja": ["juan.merval", "valen.research", "fede.cedear", "paula.fintech", "diego.dolar"],
  "BTC en 95k usd. DCA semanal sigue.": ["paula.fintech", "sofi.etf", "fede.cedear", "luciainvierte"],
  "$NVDA sigue siendo la única acción": ["maxi.options", "camila.utdt", "juan.merval", "valen.research", "sofi.etf", "luciainvierte"],
  "Trimestre cerrado, rebalanceo hecho.": ["paula.fintech", "fede.cedear", "luciainvierte", "diego.dolar"],
  "Update de coverage: subí mi precio": ["juan.merval", "fede.cedear", "marti.bonos", "diego.dolar", "camila.utdt"],
};

const REPOSTS_BY_POST_PREFIX: Record<string, string[]> = {
  "$NVDA sigue siendo la única acción": ["maxi.options", "luciainvierte"],
  "Trimestre cerrado, rebalanceo hecho.": ["paula.fintech"],
  "Update de coverage: subí mi precio": ["juan.merval", "fede.cedear"],
};

// Inbound follows — seeded users who follow the CALLER (not the
// other direction). 0.0.51 only built outbound (caller → seeded)
// + inter-seed follows, which left the caller with 0 followers
// and 0 social_follow notifications. Adding these makes the bell
// badge light up post-seed and gives the caller's profile a
// realistic follower count for the Cohen demo.
const FOLLOWERS_OF_CALLER = [
  "luciainvierte", "juan.merval", "marti.bonos", "fede.cedear",
  "paula.fintech", "diego.dolar", "valen.research", "camila.utdt",
];

// Seeded users who like the caller's posts (the post the caller
// has authored, if any). Same rationale as FOLLOWERS_OF_CALLER —
// without these, no social_like notifications hit the caller's
// bell. Skips silently if the caller has no posts yet.
const LIKERS_OF_CALLER_POSTS = [
  "luciainvierte", "juan.merval", "paula.fintech",
  "valen.research", "santi.cripto", "sofi.etf",
];

// DMs to the caller from a few seeded users — keeps the Mensajes
// tab from being a ghost town.
const DMS_TO_CALLER: Array<{ from: string; messages: string[] }> = [
  {
    from: "luciainvierte",
    messages: [
      "Hola! Vi que también estás armando cartera. ¿Tenés un momento para ver tu distribución?",
      "Me sirve para un post que estoy escribiendo sobre carteras de estudiantes.",
    ],
  },
  {
    from: "paula.fintech",
    messages: [
      "Buenas! Te dejo el material de educación financiera del que hablamos. ¿Te paso un resumen o el deck completo?",
    ],
  },
  {
    from: "diego.dolar",
    messages: [
      "Che, ¿viste el dato de reservas de hoy? Necesito tu lectura macro antes de publicar el hilo.",
      "Sin apuro, cuando puedas.",
    ],
  },
];

// ============================================================
// Helpers — every DB write goes through the admin client which
// holds the service-role key and bypasses RLS. We never expose
// this client to the user's request body.
// ============================================================

async function findOrCreateSeedUser(
  admin: SupabaseClient,
  u: SeedUser,
): Promise<{ userId: string; created: boolean }> {
  // 1. Look up by handle in profiles_social — the most reliable
  //    cross-run identity for a seed account.
  const { data: existing } = await admin
    .from("profiles_social")
    .select("user_id")
    .eq("handle", u.handle)
    .maybeSingle();
  if (existing?.user_id) return { userId: existing.user_id, created: false };

  // 2. No profile yet — mint the auth user. email_confirm true so we
  //    skip the verification mail (the email is unroutable anyway).
  //    Random password — these accounts are never logged into.
  const password = crypto.randomUUID() + "Aa1!";
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: emailFor(u),
    password,
    email_confirm: true,
    user_metadata: { seed: true, handle: u.handle },
  });
  if (cErr || !created?.user?.id) {
    // The auth user might already exist (e.g. a previous run created
    // the user but failed before writing profiles_social). Fall back
    // to listing.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = (list?.users || []).find((x) => x.email === emailFor(u));
    if (!match) throw new Error(`createUser failed for ${u.handle}: ${cErr?.message ?? "unknown"}`);
    await upsertProfile(admin, match.id, u);
    return { userId: match.id, created: false };
  }

  await upsertProfile(admin, created.user.id, u);
  return { userId: created.user.id, created: true };
}

async function upsertProfile(admin: SupabaseClient, userId: string, u: SeedUser) {
  // Insert path. The profiles_social BEFORE INSERT trigger will see
  // university=null and leave university_verified false, which is the
  // correct outcome for a fake account.
  const { error } = await admin.from("profiles_social").upsert({
    user_id: userId,
    handle: u.handle,
    display_name: u.displayName,
    avatar_color: u.avatarColor,
    bio: u.bio,
  }, { onConflict: "user_id" });
  if (error) throw new Error(`profiles_social upsert ${u.handle}: ${error.message}`);
}

async function ensurePostsForUser(
  admin: SupabaseClient,
  userId: string,
  posts: SeedPost[],
): Promise<Array<{ id: string; body: string; authorId: string }>> {
  // Skip seeding if this user already has posts — avoids duplicating
  // on re-runs even if the rest of the seed succeeded.
  const { count } = await admin
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId)
    .is("deleted_at", null);
  if ((count || 0) > 0) {
    const { data: existing } = await admin
      .from("posts")
      .select("id, body")
      .eq("author_id", userId)
      .is("deleted_at", null);
    return (existing || []).map((p) => ({ id: p.id, body: p.body, authorId: userId }));
  }

  const rows = posts.map((p) => ({
    author_id: userId,
    body: p.body,
    ticker: p.trade ? p.trade.ticker.toUpperCase() : (p.ticker ? p.ticker.toUpperCase() : null),
    trade: p.trade ?? null,
  }));
  const { data: inserted, error } = await admin
    .from("posts")
    .insert(rows)
    .select("id, body, author_id");
  if (error) throw new Error(`posts insert: ${error.message}`);
  return (inserted || []).map((p) => ({ id: p.id, body: p.body, authorId: p.author_id }));
}

function matchesPrefix(body: string, prefix: string) {
  return body.startsWith(prefix);
}

async function ensureRepliesForPost(
  admin: SupabaseClient,
  postId: string,
  authorIdByHandle: Map<string, string>,
  body: string,
) {
  // Find the prefix table entry whose key is a prefix of the post body.
  let pairs: Array<[string, string]> | undefined;
  for (const [prefix, list] of Object.entries(REPLIES_BY_POST_PREFIX)) {
    if (matchesPrefix(body, prefix)) { pairs = list; break; }
  }
  if (!pairs) return 0;

  // Skip if any replies already exist on this post — same idempotency
  // strategy as posts.
  const { count } = await admin
    .from("replies")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .is("deleted_at", null);
  if ((count || 0) > 0) return 0;

  const rows = pairs
    .map(([handle, replyBody]) => {
      const id = authorIdByHandle.get(handle);
      if (!id) return null;
      return { post_id: postId, author_id: id, body: replyBody };
    })
    .filter((r): r is { post_id: string; author_id: string; body: string } => r !== null);
  if (rows.length === 0) return 0;

  const { error } = await admin.from("replies").insert(rows);
  if (error) throw new Error(`replies insert: ${error.message}`);
  return rows.length;
}

async function ensureLikesForPost(
  admin: SupabaseClient,
  postId: string,
  postBody: string,
  authorIdByHandle: Map<string, string>,
) {
  let voters: string[] | undefined;
  for (const [prefix, list] of Object.entries(LIKES_BY_POST_PREFIX)) {
    if (matchesPrefix(postBody, prefix)) { voters = list; break; }
  }
  if (!voters) return 0;

  const rows = voters
    .map((h) => {
      const id = authorIdByHandle.get(h);
      if (!id) return null;
      return { post_id: postId, user_id: id };
    })
    .filter((r): r is { post_id: string; user_id: string } => r !== null);

  // Composite-PK ignore handles re-runs — but supabase-js doesn't
  // surface PostgREST's on_conflict for inserts on composite PKs
  // cleanly, so we just swallow 23505 (unique_violation).
  const { error } = await admin.from("likes").insert(rows);
  if (error && error.code !== "23505") throw new Error(`likes insert: ${error.message}`);
  return rows.length;
}

async function ensureRepostsForPost(
  admin: SupabaseClient,
  postId: string,
  postBody: string,
  authorIdByHandle: Map<string, string>,
) {
  let voters: string[] | undefined;
  for (const [prefix, list] of Object.entries(REPOSTS_BY_POST_PREFIX)) {
    if (matchesPrefix(postBody, prefix)) { voters = list; break; }
  }
  if (!voters) return 0;
  const rows = voters
    .map((h) => {
      const id = authorIdByHandle.get(h);
      if (!id) return null;
      return { post_id: postId, user_id: id };
    })
    .filter((r): r is { post_id: string; user_id: string } => r !== null);
  const { error } = await admin.from("reposts").insert(rows);
  if (error && error.code !== "23505") throw new Error(`reposts insert: ${error.message}`);
  return rows.length;
}

async function ensureFollow(
  admin: SupabaseClient,
  followerId: string,
  followingId: string,
) {
  if (followerId === followingId) return; // CHECK constraint blocks anyway
  const { error } = await admin.from("follows").insert({
    follower_id: followerId,
    following_id: followingId,
  });
  if (error && error.code !== "23505") {
    throw new Error(`follow ${followerId}→${followingId}: ${error.message}`);
  }
}

async function ensureDmThread(
  admin: SupabaseClient,
  meId: string,
  peerId: string,
): Promise<string> {
  // dm_threads has a CHECK that user_a < user_b. The frontend's
  // openThreadWith does the same sort.
  const [user_a, user_b] = meId < peerId ? [meId, peerId] : [peerId, meId];

  const { data: existing } = await admin
    .from("dm_threads")
    .select("id")
    .eq("user_a", user_a)
    .eq("user_b", user_b)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await admin
    .from("dm_threads")
    .insert({ user_a, user_b })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await admin
        .from("dm_threads")
        .select("id")
        .eq("user_a", user_a)
        .eq("user_b", user_b)
        .maybeSingle();
      if (again?.id) return again.id;
    }
    throw new Error(`dm_thread create: ${error.message}`);
  }
  return created.id;
}

async function ensureDmMessages(
  admin: SupabaseClient,
  threadId: string,
  authorId: string,
  bodies: string[],
) {
  // Skip if the thread already has any messages — avoids re-flooding
  // the inbox on re-run.
  const { count } = await admin
    .from("dm_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);
  if ((count || 0) > 0) return 0;

  const rows = bodies.map((body) => ({
    thread_id: threadId,
    author_id: authorId,
    body,
  }));
  const { error } = await admin.from("dm_messages").insert(rows);
  if (error) throw new Error(`dm_messages insert: ${error.message}`);
  return rows.length;
}

// ============================================================
// HTTP handler
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- auth gate ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const supabaseUserClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabaseUserClient.auth.getUser(jwt);
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const callerId = user.id;

    // --- admin client (service role bypasses RLS) ---
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- rate limit (samas-0.4.17): ADMIN tier ---
    // Heavy op (mints up to 12 auth users + ~60 posts + replies +
    // follows). 30/5min way more than enough — a real demo run is
    // once per device. Throttle prevents abuse.
    const _rl = await consumeRateLimit(admin, {
      bucket: buildBucket("seed-social-demo", { userId: callerId }),
      ...RATE_LIMITS.ADMIN,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // --- 1. Ensure all 12 seed users exist (auth + profile) ---
    const handleToUserId = new Map<string, string>();
    let usersCreated = 0;
    for (const u of SEED_USERS) {
      const { userId, created } = await findOrCreateSeedUser(admin, u);
      handleToUserId.set(u.handle, userId);
      if (created) usersCreated++;
    }

    // --- 2. Ensure caller has a profiles_social row.
    // getMe() in api/social.js auto-provisions one on first Social
    // tab open; we re-do that here so seeding works even if Manuel
    // has never opened Social yet. The trigger will leave
    // university_verified alone (it's a no-op when the email matches
    // a uni domain, which it shouldn't for the demo account).
    const { data: callerProfile } = await admin
      .from("profiles_social")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();
    if (!callerProfile) {
      // Derive a handle from the caller's email so the auto-provisioned
      // row is sensible even without going through the v2 flow.
      const localPart = (user.email || "").split("@")[0]?.replace(/[^a-z0-9_]/gi, "").slice(0, 12) || "manuel";
      const handle = `${localPart}${Math.floor(Math.random() * 9000 + 1000)}`;
      const { error } = await admin.from("profiles_social").insert({
        user_id: callerId,
        handle,
        display_name: user.email?.split("@")[0] || "Manuel",
        avatar_color: "#16C784",
      });
      if (error && error.code !== "23505") {
        throw new Error(`caller profile create: ${error.message}`);
      }
    }

    // --- 3. Posts ---
    let postsCreated = 0;
    const allPosts: Array<{ id: string; body: string; authorId: string }> = [];
    for (const u of SEED_USERS) {
      const userId = handleToUserId.get(u.handle)!;
      const before = allPosts.length;
      const list = await ensurePostsForUser(admin, userId, POSTS_BY_HANDLE[u.handle] || []);
      allPosts.push(...list);
      postsCreated += Math.max(0, allPosts.length - before);
    }

    // --- 4. Replies ---
    let repliesCreated = 0;
    for (const p of allPosts) {
      repliesCreated += await ensureRepliesForPost(admin, p.id, handleToUserId, p.body);
    }

    // --- 5. Likes + reposts (Trending engagement) ---
    let likesCreated = 0;
    let repostsCreated = 0;
    for (const p of allPosts) {
      likesCreated   += await ensureLikesForPost(admin, p.id, p.body, handleToUserId);
      repostsCreated += await ensureRepostsForPost(admin, p.id, p.body, handleToUserId);
    }

    // --- 6. Follow mesh ---
    let followsCreated = 0;
    for (const handle of CALLER_FOLLOWS) {
      const target = handleToUserId.get(handle);
      if (!target) continue;
      await ensureFollow(admin, callerId, target);
      followsCreated++;
    }
    for (const [a, b] of INTER_FOLLOWS) {
      const aid = handleToUserId.get(a);
      const bid = handleToUserId.get(b);
      if (!aid || !bid) continue;
      await ensureFollow(admin, aid, bid);
      followsCreated++;
    }

    // --- 6.5. Inbound engagement to caller ---
    // 0.0.64 fix: seeded-user → caller follows + likes on the
    // caller's first post. Without these the caller has 0 followers
    // and the social_notifications triggers never fire toward them
    // (because every other event is seeded↔seeded, never inbound).
    // ensureFollow already handles the 23505 dup case so re-running
    // is a no-op.
    let inboundFollowsCreated = 0;
    let inboundLikesCreated = 0;
    for (const handle of FOLLOWERS_OF_CALLER) {
      const followerId = handleToUserId.get(handle);
      if (!followerId) continue;
      await ensureFollow(admin, followerId, callerId);
      inboundFollowsCreated++;
    }
    // The caller's first live post (if any). We skip silently when
    // they haven't posted yet — likes need a target post.
    const { data: callerPostRow } = await admin
      .from("posts")
      .select("id")
      .eq("author_id", callerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (callerPostRow?.id) {
      const targetPostId = callerPostRow.id;
      for (const handle of LIKERS_OF_CALLER_POSTS) {
        const likerId = handleToUserId.get(handle);
        if (!likerId) continue;
        const { error } = await admin
          .from("likes")
          .insert({ post_id: targetPostId, user_id: likerId });
        if (error && error.code !== "23505") {
          console.warn(`[seed-social] caller-post like by ${handle}: ${error.message}`);
          continue;
        }
        inboundLikesCreated++;
      }
    }

    // --- 7. DMs to caller ---
    let dmThreadsCreated = 0;
    let dmMessagesCreated = 0;
    for (const dm of DMS_TO_CALLER) {
      const peerId = handleToUserId.get(dm.from);
      if (!peerId) continue;
      const threadId = await ensureDmThread(admin, callerId, peerId);
      const n = await ensureDmMessages(admin, threadId, peerId, dm.messages);
      if (n > 0) dmThreadsCreated++;
      dmMessagesCreated += n;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        seedUsers: SEED_USERS.length,
        usersCreated,
        postsCreated,
        repliesCreated,
        likesCreated,
        repostsCreated,
        followsCreated,
        inboundFollowsCreated,
        inboundLikesCreated,
        dmThreadsCreated,
        dmMessagesCreated,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[seed-social-demo] crash:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
