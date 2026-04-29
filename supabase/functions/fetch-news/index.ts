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
// Anthropic — optional. If set, articles are auto-translated to the
// caller's lang using Claude Haiku (cheap + fast). If missing, we
// just return articles in their source language and skip translation
// silently — no error, just no translation.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

// Languages the app supports. We only translate to ones in this list.
const SUPPORTED_LANGS = new Set(["es", "en", "pt", "it", "fr", "de", "zh", "ru", "he", "ar"]);
const LANG_NAMES: Record<string, string> = {
  es: "Spanish (Argentine, neutral, no slang)",
  en: "English",
  pt: "Portuguese (Brazilian)",
  it: "Italian",
  fr: "French",
  de: "German",
  zh: "Simplified Chinese",
  ru: "Russian",
  he: "Hebrew",
  ar: "Arabic",
};

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

// Argentine RSS feeds — finance / markets sections only. We keep the
// list small (one strong feed per publisher) so the parallel fetch
// completes quickly. The previous list of 12 made every uncached
// query wait ~5s for the slowest source.
const ARG_RSS_FEEDS = [
  { source: "Ámbito",         url: "https://www.ambito.com/contenidos/finanzas.xml" },
  { source: "Cronista",       url: "https://www.cronista.com/files/rss/finanzas-mercados.xml" },
  { source: "Infobae",        url: "https://www.infobae.com/economia/rss" },
  { source: "La Nación",      url: "https://servicios.lanacion.com.ar/herramientas/rss/categoria-id=347" },
];

