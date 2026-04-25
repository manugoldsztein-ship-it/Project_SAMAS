// ============================================================
// fetch-news — hybrid news fetcher (Finnhub + Argentine RSS)
// ============================================================
// Body (JSON): { ticker: "GGAL" }
//
// Decides the source by ticker:
//   - Argentine ticker (in ARG_KEYWORDS): pull RSS feeds from
//     Ámbito, Cronista, Infobae and filter items whose title or
//     description mentions one of the company's keywords.
//   - Anything else: hit Finnhub /company-news.
//
// Cache: rows in public.articles are reused if any row for this
// ticker was fetched within CACHE_TTL_MS. Otherwise we re-fetch and
// upsert. Per-ticker invalidation, no cross-ticker bleed.
//
// Secrets required (set in Supabase project settings):
//   - FINNHUB_API_KEY        — for global tickers
//   - SUPABASE_URL           — auto-provisioned
//   - SUPABASE_SERVICE_ROLE_KEY — auto-provisioned
//
// Returns:
//   200 { articles: [{ title, summary, url, source, image_url, published_at }, ...] }
//   400 { error: "..." }   — bad input
//   401 { error: "..." }   — missing/invalid JWT
//   500 { error: "..." }   — upstream failure
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// ANON key — used for the user-JWT verification client. Calling
// auth.getUser() on a client created with the SERVICE_KEY rejects the
// caller's JWT as "Invalid" because the service role bypasses RLS and
// the auth.getUser() helper expects to be in a user-scoped context.
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CACHE_TTL_MS = 15 * 60 * 1000;        // 15 minutes
const MAX_PER_SOURCE = 25;                   // cap per source per fetch
const MAX_RETURN = 30;                       // cap returned to caller

// ------------------------------------------------------------
// Argentine ticker → keywords table
// ------------------------------------------------------------
// When the user searches GGAL we don't want to match articles that
// just say "Banco" — we filter on company-specific keywords. Keywords
// are case-insensitive and we accept multi-word phrases.
//
// Ordering matters slightly: more specific terms first reduces false
// positives in the title-substring filter ("Banco Galicia" before
// "Galicia").
const ARG_KEYWORDS: Record<string, string[]> = {
  GGAL:   ["Grupo Financiero Galicia", "Banco Galicia", "Galicia"],
  YPF:    ["YPF", "Yacimientos Petrolíferos"],
  YPFD:   ["YPF", "Yacimientos Petrolíferos"],
  PAMP:   ["Pampa Energía", "Pampa Energia"],
  BMA:    ["Banco Macro", "Macro"],
  SUPV:   ["Banco Supervielle", "Supervielle"],
  BBAR:   ["BBVA Argentina", "BBVA"],
  ALUA:   ["Aluar"],
  TXAR:   ["Ternium Argentina", "Ternium"],
  TENARIS:["Tenaris"],
  CEPU:   ["Central Puerto"],
  EDN:    ["Edenor"],
  TGNO4:  ["Transportadora de Gas del Norte", "TGN"],
  TGSU2:  ["Transportadora de Gas del Sur", "TGS"],
  COME:   ["Sociedad Comercial del Plata", "Comercial del Plata"],
  MIRG:   ["Mirgor"],
  CRES:   ["Cresud"],
  AGRO:   ["Agrometal"],
  LOMA:   ["Loma Negra"],
  METR:   ["MetroGAS", "Metrogas"],
  VALO:   ["Banco de Valores"],
  TECO2:  ["Telecom Argentina", "Telecom"],
  HARG:   ["Holcim Argentina", "Holcim"],
  TRAN:   ["Transener"],
  AUSO:   ["Autopistas del Sol"],
  BHIP:   ["Banco Hipotecario", "Hipotecario"],
  IRSA:   ["IRSA"],
  CAPX:   ["Capex"],
  GARO:   ["Garovaglio"],
  BYMA:   ["BYMA", "Bolsas y Mercados Argentinos"],
};

