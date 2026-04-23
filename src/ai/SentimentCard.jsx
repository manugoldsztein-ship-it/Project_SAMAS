import { useEffect, useRef, useState } from "react";
import { callSentiment, hasAnthropicKey } from "./client.js";

const ANALYZE_TIMEOUT_MS = 20000;

// ============================================================
// NEWS SENTIMENT CARD
// ============================================================
// Rendered at the top of the Noticias page. Asks Claude to score the
// bullish/bearish/neutral mix of the current headlines and surface 3-5 hot
// topics. Debounces re-fetch when the list changes and the user hasn't
// recently refreshed.
//
// Usage:
//   <SentimentCard posts={news.map(n => ({ title: n.title, body: n.body }))} C={C}/>

export function SentimentCard({ posts = [], C }) {
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [data, setData]         = useState(null);
  const [err, setErr]           = useState(null);
  const [stamp, setStamp]       = useState(null);

  // Keep a fingerprint of the posts so we can invalidate if the feed
  // changes materially.
  const signature = useRef("");
  useEffect(() => {
    signature.current = posts.slice(0, 15).map(p => (p.title || "").slice(0, 40)).join("|");
  }, [posts]);

  // Track mount state so a slow Claude response can't setState on a dead
  // component, and wrap the call in a timeout promise so the spinner
  // doesn't hang forever if the API stalls.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  async function analyze() {
    if (!posts.length || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout: Claude tardo mas de " + (ANALYZE_TIMEOUT_MS / 1000) + "s")), ANALYZE_TIMEOUT_MS)
      );
      const s = await Promise.race([callSentiment(posts), timeout]);
      if (!mountedRef.current) return;
      setData(s);
      setStamp(new Date());
      setOpen(true);
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(e?.message || "Error al analizar el feed");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  return (
    <div style={{
      background: "linear-gradient(135deg, " + C.accent + "18, #2563EB18)",
      border: "1px solid " + C.accent + "44",
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: data ? 10 : 0 }}>
        <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,"+C.accent+",#2563EB)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M7 14l4-4 4 4 5-6"/>
          </svg>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Sentimiento del feed</div>
          <div style={{ fontSize:10, color: hasAnthropicKey() ? C.green : C.gold, fontWeight:600 }}>
            {hasAnthropicKey() ? "Claude · en vivo" : "Modo demo (sin API key)"}
            {stamp && <span style={{ color:C.textLt, fontWeight:500 }}> · {stamp.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" })}</span>}
          </div>
        </div>
        <button
          onClick={analyze}
          disabled={loading || !posts.length}
          style={{
            background: loading ? C.creamDk : (data ? "transparent" : C.accent),
            color: loading ? C.textLt : (data ? C.accent : "#fff"),
            border: data ? "1.5px solid "+C.accent : "none",
            borderRadius: 10,
            padding: "7px 12px",
            fontSize: 11,
            fontWeight: 700,
            cursor: loading || !posts.length ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "Analizando…" : data ? "Refrescar" : "Analizar"}
        </button>
      </div>

      {err && !data && (
        <div style={{ marginTop:10, background:C.red+"18", border:"1px solid "+C.red+"44", color:C.red, borderRadius:10, padding:"8px 10px", fontSize:11 }}>
          {err}
        </div>
      )}

      {data && open && (
        <>
          {/* Bar */}
          <div style={{ display:"flex", height:10, borderRadius:5, overflow:"hidden", marginBottom:8, background:C.creamDk }}>
            <div style={{ width: data.bullish + "%", background: C.green }} title={`Alcista ${data.bullish}%`}/>
            <div style={{ width: data.neutral + "%", background: C.textLt }} title={`Neutral ${data.neutral}%`}/>
            <div style={{ width: data.bearish + "%", background: C.red }} title={`Bajista ${data.bearish}%`}/>
          </div>
          <div style={{ display:"flex", gap:10, marginBottom:10, flexWrap:"wrap" }}>
            <Pill color={C.green} label="Alcista" pct={data.bullish}/>
            <Pill color={C.textLt} label="Neutral" pct={data.neutral}/>
            <Pill color={C.red} label="Bajista" pct={data.bearish}/>
          </div>

          <div style={{ fontSize:12, color:C.text, lineHeight:1.5, marginBottom: data.hotTopics?.length ? 10 : 0 }}>
            {data.summary}
          </div>

          {Array.isArray(data.hotTopics) && data.hotTopics.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>Temas calientes</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {data.hotTopics.map((t, i) => (
                  <span key={i} style={{ background:C.card, border:"1px solid "+C.border, color:C.text, borderRadius:20, padding:"4px 10px", fontSize:11, fontWeight:600 }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!data && !loading && !err && (
        <div style={{ marginTop:10, fontSize:11, color:C.textMd, lineHeight:1.5 }}>
          Tocar <strong style={{ color:C.accent }}>Analizar</strong> para que Claude resuma las noticias de hoy y te diga si el mercado se inclina alcista o bajista.
        </div>
      )}
    </div>
  );
}

function Pill({ color, label, pct }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ width:10, height:10, borderRadius:3, background: color }}/>
      <span style={{ fontSize:11, color:"#9CA3AF", fontWeight:600 }}>{label}</span>
      <span style={{ fontSize:11, fontWeight:800, fontFamily:"monospace", color: color }}>{pct}%</span>
    </div>
  );
}
