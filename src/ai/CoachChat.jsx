import { useState, useRef, useEffect } from "react";
import { callCoachChat, hasAnthropicKey } from "./client.js";

// ============================================================
// COACH CHAT PANEL
// ============================================================
// Floating "Coach IA" button pinned to the mobile frame. Clicking it opens
// a slide-up panel with a Claude-powered conversation. The user's current
// portfolio (ticker + qty + value) is passed in as context so the coach can
// reference real positions.
//
// Usage (from MobileApp):
//   <CoachChat holdings={holdings} assets={ASSETS} C={C} lang={lang}/>

export function CoachChat({ holdings = [], assets = [], C, lang = "es" }) {
  const [open, setOpen]         = useState(false);
  const [input, setInput]       = useState("");
  const [messages, setMessages] = useState(() => [
    { role: "assistant", content: lang === "en"
      ? "Hi, I'm SAMAS Coach. Ask me anything about your portfolio, a market concept, or an asset category in SAMAS."
      : "Hola, soy SAMAS Coach. Preguntame cualquier cosa de tu portafolio, un concepto de mercado, o una categoria de activos en SAMAS."
    }
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const listRef = useRef(null);
  // Ignore late async results if the user closed the panel mid-fetch.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Auto-scroll the chat list as new messages come in.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  // Escape-to-close — only active while the panel is open.
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open]);

  // Build a compact portfolio snapshot the coach can reference.
  const portfolioCtx = holdings.map(h => {
    const a = assets.find(x => x.ticker === h.ticker);
    return a ? { ticker: h.ticker, qty: h.qty, value: h.qty * a.price } : null;
  }).filter(Boolean);

  const quickPrompts = lang === "en"
    ? [
        "How's my portfolio looking?",
        "Explain CEDEAR in one paragraph",
        "What's the difference between AL30 and GD30?",
        "Build me a conservative plan in pesos",
      ]
    : [
        "Como esta mi portafolio?",
        "Explicame CEDEAR en un parrafo",
        "Que diferencia hay entre AL30 y GD30?",
        "Armame un plan conservador en pesos",
      ];

  async function send(text) {
    const content = (text || input).trim();
    if (!content || busy) return;
    setErr(null);
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout: Claude tardo mas de 25s")), 25000)
      );
      const reply = await Promise.race([callCoachChat(next, { portfolio: portfolioCtx }), timeout]);
      if (!mountedRef.current) return;
      setMessages(m => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e?.message === "NO_KEY"
        ? "Configurar API key en Perfil → Coach IA para usar respuestas reales."
        : (e?.message || "Error al contactar a Claude.");
      setErr(msg);
      setMessages(m => [...m, { role: "assistant", content: "Se me trabo la conexion. " + msg }]);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function reset() {
    setMessages([{ role: "assistant", content: lang === "en"
      ? "Fresh start. What's on your mind?"
      : "Empezamos de nuevo. Que te ronda?"
    }]);
    setErr(null);
  }

  // --- render ---
  return (
    <>
      {/* Floating action button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir Coach IA"
          style={{
            position: "absolute",
            right: 14,
            bottom: 92,          // sits above the tab bar
            zIndex: 35,
            width: 52,
            height: 52,
            borderRadius: 26,
            border: "none",
            cursor: "pointer",
            background: "linear-gradient(135deg, " + C.accent + ", #2563EB)",
            boxShadow: "0 10px 24px rgba(22,199,132,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "inherit",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a5 5 0 0 1 5 5v1a5 5 0 0 1-5 5 5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z"/>
            <path d="M19 13v1a7 7 0 0 1-14 0v-1"/>
            <path d="M12 19v3"/>
            <circle cx="9" cy="8" r="0.8" fill="#fff"/>
            <circle cx="15" cy="8" r="0.8" fill="#fff"/>
          </svg>
          {hasAnthropicKey() ? null : (
            <span style={{ position:"absolute", top:-2, right:-2, width:14, height:14, borderRadius:7, background:C.gold, color:"#0D1117", fontSize:9, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid "+(C.isDark?"#0F0F0F":C.bg) }}>!</span>
          )}
        </button>
      )}

      {open && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            background: "rgba(0,0,0,0.55)",
          }}
        >
          <div onClick={() => setOpen(false)} style={{ flex: 1 }} />
          <div
            style={{
              background: C.bg,
              borderRadius: "20px 20px 0 0",
              height: "82%",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              border: "1px solid " + C.border,
              borderBottom: "none",
            }}
          >
            {/* Handle + header */}
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
              <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2 }} />
            </div>
            <div style={{ padding: "6px 16px 10px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid " + C.border }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: "linear-gradient(135deg, " + C.accent + ", #2563EB)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>SAMAS Coach</div>
                <div style={{ fontSize: 10, color: hasAnthropicKey() ? C.green : C.gold, fontWeight: 600 }}>
                  {hasAnthropicKey()
                    ? (lang === "en" ? "Claude · live" : "Claude · en vivo")
                    : (lang === "en" ? "Demo mode (no API key)" : "Modo demo (sin API key)")}
                </div>
              </div>
              <button onClick={reset} title="Nuevo chat" style={{ background: C.creamDk, border: "1px solid " + C.border, borderRadius: 9, padding: "6px 10px", fontSize: 11, color: C.textMd, cursor: "pointer", fontFamily: "inherit" }}>
                {lang === "en" ? "New" : "Nuevo"}
              </button>
              <button onClick={() => setOpen(false)} title="Cerrar" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: C.textMd }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Message list */}
            <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.map((m, i) => (
                <Bubble key={i} role={m.role} content={m.content} C={C} />
              ))}
              {busy && <TypingBubble C={C} />}
              {err && (
                <div style={{ background: C.red + "18", border: "1px solid " + C.red + "44", color: C.red, borderRadius: 10, padding: "8px 10px", fontSize: 11 }}>
                  {err}
                </div>
              )}
            </div>

            {/* Quick prompts — only on first turn */}
            {messages.length <= 1 && (
              <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {quickPrompts.map(q => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, padding: "6px 10px", fontSize: 11, color: C.textMd, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              style={{ padding: "10px 14px 14px", borderTop: "1px solid " + C.border, display: "flex", gap: 8, alignItems: "flex-end", background: C.bg }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={lang === "en" ? "Ask about your portfolio or markets…" : "Preguntame de tu portafolio o mercados…"}
                rows={1}
                style={{
                  flex: 1, resize: "none", background: C.card, border: "1.5px solid " + C.border,
                  borderRadius: 14, padding: "10px 12px", fontSize: 13, color: C.text, outline: "none",
                  fontFamily: "inherit", maxHeight: 120
                }}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                style={{
                  background: busy || !input.trim() ? C.creamDk : C.accent,
                  color: busy || !input.trim() ? C.textLt : "#fff",
                  border: "none", borderRadius: 14, padding: "0 14px", height: 40, fontWeight: 700,
                  cursor: busy || !input.trim() ? "not-allowed" : "pointer", fontFamily: "inherit"
                }}
              >
                {busy ? "…" : (lang === "en" ? "Send" : "Enviar")}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ role, content, C }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? C.accent : C.card,
          color: isUser ? "#fff" : C.text,
          border: isUser ? "none" : "1px solid " + C.border,
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          padding: "9px 12px",
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {content}
      </div>
    </div>
  );
}

function TypingBubble({ C }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: "14px 14px 14px 4px", padding: "11px 14px", display: "flex", gap: 4 }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 6, height: 6, borderRadius: 3, background: C.textLt,
              animation: `samasDot 1.2s infinite ease-in-out`,
              animationDelay: (i * 0.15) + "s",
              display: "inline-block",
            }}
          />
        ))}
        <style>{`@keyframes samasDot { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); } 40% { opacity: 1; transform: scale(1); } }`}</style>
      </div>
    </div>
  );
}