// Argentine RSS feeds — finance / markets sections only. Order is
// not important; we fetch them in parallel and merge. URLs verified
// against current site layouts as of writing — if any 404s in the
// future we just skip that feed (graceful failure).
const ARG_RSS_FEEDS = [
  { source: "Ámbito",         url: "https://www.ambito.com/rss/finanzas.xml" },
  { source: "Ámbito",         url: "https://www.ambito.com/rss/economia.xml" },
  { source: "Cronista",       url: "https://www.cronista.com/files/rss/finanzas-mercados.xml" },
  { source: "Cronista",       url: "https://www.cronista.com/files/rss/economia-politica.xml" },
  { source: "Infobae",        url: "https://www.infobae.com/economia/feed/" },
  { source: "La Nación",      url: "https://servicios.lanacion.com.ar/herramientas/rss/categoria-id=347" }, // Economía
];

// ------------------------------------------------------------
// RSS parser — minimal, no external dependency. RSS 2.0 + Atom.
// We only need title, link, description, pubDate, image (if any).
// ------------------------------------------------------------
type RssItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;     // ISO or RFC822
  image?: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function tag(block: string, name: string): string | null {
  // Capture <name>...</name> or <name attr="...">...</name>
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return decodeEntities(stripCdata(m[1])).trim();
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  // RSS 2.0 uses <item>, Atom uses <entry>. We handle both.
  const itemBlocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ];
  for (const m of itemBlocks) {
    const block = m[0];
    const title = tag(block, "title");
    let link = tag(block, "link");
    if (!link) {
      // Atom puts the link in a self-closing href attribute
      const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
      if (linkMatch) link = linkMatch[1];
    }
    const description = tag(block, "description") || tag(block, "summary") || tag(block, "content") || "";
    const pubDate = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || "";
    // Image: try <enclosure url="..."/>, <media:content url="..."/>,
    // or first <img src="..."> in the description.
    let image: string | undefined;
    const enclosure = block.match(/<enclosure[^>]*url="([^"]+)"/i);
    if (enclosure) image = enclosure[1];
    if (!image) {
      const media = block.match(/<media:content[^>]*url="([^"]+)"/i);
      if (media) image = media[1];
    }
    if (!image) {
      const img = description.match(/<img[^>]*src="([^"]+)"/i);
      if (img) image = img[1];
    }
    if (title && link) {
      items.push({
        title: stripTags(title),
        link,
        description: stripTags(description).slice(0, 400),
        pubDate,
        image,
      });
    }
  }
  return items;
}