// Global RSS feeds — used for non-AR tickers (CEDEARs, ETFs, crypto,
// commodities). CNBC and MarketWatch are the workhorses for US-listed
// brand coverage; Bloomberg Línea is the LATAM Spanish arm of
// Bloomberg and the only legitimately accessible Bloomberg-branded
// feed (the main bloomberg.com feeds are licensed/paywalled and
// cannot be redistributed). Reuters intentionally not included —
// they retired their public RSS in 2020.
const GLOBAL_RSS_FEEDS = [
  { source: "CNBC",             url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" }, // Top news
  { source: "CNBC Markets",     url: "https://www.cnbc.com/id/15839135/device/rss/rss.html" },
  { source: "MarketWatch",      url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { source: "Bloomberg Línea",  url: "https://www.bloomberglinea.com/arc/outboundfeeds/rss/?outputType=xml" },
];

// Keyword map for tickers we cover in the global market. Mirrors
// ARG_KEYWORDS in shape but for the rest of the world. Each ticker
// gets the company's brand name + a couple of contextual keywords so
// a CNBC headline like "Apple rolls out iPhone 17" matches AAPL even
// when the ticker symbol itself isn't in the title. Add new tickers
// here as they get added to the ASSETS table in src/App.jsx.
const GLOBAL_KEYWORDS: Record<string, string[]> = {
  // CEDEARs — US-listed names. The brand keyword almost always wins;
  // we add product/exec keywords for cases where the brand alone is
  // ambiguous ("Tesla" → only when paired with "Musk" or "stock").
  AAPL:   ["Apple", "iPhone", "AAPL"],
  MSFT:   ["Microsoft", "Azure", "MSFT"],
  GOOGL:  ["Alphabet", "Google", "GOOGL"],
  NVDA:   ["NVIDIA", "Nvidia", "GPU", "NVDA"],
  AMZN:   ["Amazon", "AWS", "AMZN"],
  TSLA:   ["Tesla", "Elon Musk", "TSLA"],
  // ETFs — broad keywords match macro / index coverage from CNBC.
  SPY:    ["S&P 500", "S&P", "SPY"],
  QQQ:    ["Nasdaq", "Nasdaq 100", "QQQ"],
  GLD:    ["gold prices", "gold", "GLD"],
  // Commodities — markets sources rarely use the ticker, so we lean
  // on commodity-name keywords.
  OIL:    ["WTI", "crude oil", "oil prices"],
  COPPER: ["copper prices", "copper", "industrial metals"],
  // Crypto.
  BTC:    ["Bitcoin", "BTC", "crypto"],
};

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
  if (!FINNHUB_API_KEY) {
    console.log("[fetch-news] FINNHUB_API_KEY missing — skipping finnhub");
    return [];
  }
  // Last 14 days. Finnhub requires a from/to range.
  const to = new Date();
  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${fmt(from)}&to=${fmt(to)}&token=${FINNHUB_API_KEY}`;
  try {
    const r = await fetchTimeout(url, {}, 6000);
    if (!r.ok) {
      console.log(`[fetch-news] finnhub ${ticker} → ${r.status}`);
      return [];
    }
    const arr: FinnhubArticle[] = await r.json();
    console.log(`[fetch-news] finnhub ${ticker}: ${arr?.length || 0} articles`);
    return (arr || []).slice(0, MAX_PER_SOURCE).map((a) => ({
      ticker,
      title: a.headline,
      summary: a.summary,
      url: a.url,
      source: a.source,
      image_url: looksLikeBadThumbnail(a.image) ? null : (a.image || null),
      published_at: new Date(a.datetime * 1000).toISOString(),
    }));
  } catch (e) {
    console.log("[fetch-news] finnhub threw:", (e as Error).message);
    return [];
  }
}

// ------------------------------------------------------------
// Source: Argentine RSS — fetch all feeds in parallel, parse,
// filter by keywords. Each match gets associated with our ticker.
// ------------------------------------------------------------
// Filter known-bad thumbnail patterns. Sources sometimes return logo
// placeholders instead of real article images (Yahoo's purple "b!"
// being the most egregious). We scrub those so the client never
// shows them.
function looksLikeBadThumbnail(url: string | null): boolean {
  if (!url) return true;
  const lc = url.toLowerCase();
  // Yahoo logo placeholders (the purple "b!" we saw in the wild).
  if (lc.includes("s.yimg.com/rz/")) return true;
  if (lc.includes("s.yimg.com/cv/")) return true;
  if (lc.includes("yahoo_logo")) return true;
  // Generic 1x1 / tracker pixels.
  if (lc.endsWith(".gif")) return true;
  if (lc.includes("/pixel")) return true;
  if (lc.includes("transparent")) return true;
  // Very-small thumbnail patterns from feed enclosures (not always
  // accurate but a reasonable heuristic — we'd rather show no image
  // than a tiny one that looks broken).
  if (lc.includes("1x1") || lc.includes("16x16") || lc.includes("32x32")) return true;
  return false;
}

// Generic RSS fan-out. Same shape used for AR and global feeds — the
// only thing that changes is the feed list passed in. Each feed
// fetched in parallel with a per-source 3s timeout so a slow source
// doesn't drag down the whole response.
type RssFeed = { source: string; url: string };

async function fetchRssFeeds(
  feeds: readonly RssFeed[],
  ticker: string,
  keywords: string[],
  scope: string,
): Promise<NormalizedArticle[]> {
  const lowers = keywords.map((k) => k.toLowerCase());
  const matchesKeywords = (s: string) => {
    if (!s) return false;
    const lc = s.toLowerCase();
    return lowers.some((k) => lc.includes(k));
  };

  const fetchOne = async (feed: RssFeed): Promise<NormalizedArticle[]> => {
    try {
      const r = await fetchTimeout(feed.url, {
        headers: {
          // Many RSS endpoints reject suspicious User-Agents. Pretend
          // to be a real browser (the same UA Firefox sends) so the
          // server doesn't block us.
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
      }, 3000);
      if (!r.ok) {
        console.log(`[fetch-news] rss ${feed.source} ${feed.url} → ${r.status}`);
        return [];
      }
      const xml = await r.text();
      const items = parseRss(xml);
      const matches = items.filter((it) => matchesKeywords(it.title) || matchesKeywords(it.description));
      console.log(`[fetch-news] rss ${feed.source}: ${items.length} items, ${matches.length} match "${ticker}"`);
      return matches
        .slice(0, MAX_PER_SOURCE)
        .map((it) => ({
          ticker,
          title: it.title,
          summary: it.description,
          url: it.link,
          source: feed.source,
          image_url: looksLikeBadThumbnail(it.image || null) ? null : (it.image || null),
          published_at: parsePubDate(it.pubDate).toISOString(),
        }));
    } catch (e) {
      console.log(`[fetch-news] rss ${feed.source} ${feed.url} threw:`, (e as Error).message);
      return [];
    }
  };

  const results = await Promise.all(feeds.map(fetchOne));
  const flat = results.flat();
  console.log(`[fetch-news] ${scope} total for ${ticker}: ${flat.length} articles`);
  return flat;
}

async function fetchArgRss(ticker: string, keywords: string[]): Promise<NormalizedArticle[]> {
  return fetchRssFeeds(ARG_RSS_FEEDS, ticker, keywords, "ARG");
}

async function fetchGlobalRss(ticker: string, keywords: string[]): Promise<NormalizedArticle[]> {
  return fetchRssFeeds(GLOBAL_RSS_FEEDS, ticker, keywords, "GLOBAL");
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
  source_lang?: string;
  translations?: Record<string, { title?: string; summary?: string }>;
};

// ------------------------------------------------------------
// Translation — Claude Haiku via Anthropic API
// ------------------------------------------------------------
// Batches multiple articles into one API call to save tokens. Returns
// a parallel array of translations or null entries for ones that
// failed to translate. We accept partial failure — translated items
// override originals, untranslated keep originals.
type TranslationItem = { title: string; summary: string };

async function translateBatch(
  items: TranslationItem[],
  toLang: string,
): Promise<(TranslationItem | null)[]> {
  if (!ANTHROPIC_API_KEY) {
    console.log("[fetch-news] ANTHROPIC_API_KEY not set — skipping translation");
    return items.map(() => null);
  }
  if (items.length === 0) return [];
  const langName = LANG_NAMES[toLang] || toLang;
  // Build a strict prompt: numbered JSON array in/out, one entry per
  // article. Asking the model to produce JSON keeps parsing simple
  // and lets it batch many items in a single call cheaply.
  const userPrompt = [
    `Translate the following news article excerpts to ${langName}.`,
    `Keep proper nouns, ticker symbols, company names, and currency amounts unchanged.`,
    `Preserve a neutral, professional tone appropriate for a financial broker app.`,
    `Output ONLY a JSON array of objects with shape {"title": "...", "summary": "..."}, in the same order as the input. Do not include any commentary, headers, or markdown.`,
    ``,
    `Input:`,
    JSON.stringify(items.map((it, i) => ({ i, title: it.title, summary: it.summary })), null, 2),
  ].join("\n");
  try {
    const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.log(`[fetch-news] anthropic ${r.status}:`, txt.slice(0, 200));
      return items.map(() => null);
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    // Tolerate markdown code fences in the response.
    const jsonText = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      console.log("[fetch-news] anthropic returned non-array");
      return items.map(() => null);
    }
    return items.map((_, i) => {
      const t = parsed[i];
      if (t && typeof t.title === "string" && typeof t.summary === "string") {
        return { title: t.title, summary: t.summary };
      }
      return null;
    });
  } catch (e) {
    console.log("[fetch-news] translation threw:", (e as Error).message);
    return items.map(() => null);
  }
}

// Decide what language an article is written in based on its source.
// Coarse heuristic but reliable for the sources we use.
function detectSourceLang(source: string | null | undefined): string {
  if (!source) return "en";
  const lc = source.toLowerCase();
  if (lc.includes("ámbito") || lc.includes("ambito") || lc.includes("cronista")
      || lc.includes("infobae") || lc.includes("nación") || lc.includes("nacion")
      || lc.includes("bloomberg línea") || lc.includes("bloomberg linea")) {
    return "es";
  }
  return "en";
}

// Apply translations for the given lang to a batch of articles. Articles
// already in the user's lang get returned as-is. Articles with a cached
// translation get the cached version. Articles missing the translation
// are translated via Anthropic, then upserted back to DB so subsequent
// lookups for the same lang are free.
type DbArticleRow = {
  id?: string;
  ticker?: string;
  title: string;
  summary: string | null;
  url: string;
  source: string | null;
  image_url: string | null;
  published_at: string;
  fetched_at?: string;
  translations?: Record<string, { title?: string; summary?: string }> | null;
  source_lang?: string | null;
};

type ReturnedArticle = {
  ticker?: string;
  title: string;
  summary: string | null;
  url: string;
  source: string | null;
  image_url: string | null;
  published_at: string;
};

async function applyTranslations(
  admin: ReturnType<typeof createClient>,
  rows: DbArticleRow[],
  lang: string | null,
): Promise<ReturnedArticle[]> {
  if (!lang) {
    // No lang requested → return originals.
    return rows.map((r) => ({
      ticker: (r as any).ticker,
      title: r.title,
      summary: r.summary,
      url: r.url,
      source: r.source,
      image_url: r.image_url,
      published_at: r.published_at,
    }));
  }

  // Decide which rows need translation. Skip:
  //   - rows whose source_lang already matches the target lang,
  //   - rows that already have a cached translation for the target lang.
  const toTranslate: { row: DbArticleRow; idx: number }[] = [];
  const result: ReturnedArticle[] = rows.map((r, idx) => {
    const srcLang = r.source_lang || detectSourceLang(r.source);
    if (srcLang === lang) {
      return {
        ticker: (r as any).ticker,
        title: r.title,
        summary: r.summary,
        url: r.url,
        source: r.source,
        image_url: r.image_url,
        published_at: r.published_at,
      };
    }
    const cached = r.translations?.[lang];
    if (cached?.title && cached?.summary) {
      return {
        ticker: (r as any).ticker,
        title: cached.title,
        summary: cached.summary,
        url: r.url,
        source: r.source,
        image_url: r.image_url,
        published_at: r.published_at,
      };
    }
    toTranslate.push({ row: r, idx });
    // Placeholder — overwritten below.
    return {
      ticker: (r as any).ticker,
      title: r.title,
      summary: r.summary,
      url: r.url,
      source: r.source,
      image_url: r.image_url,
      published_at: r.published_at,
    };
  });

  if (toTranslate.length === 0) return result;

  const translations = await translateBatch(
    toTranslate.map(({ row }) => ({
      title: row.title,
      summary: row.summary || "",
    })),
    lang,
  );

  // Patch the result + collect updates for DB.
  const updates: { id: string; translations: Record<string, { title: string; summary: string }> }[] = [];
  for (let i = 0; i < toTranslate.length; i++) {
    const t = translations[i];
    const { row, idx } = toTranslate[i];
    if (t) {
      result[idx].title = t.title;
      result[idx].summary = t.summary;
      if (row.id) {
        const merged = { ...(row.translations || {}), [lang]: { title: t.title, summary: t.summary } };
        updates.push({ id: row.id, translations: merged });
      }
    }
  }

  // Persist new translations back to the cache. Best-effort — failures
  // here just mean the next call re-translates; not a user-visible bug.
  if (updates.length > 0) {
    for (const u of updates) {
      const { error } = await admin
        .from("articles")
        .update({ translations: u.translations })
        .eq("id", u.id);
      if (error) console.log("[fetch-news] translation update failed:", error.message);
    }
  }

  return result;
}

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
    // Optional lang. If unset or unsupported, we don't translate.
    const langRaw: unknown = body?.lang;
    const lang = (typeof langRaw === "string" && SUPPORTED_LANGS.has(langRaw)) ? langRaw : null;

    // Service-role client for cache reads/writes.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Cache check — any article for this ticker fetched within TTL?
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data: cached, error: cacheErr } = await admin
      .from("articles")
      .select("id, title, summary, url, source, image_url, published_at, fetched_at, translations, source_lang")
      .eq("ticker", ticker)
      .gte("fetched_at", cacheCutoff)
      .order("published_at", { ascending: false })
      .limit(MAX_RETURN);

    if (!cacheErr && cached && cached.length > 0) {
      const out = await applyTranslations(admin, cached, lang);
      return new Response(JSON.stringify({ articles: out, source: "cache" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache miss — fetch from upstreams.
    // Strategy:
    //   - ARG ticker: try Argentine RSS first (Spanish, local context),
    //     fall back to Finnhub with a `.BA` suffix variant if no
    //     RSS hits (Finnhub does cover some Argentine securities under
    //     "TICKER.BA"). Last resort: bare ticker on Finnhub.
    //   - GLOBAL ticker (CEDEARs, ETFs, crypto): pull CNBC / MarketWatch
    //     / Bloomberg Línea AND Finnhub in parallel — both contribute,
    //     RSS gives the brand-name coverage Manuel asked for, Finnhub
    //     guarantees a baseline result. Dedup by URL afterwards.
    //   - Unknown ticker: Finnhub only.
    // This means even tickers our RSS keyword list misses still
    // typically return *something* rather than empty.
    let articles: NormalizedArticle[] = [];
    if (ARG_KEYWORDS[ticker]) {
      articles = await fetchArgRss(ticker, ARG_KEYWORDS[ticker]);
      if (articles.length === 0) {
        console.log(`[fetch-news] ARG RSS empty for ${ticker}, trying Finnhub .BA`);
        articles = await fetchFinnhub(`${ticker}.BA`);
      }
      if (articles.length === 0) {
        console.log(`[fetch-news] Finnhub .BA empty for ${ticker}, trying bare`);
        articles = await fetchFinnhub(ticker);
      }
    } else if (GLOBAL_KEYWORDS[ticker]) {
      const [rss, fh] = await Promise.all([
        fetchGlobalRss(ticker, GLOBAL_KEYWORDS[ticker]),
        fetchFinnhub(ticker),
      ]);
      articles = [...rss, ...fh];
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

    // Upsert into cache. We tag each row with its source_lang so future
    // requests can skip translation when the requested lang matches.
    // Tolerate insert errors — we still return what we fetched.
    if (articles.length > 0) {
      const rows = articles.map((a) => ({
        ticker: a.ticker,
        title: a.title,
        summary: a.summary,
        url: a.url,
        source: a.source,
        image_url: a.image_url,
        published_at: a.published_at,
        source_lang: detectSourceLang(a.source),
        fetched_at: new Date().toISOString(),
      }));
      const { error: upErr } = await admin
        .from("articles")
        .upsert(rows, { onConflict: "ticker,url" });
      if (upErr) console.error("[fetch-news] upsert failed:", upErr);
    }

    // Re-fetch from DB so we have the row IDs (needed to write
    // translations back) and any pre-existing translations from
    // earlier fetches with a different lang.
    const { data: persisted } = await admin
      .from("articles")
      .select("id, ticker, title, summary, url, source, image_url, published_at, fetched_at, translations, source_lang")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(MAX_RETURN);

    const out = await applyTranslations(admin, persisted || [], lang);

    return new Response(JSON.stringify({ articles: out, source: "fresh" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[fetch-news] uncaught:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
