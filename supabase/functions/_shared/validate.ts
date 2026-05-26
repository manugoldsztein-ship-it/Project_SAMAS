// ============================================================
// validate.ts (samas-0.4.16) — body size + input sanitization
// ============================================================
// Centralizes the "reject malformed/oversized payloads" rule so
// every Edge Function applies it identically. Three primitives:
//
//   - readJsonBody(req, maxBytes)  — read + parse, with size check
//   - sanitizeString(s, maxLen)    — coerce to string, trim, slice
//   - sanitizeInt(n, min, max, def)— coerce to int in range
//
// MAX_BODY_BYTES default is 32 KB. Most Edge Functions take a few
// short fields; the AI ones may take a list of tickers up to maybe
// 200 entries. 32 KB is far more than that and still well below
// what would matter for memory pressure on a Deno isolate.
//
// The size check rejects with status 413 (Payload Too Large), the
// JSON-parse failure rejects with 400. Both wrap CORS headers from
// the caller.
// ============================================================

export const MAX_BODY_BYTES = 32 * 1024;

// Read the request body as JSON, enforcing a max size. Throws a
// VALIDATION_ERROR with a tagged message; callers should `try`
// and translate into a 400/413 with their CORS headers.
export class ValidationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

export async function readJsonBody(
  req: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<unknown> {
  // Cheap pre-check via Content-Length. Doesn't catch chunked
  // requests without the header but it covers >99% of cases.
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = parseInt(cl, 10);
    if (!isNaN(n) && n > maxBytes) {
      throw new ValidationError(413, `body exceeds ${maxBytes} bytes`);
    }
  }
  const text = await req.text();
  if (text.length > maxBytes) {
    throw new ValidationError(413, `body exceeds ${maxBytes} bytes`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError(400, "invalid JSON");
  }
}

// String coercion + length cap. Use this on every string field
// pulled out of the body before storing/passing along. Empty
// non-strings become "" (not null) so callers can simply `if (!s)`.
export function sanitizeString(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

// Number coercion with bounds. Returns `def` for NaN / out-of-range
// so callers don't have to special-case.
export function sanitizeInt(
  value: unknown,
  min: number,
  max: number,
  def: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

// Translate a ValidationError thrown from readJsonBody into a
// CORS-aware Response. Use in the catch block.
export function validationErrorResponse(
  e: unknown,
  baseHeaders: Record<string, string>,
): Response | null {
  if (e instanceof ValidationError) {
    return new Response(
      JSON.stringify({ error: e.message }),
      {
        status: e.status,
        headers: { ...baseHeaders, "Content-Type": "application/json" },
      },
    );
  }
  return null;
}