function parsePubDate(s: string): Date {
  if (!s) return new Date();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

// ------------------------------------------------------------
// fetch with timeout — every upstream call must not block the function
// for more than its budget. Total budget ~ 8s; per-source ~ 5s.
// ------------------------------------------------------------
async function fetchTimeout(url: string, opts: RequestInit = {}, ms = 5000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------
// Source: Finnhub /company-news
// ------------------------------------------------------------
type FinnhubArticle = {
  category: string;
  datetime: number;     // unix seconds
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
};

async function fetchFinnhub(ticker: string): Promise<NormalizedArticle[]> {
  if (!FINNHUB_API_KEY) return [];
  // Last 14 days. Finnhub requires a from/to range.
  const to = new Date();
  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${fmt(from)}&to=${fmt(to)}&token=${FINNHUB_API_KEY}`;
  try {
    const r = await fetchTimeout(url, {}, 6000);
    if (!r.ok) return [];
    const arr: FinnhubArticle[] = await r.json();
    return (arr || []).slice(0, MAX_PER_SOURCE).map((a) => ({
      ticker,
      title: a.headline,
      summary: a.summary,
      url: a.url,
      source: a.source,
      image_url: a.image || null,
      published_at: new Date(a.datetime * 1000).toISOString(),
    }));
  } catch (e) {
    console.error("[fetch-news] finnhub failed:", e);
    return [];
  }
}

// ------------------------------------------------------------
// Source: Argentine RSS — fetch all feeds in parallel, parse,
// filter by keywords. Each match gets associated with our ticker.
// ------------------------------------------------------------
async function fetchArgRss(ticker: string, keywords: string[]): Promise<NormalizedArticle[]> {
  const lowers = keywords.map((k) => k.toLowerCase());
  const matchesKeywords = (s: string) => {
    const lc = s.toLowerCase();
    return lowers.some((k) => lc.includes(k));
  };

  const fetchOne = async (feed: typeof ARG_RSS_FEEDS[number]): Promise<NormalizedArticle[]> => {
    try {
      const r = await fetchTimeout(feed.url, {
        headers: { "User-Agent": "SAMAS-NewsBot/1.0 (+https://samas.app)" },
      }, 5000);
      if (!r.ok) return [];
      const xml = await r.text();
      const items = parseRss(xml);
      return items
        .filter((it) => matchesKeywords(it.title) || matchesKeywords(it.description))
        .slice(0, MAX_PER_SOURCE)
        .map((it) => ({
          ticker,
          title: it.title,
          summary: it.description,
          url: it.link,
          source: feed.source,
          image_url: it.image || null,
          published_at: parsePubDate(it.pubDate).toISOString(),
        }));
    } catch (e) {
      console.error(`[fetch-news] rss ${feed.url} failed:`, e);
      return [];
    }
  };

  const results = await Promise.all(ARG_RSS_FEEDS.map(fetchOne));
  return results.flat();
}

// ------------------------------------------------------------
// Normalized article shape (matches the articles table)
// ------------------------------------------------------------
type NormalizedArticle = {
  ticker: string;
  title: string;
  summary: string | null;
  url: string;
  source: string | null;
  image_url: string | null;
  published_at: string; // ISO
};

// ------------------------------------------------------------
// Main handler
// ------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: caller must have a valid Supabase JWT.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      console.log("[fetch-news] Missing Bearer prefix:", authHeader.slice(0, 20));
      return new Response(JSON.stringify({ error: "Missing JWT" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Verify the JWT. Pass the token explicitly to getUser() — that
    // form is the most reliable and works regardless of how the
    // client was constructed. We use the ANON key for the client
    // because getUser() on a service-role client rejects user JWTs.
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!ANON_KEY) {
      console.log("[fetch-news] SUPABASE_ANON_KEY env var is empty");
      return new Response(JSON.stringify({ error: "Server misconfigured: ANON_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.log("[fetch-news] getUser failed:", userErr?.message, "tokenPrefix:", token.slice(0, 30));
      return new Response(JSON.stringify({
        error: "Invalid JWT",
        detail: userErr?.message || "no user returned",
      }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body.
    const body = await req.json().catch(() => null);
    const tickerRaw = body?.ticker;
    if (!tickerRaw || typeof tickerRaw !== "string") {
      return new Response(JSON.stringify({ error: "ticker required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ticker = tickerRaw.trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,15}$/.test(ticker)) {
      return new Response(JSON.stringify({ error: "invalid ticker" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for cache reads/writes.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Cache check — any article for this ticker fetched within TTL?
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data: cached, error: cacheErr } = await admin
      .from("articles")
      .select("title, summary, url, source, image_url, published_at, fetched_at")
      .eq("ticker", ticker)
      .gte("fetched_at", cacheCutoff)
      .order("published_at", { ascending: false })
      .limit(MAX_RETURN);

    if (!cacheErr && cached && cached.length > 0) {
      return new Response(JSON.stringify({ articles: cached, source: "cache" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache miss — fetch from upstreams.
    let articles: NormalizedArticle[];
    if (ARG_KEYWORDS[ticker]) {
      articles = await fetchArgRss(ticker, ARG_KEYWORDS[ticker]);
    } else {
      articles = await fetchFinnhub(ticker);
    }

    // Dedup by URL within this fetch.
    const seen = new Set<string>();
    articles = articles.filter((a) => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    // Sort newest first, cap.
    articles.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
    articles = articles.slice(0, MAX_RETURN);

    // Upsert into cache. Tolerate insert errors (e.g. uniqueness on
    // (ticker, url) for older rows) — we still return what we fetched.
    if (articles.length > 0) {
      const rows = articles.map((a) => ({
        ...a,
        fetched_at: new Date().toISOString(),
      }));
      const { error: upErr } = await admin
        .from("articles")
        .upsert(rows, { onConflict: "ticker,url" });
      if (upErr) console.error("[fetch-news] upsert failed:", upErr);
    }

    return new Response(JSON.stringify({ articles, source: "fresh" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[fetch-news] uncaught:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
