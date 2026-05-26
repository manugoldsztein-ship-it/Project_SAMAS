// ============================================================
// _shared/llm.ts — single LLM provider helper for Edge Functions
// ============================================================
// Until 0.4.84 every AI function (trade-coach, validate-thesis,
// analyze-portfolio, ...) reimplemented the same pattern: read
// ANTHROPIC_API_KEY, fetch /v1/messages with a timeout, parse the
// content[0].text out of the response. ~30 functions × the same
// 40 lines = a lot of churn whenever we want to retune the call
// (swap model, add a provider, change timeout default).
//
// This helper centralizes the call so we can:
//   - Switch providers via env var (LLM_PROVIDER=anthropic|ollama)
//   - Run against a local Ollama PC via Cloudflare Tunnel during
//     dev, then flip the same env var back to "anthropic" for the
//     production Supabase project.
//   - Add new providers later (Groq / OpenAI / etc) in one place.
//
// Env vars:
//   LLM_PROVIDER       "anthropic" (default) | "ollama"
//   ANTHROPIC_API_KEY  Anthropic key
//   ANTHROPIC_MODEL    default "claude-haiku-4-5-20251001"
//   OLLAMA_BASE_URL    e.g. https://samas-ollama.trycloudflare.com
//                      (no trailing slash; /v1/chat/completions is appended)
//   OLLAMA_MODEL       e.g. "qwen2.5:14b" or "llama3.1:8b"
//   OLLAMA_API_KEY     optional; sent as `Authorization: Bearer ...`
//                      so you can put Caddy/Cloudflare Access in front
//                      of the tunnel and still let the function in.
//
// callLLM returns null when no provider is configured. Callers
// should treat null exactly like an HTTP failure: fall back to
// their templated/deterministic verdict.
// ============================================================

export type LLMProvider = "anthropic" | "ollama";

export interface LLMOptions {
  /** Optional system prompt. Anthropic + Ollama both support it. */
  system?: string;
  /** User prompt. Required. */
  user: string;
  /** Cap on response tokens. Default 600. */
  maxTokens?: number;
  /** Hard timeout in ms. Default 12000. */
  timeoutMs?: number;
}

export interface LLMResult {
  text: string;
  provider: LLMProvider;
  model: string;
}

const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_TIMEOUT_MS = 12000;

function envProvider(): LLMProvider | null {
  const explicit = (Deno.env.get("LLM_PROVIDER") || "").toLowerCase().trim();
  if (explicit === "ollama") {
    return Deno.env.get("OLLAMA_BASE_URL") ? "ollama" : null;
  }
  if (explicit === "anthropic" || explicit === "") {
    return Deno.env.get("ANTHROPIC_API_KEY") ? "anthropic" : null;
  }
  console.warn(`[llm] unknown LLM_PROVIDER=${explicit}; falling back to env detection`);
  if (Deno.env.get("ANTHROPIC_API_KEY")) return "anthropic";
  if (Deno.env.get("OLLAMA_BASE_URL")) return "ollama";
  return null;
}

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

async function callAnthropic(opts: LLMOptions): Promise<LLMResult | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY") || "";
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";
  if (!key) return null;
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.system) body.system = opts.system;
  const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.warn(`[llm/anthropic] ${r.status}: ${txt.slice(0, 300)}`);
    return null;
  }
  const json = await r.json();
  const text = String(json?.content?.[0]?.text || "");
  return { text, provider: "anthropic", model };
}

async function callOllama(opts: LLMOptions): Promise<LLMResult | null> {
  const baseRaw = Deno.env.get("OLLAMA_BASE_URL") || "";
  const base = baseRaw.replace(/\/+$/, "");
  const model = Deno.env.get("OLLAMA_MODEL") || "llama3.1:8b";
  const auth = Deno.env.get("OLLAMA_API_KEY") || "";
  if (!base) return null;
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers["Authorization"] = `Bearer ${auth}`;
  const r = await fetchTimeout(`${base}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: false,
    }),
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.warn(`[llm/ollama] ${r.status}: ${txt.slice(0, 300)}`);
    return null;
  }
  const json = await r.json();
  const text = String(json?.choices?.[0]?.message?.content || "");
  return { text, provider: "ollama", model };
}

export async function callLLM(opts: LLMOptions): Promise<LLMResult | null> {
  const provider = envProvider();
  if (!provider) return null;
  try {
    if (provider === "ollama") return await callOllama(opts);
    return await callAnthropic(opts);
  } catch (e) {
    console.warn(`[llm/${provider}] threw: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Strip ```json / ``` code fences and parse. Returns null on parse fail.
 * Most prompts in this project ask for raw JSON, but local models love
 * to wrap responses in fences regardless of the instruction.
 */
export function parseLLMJson<T = unknown>(text: string): T | null {
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return null;
  }
}
