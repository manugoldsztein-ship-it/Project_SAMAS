import { useEffect, useState } from "react";

// ============================================================
// FINANCIAL GLOSSARY + INFO BADGE
// ============================================================
// One-stop dictionary of Argentine-market jargon that shows up across
// SAMAS. Each term maps to a 1-2 sentence plain-Spanish explanation. The
// <InfoBadge term="..." /> component renders a tiny tappable (i) pill
// that pops a tooltip with the explanation — no hover required, so it
// works on touch devices too.

export const GLOSSARY = {
  // FX
  MEP:     "Dolar MEP (o bolsa): se obtiene comprando un bono en pesos y vendiendolo contra dolares. Tipicamente el mas usado para dolarizar ahorros.",
  CCL:     "Dolar contado con liquidacion: igual que MEP pero la venta se hace afuera, obteniendo dolares en cuenta en el exterior.",
  Oficial: "Tipo de cambio oficial publicado por el BCRA. Tiene cupo mensual y recargos impositivos para personas fisicas.",

  // Bonds + debt instruments
  CER:     "Coeficiente de Estabilizacion de Referencia: ajuste por inflacion (CPI) que se aplica al capital de ciertos bonos.",
  UVA:     "Unidad de Valor Adquisitivo: ajuste por inflacion como el CER, usada en creditos y plazos fijos UVA.",
  BADLAR:  "Tasa promedio de plazos fijos mayoristas en bancos privados. Benchmark para bonos con tasa variable.",
  LEDES:   "Letras de descuento del Tesoro: instrumento de corto plazo en pesos, se compra bajo la par y vence a 100.",
  LECER:   "Letras en pesos ajustadas por CER: corto plazo con cobertura por inflacion.",
  YTM:     "Yield to Maturity: retorno anual esperado si compras el bono hoy y lo mantenes hasta vencimiento.",
  Paridad: "Precio del bono como porcentaje del valor nominal (100). Por debajo de 100 = bajo la par; arriba = sobre la par.",
  Duration:"Medida de sensibilidad del precio del bono a cambios de tasa. Mas duration = mas volatilidad ante movimientos de tasa.",

  // Equities / funds
  Acciones:"Acciones locales argentinas (ej. GGAL, YPF). Se operan en pesos en el mercado de Buenos Aires (BCBA/BYMA).",
  CEDEAR:  "Certificado que replica una accion del exterior (ej. AAPL) pero se opera en pesos en Argentina. Alternativa a tener cuenta afuera.",
  ETF:     "Fondo cotizado en bolsa: canasta de activos (ej. SPY = S&P 500, QQQ = Nasdaq-100) que se compra como una sola accion.",
  Bonos:   "Deuda soberana argentina: le prestas al Estado y te paga intereses + capital al vencimiento.",
  ON:      "Obligacion Negociable: deuda corporativa. Paga cupon y devuelve el capital al vencimiento, similar a un bono pero emitida por empresas.",
  FCI:     "Fondo Comun de Inversion: cartera administrada profesionalmente. Comprar cuotapartes te da exposicion diversificada.",
  Crypto:  "Criptomonedas como Bitcoin. Alta volatilidad; dentro de SAMAS se opera via CEDEAR o instrumentos referenciados.",
  Cash:    "Efectivo o equivalentes de muy corto plazo (money market). Sirve como reserva de emergencia — liquido, bajo riesgo, bajo retorno.",
};

export function InfoBadge({ term, C, size = 14 }) {
  const [open, setOpen] = useState(false);
  const body = GLOSSARY[term];

  // Close when the user taps anywhere else. We defer the listener by one
  // tick so the same click that opened the tooltip doesn't immediately
  // close it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const id = setTimeout(() => window.addEventListener("click", close, { once: true }), 0);
    return () => { clearTimeout(id); window.removeEventListener("click", close); };
  }, [open]);

  if (!body) return null;
  const iconSize = size;

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); } }}
      role="button"
      aria-label={`Explicar ${term}`}
      tabIndex={0}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: iconSize, height: iconSize,
        borderRadius: iconSize / 2,
        background: (open ? C.accent : C.textMd) + "33",
        color: open ? C.accent : C.textMd,
        fontSize: Math.max(8, iconSize - 5), fontWeight: 800,
        marginLeft: 4,
        cursor: "pointer",
        verticalAlign: "middle",
        position: "relative",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      i
      {open && (
        <span
          className="samas-fade"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 240,
            maxWidth: "min(240px, 80vw)",
            background: C.bg,
            border: "1px solid " + C.border,
            borderRadius: 10,
            padding: "8px 10px",
            fontSize: 11, fontWeight: 500,
            color: C.text,
            lineHeight: 1.45,
            boxShadow: "0 10px 24px rgba(0,0,0,0.4)",
            zIndex: 60,
            textAlign: "left",
            whiteSpace: "normal",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 11, color: C.accent, marginBottom: 3, letterSpacing: 0.5 }}>{term}</div>
          {body}
        </span>
      )}
    </span>
  );
}
