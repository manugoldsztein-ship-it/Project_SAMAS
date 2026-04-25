import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
// AI surface is intentionally narrow: one wizard that does compound interest
// projection + income/expenses breakdown + strategy pick. No general chat,
// no sentiment analysis — per product spec the AI's only job is that flow.
import { ObjectivesWizard } from "./ai/ObjectivesWizard.jsx";
import { InfoBadge } from "./ai/glossary.jsx";
import {
  loadAnthropicKey, saveAnthropicKey,
  loadAnthropicModel, saveAnthropicModel,
  DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL,
  testAnthropic,
} from "./ai/client.js";
// Real auth: Supabase session + signup/login/verify-WhatsApp flow. Replaces
// the demo-PIN LoginScreen. See src/auth/SupabaseAuth.jsx for the UI, and
// src/lib/supabase.js for the client configuration.
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./lib/supabase.js";
import { useSupabaseSession, SupabaseAuthFlow } from "./auth/SupabaseAuth.jsx";
// User data: holdings / orders / balance now live in Supabase. The UI
// keeps using the same local state shapes — userData.js is the
// translation + sync layer.
import { loadUserPortfolio, saveHoldings, saveBalance, appendOrder, saveWatchlists, savePlan, clearPlans, saveStopLosses, savePriceAlerts, saveRecurringAporte, savePortfolioHistory, saveLang, saveShowUSD, saveUiDark, saveViewMode } from "./lib/userData.js";
// PIN gate: standard fintech pattern (Brubank, Ualá). Once the user has
// a valid Supabase session, the app still locks on every open behind a
// 4-digit PIN stored hashed in localStorage. Prevents shoulder-surfers
// from getting into the app even if the browser/phone is unlocked.
import { hashPin, PinLockScreen } from "./auth/PinLock.jsx";
// MFA (TOTP). MfaEnrollSection lives in Settings, MfaChallengeView is
// shown post-login when the user's session is AAL1 but they have a
// verified TOTP factor.
import { MfaEnrollSection, MfaChallengeView } from "./auth/Mfa.jsx";
import { fetchNewsForTicker, fetchNewsForTickers, relativeTime } from "./lib/news.js";
import { isNative as isNativeApp, hapticNative } from "./lib/native.js";
// Welcome chooser: shown only on first session when profiles.ui_mode
// is null. User picks "principiante" or "profesional" and the rest
// of the app reads that choice to decide which surfaces to show.
import { WelcomeChooser } from "./auth/WelcomeChooser.jsx";

// ============================================================
// THEME
// ============================================================
function makeTheme(dark) {
  // Official SAMAS palette: #0D1117 navy, #16C784 green, #F7F7F5 off-white,
  // #E5E7EB light gray, #6B7280 medium gray.
  return dark ? {
    bg:"#0D1117", card:"#161B22", card2:"#1F2630", border:"#2A313C",
    navy:"#0D1117", text:"#F7F7F5", textMd:"#9CA3AF", textLt:"#6B7280",
    red:"#E05555", green:"#16C784", gold:"#C9A84C", goldLt:"#E8C97A",
    accent:"#16C784", creamDk:"#1F2630", isDark:true,
  } : {
    bg:"#F7F7F5", card:"#FFFFFF", card2:"#F2F2F0", border:"#E5E7EB",
    navy:"#0D1117", text:"#0D1117", textMd:"#6B7280", textLt:"#9CA3AF",
    red:"#D64545", green:"#16C784", gold:"#C9A84C", goldLt:"#E8C97A",
    accent:"#16C784", creamDk:"#EAEAE6", isDark:false,
  };
}

// ============================================================
// DATA
// ============================================================
const ASSETS = [
  { ticker:"GGAL",   name:"Grupo Galicia",   cat:"Acciones",    price:9240,    change:4.20,  chg1m:12.1,  chgYTD:38.4,  vol:"$12.4M", mktCap:"$4.2B",  hi52:10200,   lo52:4800,    pe:8.2,  up:true,  yf:"GGAL",   desc:"Holding financiero lider en Argentina. Opera bancos, seguros y servicios financieros.", logo:"https://logo.clearbit.com/galiciaseguros.com.ar" },
  { ticker:"YPF",    name:"YPF S.A.",         cat:"Acciones",    price:42500,   change:-1.30, chg1m:5.3,   chgYTD:21.7,  vol:"$8.1M",  mktCap:"$14.1B", hi52:48000,   lo52:18000,   pe:6.4,  up:false, yf:"YPF",    desc:"Principal empresa de energia de Argentina. Exploracion y refinacion de petroleo.", logo:"https://logo.clearbit.com/ypf.com" },
  { ticker:"PAMP",   name:"Pampa Energia",    cat:"Acciones",    price:5610,    change:2.80,  chg1m:8.9,   chgYTD:44.2,  vol:"$5.6M",  mktCap:"$3.8B",  hi52:6200,    lo52:2400,    pe:7.1,  up:true,  yf:"PAM",    desc:"Generadora electrica integrada con activos en gas y petroleo en Argentina.", logo:"https://logo.clearbit.com/pampaenergia.com" },
  { ticker:"BBAR",   name:"BBVA Argentina",   cat:"Acciones",    price:6890,    change:3.10,  chg1m:14.2,  chgYTD:52.1,  vol:"$4.3M",  mktCap:"$2.9B",  hi52:7500,    lo52:2800,    pe:7.8,  up:true,  yf:"BBAR",   desc:"Banco de retail y corporativo. Segundo banco privado mas grande de Argentina.", logo:"https://logo.clearbit.com/bbva.com.ar" },
  { ticker:"ALUA",   name:"Aluar",            cat:"Acciones",    price:1850,    change:1.70,  chg1m:3.4,   chgYTD:18.9,  vol:"$7.2M",  mktCap:"$1.6B",  hi52:2100,    lo52:900,     pe:5.3,  up:true,  yf:"ALUA.BA",desc:"Principal productor de aluminio primario de America Latina.", logo:"https://logo.clearbit.com/aluar.com.ar" },
  { ticker:"MIRG",   name:"Mirgor",           cat:"Acciones",    price:14200,   change:6.40,  chg1m:22.3,  chgYTD:61.8,  vol:"$1.1M",  mktCap:"$0.8B",  hi52:15800,   lo52:5200,    pe:9.4,  up:true,  yf:"MIRG.BA",desc:"Fabricante de electronica de consumo en Tierra del Fuego.", logo:"https://logo.clearbit.com/mirgor.com.ar" },
  { ticker:"AAPL",   name:"Apple Inc.",       cat:"CEDEAR",    price:18400,   change:1.10,  chg1m:3.2,   chgYTD:8.4,   vol:"$6.2M",  mktCap:"$2.9T",  hi52:22000,   lo52:14000,   pe:28.4, up:true,  yf:"AAPL",   desc:"Mayor empresa del mundo por capitalizacion. Disena y vende iPhone, Mac y servicios.", logo:"https://logo.clearbit.com/apple.com" },
  { ticker:"MSFT",   name:"Microsoft Corp.",  cat:"CEDEAR",    price:52100,   change:0.60,  chg1m:2.1,   chgYTD:6.8,   vol:"$4.8M",  mktCap:"$2.7T",  hi52:60000,   lo52:40000,   pe:34.2, up:true,  yf:"MSFT",   desc:"Lider en software empresarial, nube Azure e inteligencia artificial.", logo:"https://logo.clearbit.com/microsoft.com" },
  { ticker:"GOOGL",  name:"Alphabet Inc.",    cat:"CEDEAR",    price:24700,   change:2.30,  chg1m:5.8,   chgYTD:12.3,  vol:"$3.1M",  mktCap:"$2.0T",  hi52:28000,   lo52:18000,   pe:21.8, up:true,  yf:"GOOGL",  desc:"Matriz de Google. Domina busqueda, publicidad digital, YouTube y Android.", logo:"https://logo.clearbit.com/google.com" },
  { ticker:"NVDA",   name:"NVIDIA Corp.",     cat:"CEDEAR",    price:86500,   change:4.70,  chg1m:18.4,  chgYTD:72.1,  vol:"$9.4M",  mktCap:"$2.1T",  hi52:98000,   lo52:42000,   pe:52.3, up:true,  yf:"NVDA",   desc:"Lider mundial en GPUs e IA. Sus chips son el estandar para entrenar modelos de IA.", logo:"https://logo.clearbit.com/nvidia.com" },
  { ticker:"AMZN",   name:"Amazon.com",       cat:"CEDEAR",    price:31200,   change:-0.90, chg1m:1.4,   chgYTD:4.2,   vol:"$2.7M",  mktCap:"$1.6T",  hi52:36000,   lo52:24000,   pe:42.1, up:false, yf:"AMZN",   desc:"Mayor plataforma de e-commerce y lider en cloud computing con AWS.", logo:"https://logo.clearbit.com/amazon.com" },
  { ticker:"TSLA",   name:"Tesla Inc.",       cat:"CEDEAR",    price:38900,   change:-2.10, chg1m:-8.4,  chgYTD:-22.3, vol:"$5.5M",  mktCap:"$0.8T",  hi52:65000,   lo52:30000,   pe:61.4, up:false, yf:"TSLA",   desc:"Pionera en vehiculos electricos y almacenamiento de energia.", logo:"https://logo.clearbit.com/tesla.com" },
  { ticker:"SPY",    name:"S&P 500 ETF",      cat:"ETF",       price:51240,   change:0.62,  chg1m:2.1,   chgYTD:6.8,   vol:"$18.2M", mktCap:"$500B",  hi52:60000,   lo52:42000,   pe:22.1, up:true,  yf:"SPY",    desc:"ETF mas grande del mundo. Replica el S&P 500 con las 500 empresas de EE.UU.", logo:"https://logo.clearbit.com/ssga.com" },
  { ticker:"QQQ",    name:"Nasdaq-100 ETF",   cat:"ETF",       price:43120,   change:0.88,  chg1m:3.4,   chgYTD:9.2,   vol:"$14.1M", mktCap:"$230B",  hi52:50000,   lo52:34000,   pe:28.4, up:true,  yf:"QQQ",    desc:"Replica el Nasdaq-100 con alta concentracion en tecnologia.", logo:"https://logo.clearbit.com/invesco.com" },
  { ticker:"GLD",    name:"Gold ETF",         cat:"Commodity", price:22860,   change:1.24,  chg1m:6.8,   chgYTD:18.4,  vol:"$6.1M",  mktCap:"$68B",   hi52:25000,   lo52:17000,   pe:null, up:true,  yf:"GLD",    desc:"ETF que replica el precio del oro fisico. Cobertura contra inflacion.", logo:"https://logo.clearbit.com/spdrs.com" },
  { ticker:"OIL",    name:"Petroleo WTI",     cat:"Commodity", price:8130,    change:-0.73, chg1m:-3.2,  chgYTD:-8.1,  vol:"$4.2M",  mktCap:"N/A",    hi52:9800,    lo52:6200,    pe:null, up:false, yf:"USO",    desc:"West Texas Intermediate, el referente global del petroleo crudo.", logo:"https://logo.clearbit.com/uscfinvestments.com" },
  { ticker:"COPPER", name:"Cobre",            cat:"Commodity", price:452,     change:2.11,  chg1m:8.4,   chgYTD:14.2,  vol:"$2.1M",  mktCap:"N/A",    hi52:510,     lo52:340,     pe:null, up:true,  yf:"CPER",   desc:"Metal industrial clave. Indicador adelantado de crecimiento economico global.", logo:"https://logo.clearbit.com/usecuritiesinvestments.com" },
  { ticker:"BTC",    name:"Bitcoin",          cat:"Crypto",    price:8342000, change:1.87,  chg1m:12.4,  chgYTD:38.2,  vol:"$24.1M", mktCap:"$1.6T",  hi52:9800000, lo52:4200000, pe:null, up:true,  yf:"BTC-USD",desc:"La primera y mas grande criptomoneda. Reserva de valor digital con 21M monedas.", logo:"https://logo.clearbit.com/bitcoin.org" },
];

const INIT_HOLDINGS = [
  { ticker:"GGAL", qty:500, avg:7800  },
  { ticker:"YPF",  qty:120, avg:38000 },
  { ticker:"ALUA", qty:800, avg:1600  },
  { ticker:"AAPL", qty:60,  avg:16200 },
  { ticker:"NVDA", qty:25,  avg:54000 },
  { ticker:"MSFT", qty:40,  avg:46000 },
];

const FX = [
  { label:"MEP", value:1247.50, up:true,  change:0.8 },
  { label:"CCL", value:1261.30, up:true,  change:1.1 },
  { label:"OF.",  value:1068.00, up:true,  change:0.2 },
];

const NEWS = [
  { id:1,  tickers:["GGAL","BBAR"], cat:"Acciones",    src:"Ambito",      time:"Hace 12 min", title:"Bancos argentinos lideran subas del Merval tras inflacion menor a lo esperado", body:"El sector financiero reacciono positivamente ante la publicacion del IPC de marzo." },
  { id:2,  tickers:["NVDA","QQQ"],  cat:"CEDEAR",    src:"Reuters",     time:"Hace 28 min", title:"NVIDIA supera expectativas; Wall Street sube con fuerza",                       body:"Ingresos record impulsados por la demanda de chips para IA." },
  { id:3,  tickers:["YPF","OIL"],   cat:"Acciones",    src:"Bloomberg",   time:"Hace 45 min", title:"Petroleo sube 2% tras recorte sorpresivo de la OPEP+",                          body:"Arabia Saudita anuncio una reduccion adicional de 500.000 barriles diarios." },
  { id:4,  tickers:["BTC"],         cat:"Crypto",    src:"CoinDesk",    time:"Hace 1h",     title:"Bitcoin alcanza USD 84.000 impulsado por ETFs spot con entradas record",        body:"Los fondos cotizados de Bitcoin acumularon mas de USD 1.200 millones." },
  { id:5,  tickers:["SPY","GLD"],   cat:"ETF",       src:"CNBC",        time:"Hace 1h 20m", title:"Fed mantiene tasas; mercados celebran tono mas dovish de Powell",               body:"El presidente de la Fed senalo que los datos justifican una pausa." },
  { id:6,  tickers:["AAPL","MSFT"], cat:"CEDEAR",    src:"WSJ",         time:"Hace 2h",     title:"Apple y Microsoft suben tras rumores de acuerdo de distribucion de IA",         body:"Ambas companias estudian integrar modelos de lenguaje en sus plataformas." },
  { id:7,  tickers:["PAMP","ALUA"], cat:"Acciones",    src:"El Cronista", time:"Hace 3h",     title:"Energia y materiales basicos recuperan terreno tras desregulacion",             body:"El Gobierno confirmo nuevas medidas de liberalizacion del sector energetico." },
  { id:8,  tickers:["TSLA"],        cat:"CEDEAR",    src:"Bloomberg",   time:"Hace 4h",     title:"Tesla recorta precios en Europa y Asia por cuarto mes consecutivo",             body:"La compañía enfrenta creciente competencia de BYD en los mercados globales." },
];

// ============================================================
// OBLIGACIONES NEGOCIABLES
// ============================================================
const ON_DATA = [
  { ticker:"YPF-ON-D",  name:"YPF ON Serie XLIII", issuer:"YPF S.A.",        currency:"USD", rate:"9.00%", maturity:"2029-07-17", price:99.2,  yield:9.18, rating:"B-",  type:"Hard Dollar", minLot:1000, desc:"Obligacion negociable en dolares de YPF. Cupon semestral." },
  { ticker:"PAM-ON",    name:"Pampa ON Serie 12",   issuer:"Pampa Energia",   currency:"USD", rate:"7.375%",maturity:"2028-07-21", price:97.5,  yield:8.12, rating:"B-",  type:"Hard Dollar", minLot:1000, desc:"ON en dolares de Pampa Energia. Alta liquidez en mercado secundario." },
  { ticker:"IRSA-ON",   name:"IRSA ON 2028",         issuer:"IRSA",           currency:"USD", rate:"8.75%", maturity:"2028-03-22", price:96.8,  yield:9.45, rating:"B-",  type:"Hard Dollar", minLot:1000, desc:"Obligacion negociable de IRSA Propiedades Comerciales." },
  { ticker:"TGS-ON",    name:"TGS ON Serie 9",       issuer:"TGS",            currency:"USD", rate:"6.75%", maturity:"2025-05-02", price:99.8,  yield:6.89, rating:"B",   type:"Hard Dollar", minLot:1000, desc:"Transportadora de Gas del Sur. Vencimiento corto, alta seguridad." },
  { ticker:"MGAL-ON",   name:"Metrogas ON 2026",     issuer:"Metrogas",       currency:"ARS", rate:"UVA+5%",maturity:"2026-10-10", price:102.1, yield:null, rating:"B+",  type:"UVA",         minLot:500,  desc:"ON ajustada por UVA. Proteccion contra inflacion en pesos." },
  { ticker:"SUPV-ON",   name:"Grupo Supervielle ON", issuer:"Supervielle",    currency:"ARS", rate:"BADLAR+3%",maturity:"2026-06-15",price:99.4,yield:null, rating:"B",   type:"Tasa Variable",minLot:500, desc:"ON bancaria con tasa variable. Paga BADLAR + 300 bps." },
];

// ============================================================
// FONDOS COMUNES DE INVERSION
// ============================================================
const FONDOS = [
  { id:"samas-renta",   name:"SAMAS Renta Mixta",     type:"Mixto",          currency:"ARS", tna:94.2,  ytd:38.4,  min:1000,  risk:"Moderado",  manager:"SAMAS", horizonte:"6m+",  desc:"Fondo mixto con exposicion a renta fija y variable local. Horizonte de inversion de 6 meses o mas." },
  { id:"samas-latam",   name:"SAMAS Latam Equities",  type:"Acciones",       currency:"USD", tna:18.4,  ytd:12.1,  min:500,   risk:"Agresivo",  manager:"SAMAS", horizonte:"12m+", desc:"Fondo de acciones latinoamericanas con foco en mercados emergentes." },
  { id:"samas-ahorro",  name:"SAMAS Ahorro Plus",     type:"Money Market",   currency:"ARS", tna:88.5,  ytd:32.1,  min:100,   risk:"Bajo",      manager:"SAMAS", horizonte:"1d+",  desc:"Fondo de inversion inmediata. Disponibilidad en 24hs. Ideal para liquidez." },
  { id:"samas-dolar",   name:"SAMAS Dolar Plus",      type:"Renta Fija USD", currency:"USD", tna:7.8,   ytd:4.2,   min:500,   risk:"Bajo",      manager:"SAMAS", horizonte:"3m+",  desc:"Fondo en dolares con inversion en ON y deuda corporativa de alta calidad." },
  { id:"schroder-arg",  name:"Schroder Argentina",    type:"Acciones",       currency:"ARS", tna:112.4, ytd:48.2,  min:1000,  risk:"Agresivo",  manager:"Schroder",horizonte:"12m+",desc:"Fondo de acciones argentinas con alta exposicion a Merval." },
  { id:"ppi-corp",      name:"PPI Corporativo",       type:"Renta Fija ARS", currency:"ARS", tna:101.2, ytd:41.3,  min:500,   risk:"Moderado",  manager:"PPI",   horizonte:"3m+",  desc:"Renta fija corporativa en pesos. Diversificado en ONs y bonos privados." },
];

// ============================================================
// BONOS SOBERANOS
// ============================================================
const BONOS = [
  { ticker:"AL30",  name:"Bono Soberano AL30",     type:"Hard Dollar", currency:"USD", price:64.2,  ytm:15.8, duration:3.4, maturity:"2030-07-09", rating:"CCC+", paridad:64.2,  desc:"Global 2030. Uno de los bonos mas liquidos del mercado argentino." },
  { ticker:"GD30",  name:"Bono Global GD30",       type:"Hard Dollar", currency:"USD", price:66.8,  ytm:14.9, duration:3.6, maturity:"2030-07-09", rating:"CCC+", paridad:66.8,  desc:"Global 2030 ley extranjera. Mayor liquidez internacional que el AL30." },
  { ticker:"AL35",  name:"Bono Soberano AL35",     type:"Hard Dollar", currency:"USD", price:57.4,  ytm:16.2, duration:5.1, maturity:"2035-07-09", rating:"CCC+", paridad:57.4,  desc:"Global 2035. Duration mas larga, mayor sensibilidad a riesgo pais." },
  { ticker:"GD35",  name:"Bono Global GD35",       type:"Hard Dollar", currency:"USD", price:59.1,  ytm:15.8, duration:5.3, maturity:"2035-07-09", rating:"CCC+", paridad:59.1,  desc:"Global 2035 ley NY. Incluido en indices emergentes." },
  { ticker:"T2X5",  name:"BONCER 2025",             type:"CER",         currency:"ARS", price:102.4, ytm:null, duration:0.8, maturity:"2025-08-14", rating:"B-",   paridad:null,  desc:"Bono CER de corto plazo. Ajuste por inflacion mas tasa real." },
  { ticker:"TX26",  name:"BONCER 2026",             type:"CER",         currency:"ARS", price:98.7,  ytm:null, duration:1.9, maturity:"2026-11-09", rating:"B-",   paridad:null,  desc:"Bono CER de mediano plazo. Buena opcion ante expectativas de inflacion." },
  { ticker:"S31O5", name:"LEDES Oct 2025",          type:"LEDE",        currency:"ARS", price:89.4,  ytm:88.2, duration:0.5, maturity:"2025-10-31", rating:"B-",   paridad:null,  desc:"Letra de descuento. Tasa efectiva anual competitiva en corto plazo." },
];

// ============================================================
// INVESTMENT IDEAS (similar a Balanz)
// ============================================================
const IDEAS = [
  {
    id:1, tag:"IDEA DESTACADA", title:"Cartera Dolarizada Conservadora",
    subtitle:"Proteccion ante volatilidad y devaluacion",
    risk:"Bajo", horizon:"6-12 meses", expReturn:"+8-12% USD",
    color:"#2563EB",
    rationale:"Entorno de normalizacion macroeconomica en Argentina. Posicionarse en activos dolarizados de calidad antes del rally de bonos soberanos.",
    assets:[
      { ticker:"GD30",  pct:30, reason:"Core dolares, alta liquidez" },
      { ticker:"YPF-ON-D", pct:25, reason:"Renta corporativa atractiva" },
      { ticker:"GLD",   pct:20, reason:"Cobertura ante incertidumbre global" },
      { ticker:"SPY",   pct:25, reason:"Exposicion a mercado americano" },
    ]
  },
  {
    id:2, tag:"OPORTUNIDAD", title:"Recovery Trade Merval",
    subtitle:"Acciones argentinas con mayor upside",
    risk:"Agresivo", horizon:"3-6 meses", expReturn:"+30-50% ARS",
    color:"#16C784",
    rationale:"Valuaciones de bancos y energia en minimos historicos. Reforma estructural y apertura cambiaria generan viento de cola para renta variable.",
    assets:[
      { ticker:"GGAL",  pct:30, reason:"Banco con mejor exposicion al ciclo" },
      { ticker:"YPF",   pct:25, reason:"Upside en precio + dividendos" },
      { ticker:"PAMP",  pct:25, reason:"Desregulacion energetica beneficia" },
      { ticker:"BBAR",  pct:20, reason:"Valuacion descontada vs peers" },
    ]
  },
  {
    id:3, tag:"RENTA FIJA", title:"Ladder de ONs High Yield",
    subtitle:"Flujo de fondos en dolares con vencimientos escalonados",
    risk:"Moderado", horizon:"12-24 meses", expReturn:"+8-10% USD",
    color:"#16C784",
    rationale:"Las ONs corporativas argentinas ofrecen spreads atractivos vs comparables regionales. Construccion de ladder reduce riesgo de reinversion.",
    assets:[
      { ticker:"TGS-ON",  pct:35, reason:"Vencimiento corto, menor riesgo" },
      { ticker:"PAM-ON",  pct:35, reason:"Emisor de alta calidad en energia" },
      { ticker:"IRSA-ON", pct:30, reason:"Real estate diversifica exposicion" },
    ]
  },
  {
    id:4, tag:"INFLACION", title:"Cartera Cobertura Inflacionaria",
    subtitle:"Proteccion real en un entorno de alta inflacion",
    risk:"Bajo", horizon:"3-6 meses", expReturn:"CER+5% ARS",
    color:"#C9A84C",
    rationale:"La inflacion mensual se mantiene alta. Los instrumentos CER y UVA ofrecen la mejor cobertura estructural en pesos.",
    assets:[
      { ticker:"TX26",   pct:40, reason:"CER de mediano plazo" },
      { ticker:"MGAL-ON",pct:35, reason:"UVA corporativo, spread adicional" },
      { ticker:"samas-renta",pct:25, reason:"Fondo mixto con cobertura CER" },
    ]
  },
];

// Default demo user. Properties are overwritten on signup (see SignupForm) and
// persisted to localStorage so subsequent sessions keep the created account.
const DEMO_USER = { name:"Usuario Demo", email:"demo@samas.com.ar", initials:"UD", pin:"4821", totpSecret:"SAMASABC123" };
try {
  if (typeof localStorage !== "undefined") {
    const saved = JSON.parse(localStorage.getItem("samas_user") || "null");
    if (saved && typeof saved === "object") Object.assign(DEMO_USER, saved);
  }
} catch {}

function initialsFrom(name) {
  return name.trim().split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();
}
function registerUser({ name, email, pin }) {
  Object.assign(DEMO_USER, { name: name.trim(), email: email.trim().toLowerCase(), initials: initialsFrom(name), pin });
  try { localStorage.setItem("samas_user", JSON.stringify(DEMO_USER)); } catch {}
}

// ============================================================
// LANGUAGES / i18n
// ============================================================
const LANGUAGES = [
  { code:"es", label:"Español",   flag:"ES" },
  { code:"en", label:"English",   flag:"EN" },
  { code:"pt", label:"Português", flag:"PT" },
  { code:"it", label:"Italiano",  flag:"IT" },
  { code:"fr", label:"Français",  flag:"FR" },
  { code:"de", label:"Deutsch",   flag:"DE" },
  { code:"zh", label:"中文",       flag:"ZH" },
  { code:"ru", label:"Русский",   flag:"RU" },
  { code:"ja", label:"日本語",     flag:"JA" },
  { code:"he", label:"עברית",     flag:"HE" },
  { code:"ar", label:"العربية",   flag:"AR" },
  { code:"ko", label:"한국어",     flag:"KO" },
];

// Languages that render right-to-left. Used to flip `dir` on the document
// root so Hebrew / Arabic read naturally.
const RTL_LANGS = ["he", "ar"];

const TRANSLATIONS = {
  es: {
    portfolio:"Portafolio", mercado:"Mercado", noticias:"Noticias", inversiones:"Inversiones", ordenes:"Órdenes", bonos:"Bonos", reportes:"Reportes",
    search:"Buscar activo...", buy:"Comprar", sell:"Vender", cancel:"Cancelar", confirm:"Confirmar", close:"Cerrar", edit:"Editar", save:"Guardar", activate:"Activar", delete:"Eliminar", back:"Atrás", next:"Siguiente", skip:"Saltar", finish:"Terminar",
    total_portfolio:"Cartera Total", invested:"Invertido", gain:"Ganancia", available:"Disponible", distribution:"Distribución", positions:"Posiciones",
    categories:"Categorías", all:"Todos", stocks:"Acciones",
    profile:"Perfil", dark_mode:"Modo oscuro", light_mode:"Modo claro", dark_mode_sub:"Cambiar a tema oscuro", light_mode_sub:"Cambiar a tema claro", devices:"Dispositivos", devices_sub:"4 sesiones activas", tutorial:"Ver tutorial", tutorial_sub:"Recorrido por la app", twofa:"Autenticación 2FA", twofa_sub:"Recomendado · Aumenta la seguridad", twofa_active:"Activada · Authenticator App", logout:"Cerrar sesión", active_session:"Sesión activa", language:"Idioma",
    settings:"Configuración",
    ideas_title:"Ideas de inversión", ideas_sub:"Carteras recomendadas por el equipo SAMAS", inv_title:"Inversiones", inv_sub:"Ideas, productos y fondos",
    trend_title:"Tendencias del día", trend_sub:"Los activos que más se movieron hoy", trend_gainers:"Mayores subas", trend_losers:"Mayores bajas",
    news_title:"Noticias", news_live:"CNBC en vivo", news_demo:"Datos demo", news_loading:"Cargando...", news_refresh:"Actualizar", news_empty:"No hay noticias para este filtro",
    on_title:"Obligaciones Negociables", on_sub:"Deuda corporativa argentina de alta calidad",
    fondos_title:"Fondos Comunes", fondos_sub:"Fondos de inversión profesional",
    bonos_title:"Bonos Soberanos", bonos_sub:"Deuda pública argentina",
    reports_title:"Reportes de Research", reports_sub:"Análisis e informes exclusivos del equipo SAMAS", featured:"DESTACADO", download_pdf:"Descargar PDF", download:"Descargar", pages:"páginas",
    market_no_results:"Sin resultados",
    order_history:"Historial", no_orders:"Aún no operaste nada", executed:"Ejecutada",
    open_devices:"Dispositivos conectados", remote_logout:"Cerrar todas las demás sesiones", device_active:"ACTIVO", device_active_now:"dispositivo activo ahora mismo",
  },
  en: {
    portfolio:"Portfolio", mercado:"Market", noticias:"News", inversiones:"Investments", ordenes:"Orders", bonos:"Bonds", reportes:"Reports",
    search:"Search asset...", buy:"Buy", sell:"Sell", cancel:"Cancel", confirm:"Confirm", close:"Close", edit:"Edit", save:"Save", activate:"Activate", delete:"Delete", back:"Back", next:"Next", skip:"Skip", finish:"Finish",
    total_portfolio:"Total Portfolio", invested:"Invested", gain:"Gain", available:"Available", distribution:"Distribution", positions:"Holdings",
    categories:"Categories", all:"All", stocks:"Stocks",
    profile:"Profile", dark_mode:"Dark mode", light_mode:"Light mode", dark_mode_sub:"Switch to dark theme", light_mode_sub:"Switch to light theme", devices:"Devices", devices_sub:"4 active sessions", tutorial:"View tutorial", tutorial_sub:"App walkthrough", twofa:"2FA Authentication", twofa_sub:"Recommended - Improves security", twofa_active:"Enabled - Authenticator App", logout:"Log out", active_session:"Active session", language:"Language",
    settings:"Settings",
    ideas_title:"Investment Ideas", ideas_sub:"Portfolios recommended by the SAMAS team", inv_title:"Investments", inv_sub:"Ideas, products and funds",
    trend_title:"Today's trending", trend_sub:"The assets that moved the most today", trend_gainers:"Top gainers", trend_losers:"Top losers",
    news_title:"News", news_live:"CNBC live", news_demo:"Demo data", news_loading:"Loading...", news_refresh:"Refresh", news_empty:"No news for this filter",
    on_title:"Corporate Bonds", on_sub:"Argentine high-quality corporate debt",
    fondos_title:"Mutual Funds", fondos_sub:"Professional investment funds",
    bonos_title:"Sovereign Bonds", bonos_sub:"Argentine public debt",
    reports_title:"Research Reports", reports_sub:"Exclusive analysis and reports from the SAMAS team", featured:"FEATURED", download_pdf:"Download PDF", download:"Download", pages:"pages",
    market_no_results:"No results",
    order_history:"History", no_orders:"You haven't traded yet", executed:"Executed",
    open_devices:"Connected devices", remote_logout:"Close all other sessions", device_active:"ACTIVE", device_active_now:"device active right now",
  },
  pt: {
    portfolio:"Portfólio", mercado:"Mercado", noticias:"Notícias", inversiones:"Investimentos", ordenes:"Ordens", bonos:"Títulos", reportes:"Relatórios",
    search:"Buscar ativo...", buy:"Comprar", sell:"Vender", cancel:"Cancelar", confirm:"Confirmar", close:"Fechar", edit:"Editar", save:"Salvar", activate:"Ativar", delete:"Excluir", back:"Voltar", next:"Próximo", skip:"Pular", finish:"Concluir",
    total_portfolio:"Carteira Total", invested:"Investido", gain:"Ganho", available:"Disponível", distribution:"Distribuição", positions:"Posições",
    categories:"Categorias", all:"Todos", stocks:"Ações",
    profile:"Perfil", dark_mode:"Modo escuro", light_mode:"Modo claro", dark_mode_sub:"Mudar para tema escuro", light_mode_sub:"Mudar para tema claro", devices:"Dispositivos", devices_sub:"4 sessões ativas", tutorial:"Ver tutorial", tutorial_sub:"Tour pelo app", twofa:"Autenticação 2FA", twofa_sub:"Recomendado · Aumenta a segurança", twofa_active:"Ativado · Authenticator App", logout:"Sair", active_session:"Sessão ativa", language:"Idioma",
    settings:"Configurações",
    ideas_title:"Ideias de investimento", ideas_sub:"Carteiras recomendadas pela equipe SAMAS", inv_title:"Investimentos", inv_sub:"Ideias, produtos e fundos",
    trend_title:"Tendências de hoje", trend_sub:"Os ativos que mais se moveram hoje", trend_gainers:"Maiores altas", trend_losers:"Maiores baixas",
    news_title:"Notícias", news_live:"CNBC ao vivo", news_demo:"Dados demo", news_loading:"Carregando...", news_refresh:"Atualizar", news_empty:"Sem notícias para este filtro",
    on_title:"Debêntures", on_sub:"Dívida corporativa argentina de alta qualidade",
    fondos_title:"Fundos de Investimento", fondos_sub:"Fundos de investimento profissional",
    bonos_title:"Títulos Soberanos", bonos_sub:"Dívida pública argentina",
    reports_title:"Relatórios de Pesquisa", reports_sub:"Análises e relatórios exclusivos da equipe SAMAS", featured:"DESTAQUE", download_pdf:"Baixar PDF", download:"Baixar", pages:"páginas",
    market_no_results:"Sem resultados",
    order_history:"Histórico", no_orders:"Você ainda não operou nada", executed:"Executada",
    open_devices:"Dispositivos conectados", remote_logout:"Encerrar todas as outras sessões", device_active:"ATIVO", device_active_now:"dispositivo ativo agora mesmo",
  },
  it: {
    portfolio:"Portafoglio", mercado:"Mercato", noticias:"Notizie", inversiones:"Investimenti", ordenes:"Ordini", bonos:"Obbligazioni", reportes:"Report",
    search:"Cerca asset...", buy:"Compra", sell:"Vendi", cancel:"Annulla", confirm:"Conferma", close:"Chiudi", edit:"Modifica", save:"Salva", activate:"Attiva", delete:"Elimina", back:"Indietro", next:"Avanti", skip:"Salta", finish:"Fine",
    total_portfolio:"Portafoglio totale", invested:"Investito", gain:"Guadagno", available:"Disponibile", distribution:"Distribuzione", positions:"Posizioni",
    categories:"Categorie", all:"Tutti", stocks:"Azioni",
    profile:"Profilo", dark_mode:"Modalità scura", light_mode:"Modalità chiara", dark_mode_sub:"Passa al tema scuro", light_mode_sub:"Passa al tema chiaro", devices:"Dispositivi", devices_sub:"4 sessioni attive", tutorial:"Guarda il tutorial", tutorial_sub:"Tour dell'app", twofa:"Autenticazione 2FA", twofa_sub:"Consigliato · Aumenta la sicurezza", twofa_active:"Attiva · App Authenticator", logout:"Esci", active_session:"Sessione attiva", language:"Lingua",
    settings:"Impostazioni",
    ideas_title:"Idee di investimento", ideas_sub:"Portafogli consigliati dal team SAMAS", inv_title:"Investimenti", inv_sub:"Idee, prodotti e fondi",
    trend_title:"Tendenze di oggi", trend_sub:"Gli asset che si sono mossi di più oggi", trend_gainers:"Maggiori rialzi", trend_losers:"Maggiori ribassi",
    news_title:"Notizie", news_live:"CNBC in diretta", news_demo:"Dati demo", news_loading:"Caricamento...", news_refresh:"Aggiorna", news_empty:"Nessuna notizia per questo filtro",
    on_title:"Obbligazioni corporate", on_sub:"Debito corporate argentino di alta qualità",
    fondos_title:"Fondi comuni", fondos_sub:"Fondi di investimento professionali",
    bonos_title:"Titoli di Stato", bonos_sub:"Debito pubblico argentino",
    reports_title:"Report di ricerca", reports_sub:"Analisi e report esclusivi del team SAMAS", featured:"IN EVIDENZA", download_pdf:"Scarica PDF", download:"Scarica", pages:"pagine",
    market_no_results:"Nessun risultato",
    order_history:"Cronologia", no_orders:"Non hai ancora negoziato nulla", executed:"Eseguita",
    open_devices:"Dispositivi connessi", remote_logout:"Chiudi tutte le altre sessioni", device_active:"ATTIVO", device_active_now:"dispositivo attivo adesso",
  },
  fr: {
    portfolio:"Portefeuille", mercado:"Marché", noticias:"Actualités", inversiones:"Investissements", ordenes:"Ordres", bonos:"Obligations", reportes:"Rapports",
    search:"Rechercher un actif...", buy:"Acheter", sell:"Vendre", cancel:"Annuler", confirm:"Confirmer", close:"Fermer", edit:"Modifier", save:"Enregistrer", activate:"Activer", delete:"Supprimer", back:"Retour", next:"Suivant", skip:"Passer", finish:"Terminer",
    total_portfolio:"Portefeuille total", invested:"Investi", gain:"Gain", available:"Disponible", distribution:"Répartition", positions:"Positions",
    categories:"Catégories", all:"Tous", stocks:"Actions",
    profile:"Profil", dark_mode:"Mode sombre", light_mode:"Mode clair", dark_mode_sub:"Passer au thème sombre", light_mode_sub:"Passer au thème clair", devices:"Appareils", devices_sub:"4 sessions actives", tutorial:"Voir le tutoriel", tutorial_sub:"Visite de l'app", twofa:"Authentification 2FA", twofa_sub:"Recommandé · Améliore la sécurité", twofa_active:"Activée · App Authenticator", logout:"Se déconnecter", active_session:"Session active", language:"Langue",
    settings:"Paramètres",
    ideas_title:"Idées d'investissement", ideas_sub:"Portefeuilles recommandés par l'équipe SAMAS", inv_title:"Investissements", inv_sub:"Idées, produits et fonds",
    trend_title:"Tendances du jour", trend_sub:"Les actifs qui ont le plus bougé aujourd'hui", trend_gainers:"Plus fortes hausses", trend_losers:"Plus fortes baisses",
    news_title:"Actualités", news_live:"CNBC en direct", news_demo:"Données démo", news_loading:"Chargement...", news_refresh:"Actualiser", news_empty:"Aucune actualité pour ce filtre",
    on_title:"Obligations d'entreprise", on_sub:"Dette corporate argentine de haute qualité",
    fondos_title:"Fonds communs", fondos_sub:"Fonds d'investissement professionnels",
    bonos_title:"Obligations d'État", bonos_sub:"Dette publique argentine",
    reports_title:"Rapports de recherche", reports_sub:"Analyses et rapports exclusifs de l'équipe SAMAS", featured:"À LA UNE", download_pdf:"Télécharger le PDF", download:"Télécharger", pages:"pages",
    market_no_results:"Aucun résultat",
    order_history:"Historique", no_orders:"Vous n'avez encore rien négocié", executed:"Exécutée",
    open_devices:"Appareils connectés", remote_logout:"Fermer toutes les autres sessions", device_active:"ACTIF", device_active_now:"appareil actif maintenant",
  },
  de: {
    portfolio:"Portfolio", mercado:"Markt", noticias:"Nachrichten", inversiones:"Anlagen", ordenes:"Aufträge", bonos:"Anleihen", reportes:"Berichte",
    search:"Asset suchen...", buy:"Kaufen", sell:"Verkaufen", cancel:"Abbrechen", confirm:"Bestätigen", close:"Schließen", edit:"Bearbeiten", save:"Speichern", activate:"Aktivieren", delete:"Löschen", back:"Zurück", next:"Weiter", skip:"Überspringen", finish:"Fertig",
    total_portfolio:"Gesamtportfolio", invested:"Investiert", gain:"Gewinn", available:"Verfügbar", distribution:"Verteilung", positions:"Positionen",
    categories:"Kategorien", all:"Alle", stocks:"Aktien",
    profile:"Profil", dark_mode:"Dunkler Modus", light_mode:"Heller Modus", dark_mode_sub:"Zum dunklen Thema wechseln", light_mode_sub:"Zum hellen Thema wechseln", devices:"Geräte", devices_sub:"4 aktive Sitzungen", tutorial:"Tutorial ansehen", tutorial_sub:"App-Rundgang", twofa:"2FA-Authentifizierung", twofa_sub:"Empfohlen · Erhöht die Sicherheit", twofa_active:"Aktiviert · Authenticator-App", logout:"Abmelden", active_session:"Aktive Sitzung", language:"Sprache",
    settings:"Einstellungen",
    ideas_title:"Anlageideen", ideas_sub:"Vom SAMAS-Team empfohlene Portfolios", inv_title:"Anlagen", inv_sub:"Ideen, Produkte und Fonds",
    trend_title:"Trends des Tages", trend_sub:"Die Werte mit der stärksten Bewegung heute", trend_gainers:"Top-Gewinner", trend_losers:"Top-Verlierer",
    news_title:"Nachrichten", news_live:"CNBC live", news_demo:"Demo-Daten", news_loading:"Wird geladen...", news_refresh:"Aktualisieren", news_empty:"Keine Nachrichten für diesen Filter",
    on_title:"Unternehmensanleihen", on_sub:"Hochwertige argentinische Unternehmensschulden",
    fondos_title:"Investmentfonds", fondos_sub:"Professionelle Investmentfonds",
    bonos_title:"Staatsanleihen", bonos_sub:"Argentinische Staatsschulden",
    reports_title:"Research-Berichte", reports_sub:"Exklusive Analysen und Berichte des SAMAS-Teams", featured:"EMPFOHLEN", download_pdf:"PDF herunterladen", download:"Herunterladen", pages:"Seiten",
    market_no_results:"Keine Ergebnisse",
    order_history:"Verlauf", no_orders:"Sie haben noch nichts gehandelt", executed:"Ausgeführt",
    open_devices:"Verbundene Geräte", remote_logout:"Alle anderen Sitzungen schließen", device_active:"AKTIV", device_active_now:"Gerät gerade aktiv",
  },
  zh: {
    portfolio:"投资组合", mercado:"市场", noticias:"新闻", inversiones:"投资", ordenes:"订单", bonos:"债券", reportes:"报告",
    search:"搜索资产...", buy:"买入", sell:"卖出", cancel:"取消", confirm:"确认", close:"关闭", edit:"编辑", save:"保存", activate:"启用", delete:"删除", back:"返回", next:"下一步", skip:"跳过", finish:"完成",
    total_portfolio:"总资产", invested:"已投资", gain:"收益", available:"可用", distribution:"分布", positions:"持仓",
    categories:"分类", all:"全部", stocks:"股票",
    profile:"个人资料", dark_mode:"深色模式", light_mode:"浅色模式", dark_mode_sub:"切换到深色主题", light_mode_sub:"切换到浅色主题", devices:"设备", devices_sub:"4 个活动会话", tutorial:"查看教程", tutorial_sub:"应用导览", twofa:"双重认证", twofa_sub:"推荐 - 提升安全性", twofa_active:"已启用 - 身份验证器应用", logout:"退出登录", active_session:"活动会话", language:"语言",
    settings:"设置",
    ideas_title:"投资想法", ideas_sub:"SAMAS 团队推荐的投资组合", inv_title:"投资", inv_sub:"想法、产品和基金",
    trend_title:"今日趋势", trend_sub:"今天波动最大的资产", trend_gainers:"涨幅榜", trend_losers:"跌幅榜",
    news_title:"新闻", news_live:"CNBC 直播", news_demo:"演示数据", news_loading:"加载中...", news_refresh:"刷新", news_empty:"此筛选下暂无新闻",
    on_title:"公司债", on_sub:"阿根廷高质量公司债",
    fondos_title:"共同基金", fondos_sub:"专业投资基金",
    bonos_title:"主权债", bonos_sub:"阿根廷公共债务",
    reports_title:"研究报告", reports_sub:"SAMAS 团队独家分析与报告", featured:"精选", download_pdf:"下载 PDF", download:"下载", pages:"页",
    market_no_results:"无结果",
    order_history:"历史", no_orders:"您还没有交易过", executed:"已执行",
    open_devices:"已连接的设备", remote_logout:"关闭所有其他会话", device_active:"活跃", device_active_now:"设备当前在线",
  },
  ru: {
    portfolio:"Портфель", mercado:"Рынок", noticias:"Новости", inversiones:"Инвестиции", ordenes:"Ордера", bonos:"Облигации", reportes:"Отчеты",
    search:"Поиск актива...", buy:"Купить", sell:"Продать", cancel:"Отмена", confirm:"Подтвердить", close:"Закрыть", edit:"Изменить", save:"Сохранить", activate:"Активировать", delete:"Удалить", back:"Назад", next:"Далее", skip:"Пропустить", finish:"Готово",
    total_portfolio:"Общий портфель", invested:"Вложено", gain:"Прибыль", available:"Доступно", distribution:"Распределение", positions:"Позиции",
    categories:"Категории", all:"Все", stocks:"Акции",
    profile:"Профиль", dark_mode:"Темная тема", light_mode:"Светлая тема", dark_mode_sub:"Переключить на темную тему", light_mode_sub:"Переключить на светлую тему", devices:"Устройства", devices_sub:"4 активные сессии", tutorial:"Посмотреть обучение", tutorial_sub:"Обзор приложения", twofa:"Двухфакторная аутентификация", twofa_sub:"Рекомендуется - повышает безопасность", twofa_active:"Включено - Authenticator App", logout:"Выйти", active_session:"Активная сессия", language:"Язык",
    settings:"Настройки",
    ideas_title:"Инвестиционные идеи", ideas_sub:"Портфели, рекомендованные командой SAMAS", inv_title:"Инвестиции", inv_sub:"Идеи, продукты и фонды",
    trend_title:"Тренды дня", trend_sub:"Активы с наибольшим движением сегодня", trend_gainers:"Лидеры роста", trend_losers:"Лидеры падения",
    news_title:"Новости", news_live:"CNBC в прямом эфире", news_demo:"Демо-данные", news_loading:"Загрузка...", news_refresh:"Обновить", news_empty:"Нет новостей по этому фильтру",
    on_title:"Корпоративные облигации", on_sub:"Качественный корпоративный долг Аргентины",
    fondos_title:"Инвестиционные фонды", fondos_sub:"Профессиональные инвестиционные фонды",
    bonos_title:"Государственные облигации", bonos_sub:"Государственный долг Аргентины",
    reports_title:"Аналитические отчеты", reports_sub:"Эксклюзивные анализы и отчеты команды SAMAS", featured:"ВЫБОР", download_pdf:"Скачать PDF", download:"Скачать", pages:"стр.",
    market_no_results:"Нет результатов",
    order_history:"История", no_orders:"Вы еще не торговали", executed:"Исполнено",
    open_devices:"Подключенные устройства", remote_logout:"Закрыть все другие сессии", device_active:"АКТИВНО", device_active_now:"устройство активно сейчас",
  },
  ja: {
    portfolio:"ポートフォリオ", mercado:"マーケット", noticias:"ニュース", inversiones:"投資", ordenes:"注文", bonos:"債券", reportes:"レポート",
    search:"銘柄を検索...", buy:"買い", sell:"売り", cancel:"キャンセル", confirm:"確認", close:"閉じる", edit:"編集", save:"保存", activate:"有効化", delete:"削除", back:"戻る", next:"次へ", skip:"スキップ", finish:"完了",
    total_portfolio:"総資産", invested:"投資額", gain:"損益", available:"利用可能", distribution:"配分", positions:"保有銘柄",
    categories:"カテゴリー", all:"すべて", stocks:"株式",
    profile:"プロフィール", dark_mode:"ダークモード", light_mode:"ライトモード", dark_mode_sub:"ダークテーマに切り替え", light_mode_sub:"ライトテーマに切り替え", devices:"デバイス", devices_sub:"4 件のアクティブセッション", tutorial:"チュートリアルを見る", tutorial_sub:"アプリの案内", twofa:"2 段階認証", twofa_sub:"推奨 - セキュリティを強化", twofa_active:"有効 - Authenticator アプリ", logout:"ログアウト", active_session:"アクティブなセッション", language:"言語",
    settings:"設定",
    ideas_title:"投資アイデア", ideas_sub:"SAMAS チームのおすすめポートフォリオ", inv_title:"投資", inv_sub:"アイデア・商品・ファンド",
    trend_title:"今日のトレンド", trend_sub:"本日もっとも動いた銘柄", trend_gainers:"値上がり率", trend_losers:"値下がり率",
    news_title:"ニュース", news_live:"CNBC ライブ", news_demo:"デモデータ", news_loading:"読み込み中...", news_refresh:"更新", news_empty:"このフィルターに該当するニュースはありません",
    on_title:"社債", on_sub:"アルゼンチンの高品質な社債",
    fondos_title:"投資信託", fondos_sub:"プロ向け投資ファンド",
    bonos_title:"国債", bonos_sub:"アルゼンチン国債",
    reports_title:"リサーチレポート", reports_sub:"SAMAS チームによる独占分析とレポート", featured:"注目", download_pdf:"PDF をダウンロード", download:"ダウンロード", pages:"ページ",
    market_no_results:"該当なし",
    order_history:"履歴", no_orders:"まだ取引がありません", executed:"約定済み",
    open_devices:"接続中のデバイス", remote_logout:"他のすべてのセッションを閉じる", device_active:"アクティブ", device_active_now:"現在アクティブ",
  },
  he: {
    portfolio:"תיק", mercado:"שוק", noticias:"חדשות", inversiones:"השקעות", ordenes:"פקודות", bonos:"אגרות חוב", reportes:"דוחות",
    search:"חפש נכס...", buy:"קנה", sell:"מכור", cancel:"בטל", confirm:"אשר", close:"סגור", edit:"ערוך", save:"שמור", activate:"הפעל", delete:"מחק", back:"חזור", next:"הבא", skip:"דלג", finish:"סיום",
    total_portfolio:"תיק כולל", invested:"הושקע", gain:"רווח", available:"זמין", distribution:"התפלגות", positions:"פוזיציות",
    categories:"קטגוריות", all:"הכל", stocks:"מניות",
    profile:"פרופיל", dark_mode:"מצב כהה", light_mode:"מצב בהיר", dark_mode_sub:"עבור לערכה כהה", light_mode_sub:"עבור לערכה בהירה", devices:"מכשירים", devices_sub:"4 הפעלות פעילות", tutorial:"צפה במדריך", tutorial_sub:"סיור באפליקציה", twofa:"אימות דו-שלבי", twofa_sub:"מומלץ - משפר אבטחה", twofa_active:"מופעל - אפליקציית Authenticator", logout:"התנתק", active_session:"הפעלה פעילה", language:"שפה",
    settings:"הגדרות",
    ideas_title:"רעיונות השקעה", ideas_sub:"תיקים מומלצים על ידי צוות SAMAS", inv_title:"השקעות", inv_sub:"רעיונות, מוצרים וקרנות",
    trend_title:"מגמות היום", trend_sub:"הנכסים שזזו הכי הרבה היום", trend_gainers:"עליות מובילות", trend_losers:"ירידות מובילות",
    news_title:"חדשות", news_live:"CNBC בשידור חי", news_demo:"נתוני דמו", news_loading:"טוען...", news_refresh:"רענן", news_empty:"אין חדשות למסנן זה",
    on_title:"אגרות חוב קונצרניות", on_sub:"חוב קונצרני ארגנטינאי באיכות גבוהה",
    fondos_title:"קרנות נאמנות", fondos_sub:"קרנות השקעה מקצועיות",
    bonos_title:"אגרות חוב ממשלתיות", bonos_sub:"חוב ציבורי ארגנטינאי",
    reports_title:"דוחות מחקר", reports_sub:"ניתוחים ודוחות בלעדיים של צוות SAMAS", featured:"מומלץ", download_pdf:"הורד PDF", download:"הורד", pages:"עמודים",
    market_no_results:"אין תוצאות",
    order_history:"היסטוריה", no_orders:"עדיין לא ביצעת עסקה", executed:"בוצעה",
    open_devices:"מכשירים מחוברים", remote_logout:"סגור את כל שאר ההפעלות", device_active:"פעיל", device_active_now:"מכשיר פעיל כרגע",
  },
  ar: {
    portfolio:"المحفظة", mercado:"السوق", noticias:"الأخبار", inversiones:"الاستثمارات", ordenes:"الأوامر", bonos:"السندات", reportes:"التقارير",
    search:"ابحث عن أصل...", buy:"شراء", sell:"بيع", cancel:"إلغاء", confirm:"تأكيد", close:"إغلاق", edit:"تعديل", save:"حفظ", activate:"تفعيل", delete:"حذف", back:"رجوع", next:"التالي", skip:"تخطي", finish:"إنهاء",
    total_portfolio:"إجمالي المحفظة", invested:"المُستثمر", gain:"الربح", available:"المتاح", distribution:"التوزيع", positions:"المراكز",
    categories:"الفئات", all:"الكل", stocks:"الأسهم",
    profile:"الملف الشخصي", dark_mode:"الوضع الداكن", light_mode:"الوضع الفاتح", dark_mode_sub:"التبديل إلى السمة الداكنة", light_mode_sub:"التبديل إلى السمة الفاتحة", devices:"الأجهزة", devices_sub:"4 جلسات نشطة", tutorial:"عرض البرنامج التعليمي", tutorial_sub:"جولة في التطبيق", twofa:"المصادقة الثنائية", twofa_sub:"موصى به - يعزز الأمان", twofa_active:"مفعّل - تطبيق المصادقة", logout:"تسجيل الخروج", active_session:"جلسة نشطة", language:"اللغة",
    settings:"الإعدادات",
    ideas_title:"أفكار استثمارية", ideas_sub:"محافظ موصى بها من فريق SAMAS", inv_title:"الاستثمارات", inv_sub:"أفكار ومنتجات وصناديق",
    trend_title:"اتجاهات اليوم", trend_sub:"الأصول الأكثر تحركاً اليوم", trend_gainers:"أكبر الرابحين", trend_losers:"أكبر الخاسرين",
    news_title:"الأخبار", news_live:"CNBC مباشر", news_demo:"بيانات تجريبية", news_loading:"جارٍ التحميل...", news_refresh:"تحديث", news_empty:"لا توجد أخبار لهذا الفلتر",
    on_title:"السندات الشركات", on_sub:"ديون شركات أرجنتينية عالية الجودة",
    fondos_title:"صناديق الاستثمار", fondos_sub:"صناديق استثمار احترافية",
    bonos_title:"السندات السيادية", bonos_sub:"ديون عامة أرجنتينية",
    reports_title:"تقارير الأبحاث", reports_sub:"تحليلات وتقارير حصرية من فريق SAMAS", featured:"مميز", download_pdf:"تنزيل PDF", download:"تنزيل", pages:"صفحات",
    market_no_results:"لا توجد نتائج",
    order_history:"السجل", no_orders:"لم تتداول بعد", executed:"مُنفّذ",
    open_devices:"الأجهزة المتصلة", remote_logout:"إغلاق جميع الجلسات الأخرى", device_active:"نشط", device_active_now:"جهاز نشط الآن",
  },
  ko: {
    portfolio:"포트폴리오", mercado:"시장", noticias:"뉴스", inversiones:"투자", ordenes:"주문", bonos:"채권", reportes:"리포트",
    search:"종목 검색...", buy:"매수", sell:"매도", cancel:"취소", confirm:"확인", close:"닫기", edit:"편집", save:"저장", activate:"활성화", delete:"삭제", back:"뒤로", next:"다음", skip:"건너뛰기", finish:"완료",
    total_portfolio:"총 자산", invested:"투자 원금", gain:"수익", available:"사용 가능", distribution:"비중", positions:"보유 종목",
    categories:"카테고리", all:"전체", stocks:"주식",
    profile:"프로필", dark_mode:"다크 모드", light_mode:"라이트 모드", dark_mode_sub:"다크 테마로 전환", light_mode_sub:"라이트 테마로 전환", devices:"디바이스", devices_sub:"4개의 활성 세션", tutorial:"튜토리얼 보기", tutorial_sub:"앱 둘러보기", twofa:"2단계 인증", twofa_sub:"권장 - 보안 강화", twofa_active:"활성화됨 - 인증 앱", logout:"로그아웃", active_session:"활성 세션", language:"언어",
    settings:"설정",
    ideas_title:"투자 아이디어", ideas_sub:"SAMAS 팀이 추천하는 포트폴리오", inv_title:"투자", inv_sub:"아이디어, 상품 및 펀드",
    trend_title:"오늘의 트렌드", trend_sub:"오늘 가장 많이 움직인 종목", trend_gainers:"상승 상위", trend_losers:"하락 상위",
    news_title:"뉴스", news_live:"CNBC 라이브", news_demo:"데모 데이터", news_loading:"로드 중...", news_refresh:"새로고침", news_empty:"해당 필터에 대한 뉴스가 없습니다",
    on_title:"회사채", on_sub:"고품질 아르헨티나 회사채",
    fondos_title:"펀드", fondos_sub:"전문 투자 펀드",
    bonos_title:"국채", bonos_sub:"아르헨티나 공공 부채",
    reports_title:"리서치 리포트", reports_sub:"SAMAS 팀의 독점 분석 및 리포트", featured:"추천", download_pdf:"PDF 다운로드", download:"다운로드", pages:"페이지",
    market_no_results:"결과 없음",
    order_history:"기록", no_orders:"아직 거래하지 않았습니다", executed:"체결됨",
    open_devices:"연결된 디바이스", remote_logout:"다른 모든 세션 종료", device_active:"활성", device_active_now:"현재 활성 디바이스",
  },
};

function useT(lang) {
  return (key) => (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.es[key] || key;
}

// usePersistedState — drop-in useState that mirrors value to localStorage.
// If the key is present on mount, initial value is taken from storage; on
// every update the value is re-serialized. Wrapped in try/catch so the app
// still works in private-browsing or environments without localStorage.
function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      if (typeof localStorage === "undefined") return initialValue;
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return initialValue;
      return JSON.parse(raw);
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

// Error boundary so one broken component doesn't take down the whole app.
// React functional components can't catch errors — this has to be a class.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("[SAMAS] component crash:", error, info?.componentStack);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:20, background:"#080808", color:"#F7F7F5", fontFamily:"Sora,sans-serif" }}>
          <div style={{ maxWidth:420, textAlign:"center" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>⚠️</div>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:10 }}>Algo se rompio</h2>
            <p style={{ fontSize:14, color:"#9CA3AF", lineHeight:1.5, marginBottom:20 }}>
              Se cayo una parte de la app. Tus datos en localStorage siguen a salvo. Proba reintentar; si sigue fallando, recarga la pagina.
            </p>
            <pre style={{ background:"#161B22", border:"1px solid #2A313C", borderRadius:10, padding:"10px 12px", fontSize:11, color:"#E05555", whiteSpace:"pre-wrap", wordBreak:"break-word", textAlign:"left", marginBottom:20, maxHeight:140, overflowY:"auto" }}>{String(this.state.error?.message || this.state.error)}</pre>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button onClick={this.reset} style={{ background:"#16C784", color:"#fff", border:"none", borderRadius:10, padding:"10px 18px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Reintentar</button>
              <button onClick={() => window.location.reload()} style={{ background:"transparent", color:"#9CA3AF", border:"1px solid #2A313C", borderRadius:10, padding:"10px 18px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Recargar</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Global Escape-to-close helper. Pass the handler that should fire when the
// user presses Esc while the modal is open. Null/undefined handler = no-op.
// Kept tiny and dependency-lean so every modal can adopt it without fuss.
function useEscapeKey(onEscape) {
  useEffect(() => {
    if (!onEscape) return;
    // stopImmediatePropagation so when multiple modals are stacked, a single
    // Esc closes only the top one instead of collapsing the whole stack.
    const fn = (e) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.stopPropagation();
        onEscape();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onEscape]);
}

// Fire a browser notification if the user has granted permission. No-op
// otherwise. Also requests permission on first attempt (once per session).
function samasNotify(title, body, opts = {}) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const permission = Notification.permission;
    if (permission === "denied") return;
    if (permission === "default") {
      // Ask on the next tick; we'll rely on the user granting it to make
      // future notifications work. No need to block on this one.
      Notification.requestPermission().catch(() => {});
      return;
    }
    // Permission is "granted".
    const n = new Notification(title, { body, icon: opts.icon, silent: opts.silent });
    setTimeout(() => { try { n.close(); } catch {} }, 6000);
  } catch { /* ignore */ }
}

// Simple two-key navigation: press "g" then one of { p, m, w, n, o } to
// jump between tabs. Vim-style. Ignores keypresses when the user is
// typing in an input / textarea. "?" opens a help modal.
function useKeyboardShortcuts(setTab, onShowHelp) {
  useEffect(() => {
    let gPressed = false;
    let gTimer = null;
    const isEditable = (el) => {
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      // "?" opens the help modal. Works even without shift on some layouts.
      if (e.key === "?" || (e.shiftKey && k === "/")) {
        if (onShowHelp) { onShowHelp(); e.preventDefault(); }
        return;
      }
      if (gPressed) {
        const map = { p: "portfolio", m: "mercado", w: "favoritos", n: "noticias", o: "ordenes" };
        if (map[k] && setTab) {
          setTab(map[k]);
          e.preventDefault();
        }
        gPressed = false;
        clearTimeout(gTimer);
        return;
      }
      if (k === "g") {
        gPressed = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => { gPressed = false; }, 900);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(gTimer); };
  }, [setTab, onShowHelp]);
}

// Light-touch haptic feedback for key actions on mobile.
// On native iOS/Android (Capacitor wrap) we route through the OS
// haptic engine — real Taptic Engine on iPhone, vibration motor on
// Android. In a regular browser we fall back to navigator.vibrate.
// Either way it's a silent no-op where unsupported.
function haptic(type = "tap") {
  // Best-effort native call (fire-and-forget — don't await, the caller
  // shouldn't have to be async just to buzz a button).
  hapticNative(
    type === "confirm" ? "success" :
    type === "error"   ? "error"   :
    type === "success" ? "success" :
    "tap"
  ).catch(() => {});
  try {
    const v = (typeof navigator !== "undefined") && navigator.vibrate && navigator.vibrate.bind(navigator);
    if (!v) return;
    const PATTERNS = {
      tap:     10,
      confirm: [15, 40, 20],
      error:   [40, 30, 40],
      success: [10, 30, 10, 30, 30],
    };
    v(PATTERNS[type] ?? PATTERNS.tap);
  } catch { /* ignore */ }
}

// Pretty in-app confirm dialog. Replaces the default window.confirm() which
// is jarring and doesn't theme. Returns a component that renders null when
// there's no pending question, and a modal card otherwise.
//
// Usage:
//   const { confirm, ConfirmHost } = useConfirm(C);
//   <ConfirmHost />
//   async function onDelete() {
//     if (await confirm({ title: "Borrar?", body: "...", danger: true })) {
//       ...actually delete
//     }
//   }
function useConfirm(C) {
  const [pending, setPending] = useState(null);
  const resolverRef = useRef(null);
  useEscapeKey(pending ? () => { setPending(null); resolverRef.current?.(false); } : null);

  function confirm({ title = "Estas seguro?", body = "", confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = false } = {}) {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPending({ title, body, confirmLabel, cancelLabel, danger });
    });
  }

  function respond(ok) {
    setPending(null);
    resolverRef.current?.(ok);
    resolverRef.current = null;
    haptic(ok ? "confirm" : "tap");
  }

  function ConfirmHost() {
    if (!pending) return null;
    const accent = pending.danger ? C.red : C.accent;
    // Render via a React portal to document.body so the modal escapes any
    // overflow:auto / position:relative ancestors. Previously the modal
    // used position:absolute inside a scroll container, which silently
    // clipped it — the dialog effectively never appeared and the delete
    // button looked broken.
    const content = (
      <div
        className="samas-fade"
        onClick={() => respond(false)}
        style={{
          position:"fixed", inset:0, zIndex:9999,
          background:"rgba(0,0,0,0.6)",
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:20,
        }}
      >
        <div
          className="samas-slide-up"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: C.bg,
            border: "1px solid " + C.border,
            borderRadius: 16,
            maxWidth: 340,
            width: "100%",
            padding: "18px 18px 16px",
            boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontSize:15, fontWeight:800, color:C.text, marginBottom:6 }}>{pending.title}</div>
          {pending.body && <div style={{ fontSize:12, color:C.textMd, lineHeight:1.5, marginBottom:14 }}>{pending.body}</div>}
          <div style={{ display:"flex", gap:8 }}>
            <button
              onClick={() => respond(false)}
              style={{ flex:1, background:C.creamDk, color:C.textMd, border:"1.5px solid "+C.border, borderRadius:10, padding:"10px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}
            >
              {pending.cancelLabel}
            </button>
            <button
              onClick={() => respond(true)}
              style={{ flex:2, background: accent, color:"#fff", border:"none", borderRadius:10, padding:"10px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}
            >
              {pending.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
    if (typeof document === "undefined") return content;
    return createPortal(content, document.body);
  }

  return { confirm, ConfirmHost };
}


// ============================================================
// UTILS
// ============================================================
const fN   = n => new Intl.NumberFormat("es-AR", { maximumFractionDigits:0 }).format(n);
const fARS = n => n >= 1e6 ? "$" + (n/1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n/1e3).toFixed(1) + "k" : "$" + n;

// ============================================================
// FINNHUB INTEGRATION
// ============================================================
// Maps our internal ticker → Finnhub symbol. `null` = skip (no free-tier coverage).
// Everything else falls through to `asset.yf || asset.ticker`.
const FINNHUB_SYMBOL_OVERRIDE = {
  ALUA: null,   // BCBA-only, not on free tier
  MIRG: null,   // BCBA-only
  BTC: "BINANCE:BTCUSDT", // unofficial crypto symbol; falls back to mock if 404
  OIL: "USO",   // WTI proxy
  COPPER: "CPER",
};

// Fetch /quote for every ASSET with a valid Finnhub symbol, mutate price/change
// in place, and bump a render counter. Cheap and coarse — good enough for a
// prototype where the prop-drilling cost would be higher than the mutation cost.
//
// Errors are surfaced two ways: summary error in `status.error`, and a list of
// `{ticker, symbol, reason}` tuples in `status.failures` for debugging (also
// logged to the browser console so users can inspect network issues).
function useFinnhubQuotes(apiKey, mepRate) {
  const [bump, setBump] = useState(0);
  const [status, setStatus] = useState({ live: false, count: 0, error: null, lastSync: null, failures: [] });

  useEffect(() => {
    if (!apiKey) {
      setStatus({ live: false, count: 0, error: null, lastSync: null, failures: [] });
      return;
    }
    let cancelled = false;

    const resolve = (asset) => {
      if (Object.prototype.hasOwnProperty.call(FINNHUB_SYMBOL_OVERRIDE, asset.ticker)) {
        return FINNHUB_SYMBOL_OVERRIDE[asset.ticker];
      }
      return asset.yf || asset.ticker;
    };

    const fetchQuote = async (asset) => {
      const symbol = resolve(asset);
      if (!symbol) return { ticker: asset.ticker, ok: false, reason: "skipped (no free-tier coverage)" };
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`);
        if (r.status === 401 || r.status === 403) return { ticker: asset.ticker, symbol, ok: false, reason: "auth: " + r.status, authErr: true };
        if (r.status === 429) return { ticker: asset.ticker, symbol, ok: false, reason: "rate limit (429)", rateErr: true };
        if (!r.ok) return { ticker: asset.ticker, symbol, ok: false, reason: "http " + r.status };
        const d = await r.json();
        if (!d) return { ticker: asset.ticker, symbol, ok: false, reason: "empty response" };
        if (typeof d.c !== "number" || d.c === 0) return { ticker: asset.ticker, symbol, ok: false, reason: "no data (c=0, likely unsupported symbol)" };
        asset.price = d.c * mepRate;
        asset.change = typeof d.dp === "number" ? d.dp : 0;
        asset.up = asset.change >= 0;
        return { ticker: asset.ticker, symbol, ok: true };
      } catch (e) {
        return { ticker: asset.ticker, symbol, ok: false, reason: "network: " + (e?.message || e) };
      }
    };

    const refresh = async () => {
      const results = await Promise.all(ASSETS.map(fetchQuote));
      if (cancelled) return;
      const authErr  = results.find(r => r.authErr);
      const rateErr  = results.find(r => r.rateErr);
      const failures = results.filter(r => !r.ok);
      const count    = results.filter(r => r.ok).length;
      // Readable log — some mobile / in-app consoles stringify object args
      // as "[object Object]" which hides the actual reason. Inline it.
      if (failures.length) {
        const lines = failures.map(f => `  ${f.ticker} (${f.symbol || "-"}): ${f.reason || "unknown"}`).join("\n");
        console.warn(`[SAMAS/Finnhub] ${failures.length} fetch failures:\n${lines}`);
      }
      // Pick the most common non-skip reason to surface in the UI when the
      // blanket "Sin datos de Finnhub" fallback fires.
      const firstRealFailure = failures.find(f => !/^skipped/i.test(f.reason || ""));
      const headline = firstRealFailure?.reason ? ` — ${firstRealFailure.reason.slice(0, 60)}` : "";
      setStatus({
        live: count > 0,
        count,
        error: authErr ? "API key invalida o sin permisos" : rateErr ? "Limite de consultas alcanzado (60/min)" : count === 0 ? ("Sin datos de Finnhub" + headline) : null,
        lastSync: new Date(),
        failures,
      });
      setBump(b => b + 1);
    };

    refresh();
    const id = setInterval(refresh, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [apiKey, mepRate]);

  return { bump, ...status };
}

// localStorage helpers — guarded against non-browser contexts just in case
function loadKey() { try { return typeof localStorage !== "undefined" ? localStorage.getItem("samas_finnhub_key") : null; } catch { return null; } }
function saveKey(k) { try { if (k) localStorage.setItem("samas_finnhub_key", k); else localStorage.removeItem("samas_finnhub_key"); } catch {} }

// ============================================================
// EMAILJS (signup confirmation emails, client-side)
// ============================================================
// EmailJS is a client-side email service (emailjs.com) designed for static
// apps with no backend. The "public key" is safe to expose in client code —
// domain restrictions can be enforced in the EmailJS dashboard.
//
// Expected template variables: {{to_email}}, {{to_name}}, {{code}}, {{app_name}}
// Free tier: 200 emails/month, 2 req/sec.
function loadEmailjsConfig() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("samas_emailjs_config") : null;
    const cfg = raw ? JSON.parse(raw) : null;
    return cfg && cfg.serviceId && cfg.templateId && cfg.publicKey ? cfg : null;
  } catch { return null; }
}
function saveEmailjsConfig(cfg) {
  try {
    if (cfg && cfg.serviceId && cfg.templateId && cfg.publicKey) {
      localStorage.setItem("samas_emailjs_config", JSON.stringify(cfg));
    } else {
      localStorage.removeItem("samas_emailjs_config");
    }
  } catch {}
}
async function sendViaEmailjs(cfg, params) {
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: cfg.serviceId,
      template_id: cfg.templateId,
      user_id: cfg.publicKey,
      template_params: {
        to_email: params.to,
        to_name: params.name || "",
        code: params.code,
        app_name: "SAMAS",
        subject: params.subject || "Confirma tu cuenta SAMAS",
        message: params.message || "",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const tail = body ? ` — ${body.slice(0, 140)}` : "";
    throw new Error(`EmailJS ${res.status}${tail}`);
  }
  return true;
}

// ============================================================
// COMPANY LOGO with fallback
// ============================================================
// Brand colors and symbols for each asset
const BRAND = {
  // Acciones
  GGAL:   { bg:"#8B1A2B", fg:"#fff",    sym:"G"   },
  YPF:    { bg:"#003087", fg:"#fff",    sym:null,  svg:"ypf"     },
  PAMP:   { bg:"#D4380D", fg:"#fff",    sym:"P"   },
  BBAR:   { bg:"#004A97", fg:"#fff",    sym:null,  svg:"bbva"    },
  ALUA:   { bg:"#1B3A6B", fg:"#fff",    sym:"AL"  },
  MIRG:   { bg:"#0D1B2A", fg:"#E8C400",sym:"M"   },
  TECO2:  { bg:"#00B0F0", fg:"#fff",    sym:null,  svg:"telecom" },
  TXAR:   { bg:"#1A5276", fg:"#fff",    sym:"TX"  },
  // CEDEARs - proper brand colors
  AAPL:   { bg:"#1D1D1F", fg:"#fff",    sym:null,  svg:"apple"   },
  MSFT:   { bg:"#F3F3F3", fg:"#000",    sym:null,  svg:"msft"    },
  GOOGL:  { bg:"#F3F3F3", fg:"#4285F4", sym:null,  svg:"google"  },
  NVDA:   { bg:"#1A1A1A", fg:"#76B900", sym:null,  svg:"nvidia"  },
  AMZN:   { bg:"#232F3E", fg:"#FF9900", sym:null,  svg:"amazon"  },
  TSLA:   { bg:"#E31937", fg:"#fff",    sym:null,  svg:"tesla"   },
  META:   { bg:"#0866FF", fg:"#fff",    sym:null,  svg:"meta"    },
  NFLX:   { bg:"#E50914", fg:"#fff",    sym:"N"   },
  DIS:    { bg:"#0D1F6B", fg:"#fff",    sym:null,  svg:"disney"  },
  V:      { bg:"#1A1F71", fg:"#F7B600", sym:"V"   },
  MA:     { bg:"#F3F3F3", fg:"#000",    sym:null,  svg:"mc"      },
  // ETFs
  SPY:    { bg:"#8B0000", fg:"#FFD700", sym:"S"   },
  QQQ:    { bg:"#0033A0", fg:"#fff",    sym:"Q"   },
  DIA:    { bg:"#003087", fg:"#fff",    sym:"D"   },
  IWM:    { bg:"#006400", fg:"#fff",    sym:"IW"  },
  // Commodities
  GLD:    { bg:"#C9A84C", fg:"#fff",    sym:"Au"  },
  OIL:    { bg:"#1B3A4B", fg:"#E8A020", sym:"OIL" },
  COPPER: { bg:"#B87333", fg:"#fff",    sym:"Cu"  },
  SLV:    { bg:"#8E8E93", fg:"#fff",    sym:"Ag"  },
  // Crypto
  BTC:    { bg:"#F7931A", fg:"#fff",    sym:null,  svg:"btc"     },
  ETH:    { bg:"#627EEA", fg:"#fff",    sym:null,  svg:"eth"     },
};

function BrandSVG({ name, size }) {
  const s = Math.max(size - 8, 12);
  // Apple
  if (name === "apple") return <svg width={s} height={s} viewBox="0 0 814 1000" fill="white"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105.3-57.4-155.5-127.4C46 680.6 0 498.8 0 326.8 0 124.5 140.8 15.1 283 15.1c74.4 0 136.5 48.8 183.3 48.8 44.7 0 115.5-51.9 201.9-51.9 32.4 0 117.6 2.6 179.8 97.1zm-85.1-166.5c34.8-41.3 60.9-98.5 60.9-155.7 0-7.8-.7-15.7-2-23.5-57.3 2.3-124.3 38.5-164.2 82.3-31.4 35.1-61.9 92.6-61.9 150.4 0 8.5 1.3 17 2 19.6 3.3.5 8.6 1.3 13.9 1.3 51.2 0 114.4-34.1 151.3-74.4z"/></svg>;
  // NVIDIA green N
  if (name === "nvidia") return <svg width={s} height={s} viewBox="0 0 24 24"><path d="M9.5 4v10.7L5 4H2v16h3V9.3L9.5 20h2.8L17 9.3V20h3V4h-3l-4.5 10.7L9.5 4z" fill="#76B900"/></svg>;
  // Microsoft 4-color grid
  if (name === "msft") return <svg width={s} height={s} viewBox="0 0 23 23"><rect x="0"  y="0"  width="11" height="11" fill="#F25022"/><rect x="12" y="0"  width="11" height="11" fill="#7FBA00"/><rect x="0"  y="12" width="11" height="11" fill="#00A4EF"/><rect x="12" y="12" width="11" height="11" fill="#FFB900"/></svg>;
  // Google
  if (name === "google") return <svg width={s} height={s} viewBox="0 0 48 48"><path d="M43.6 20H24v8h11.3C33.8 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.4 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z" fill="#4285F4"/><path d="M6.3 14.7l6.6 4.8C14.5 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.4 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" fill="#EA4335"/><path d="M24 44c5.2 0 9.9-1.8 13.5-4.7l-6.2-5.2c-2 1.4-4.5 2.2-7.3 2.2-5.3 0-9.8-3.6-11.3-8.5l-6.6 5.1C9.6 39.7 16.3 44 24 44z" fill="#34A853"/><path d="M43.9 20H24v8h11.3c-.7 2.1-2 3.9-3.7 5.1l6.2 5.2C41.1 34.8 44 29.8 44 24c0-1.3-.1-2.7-.1-4z" fill="#FBBC05"/></svg>;
  // Amazon smile
  if (name === "amazon") return <svg width={s} height={s} viewBox="0 0 24 24"><text x="1" y="13" fontSize="8.5" fontWeight="900" fontFamily="Arial Black,sans-serif" fill="#FF9900">amazon</text><path d="M3 17.5c4.5 2.5 12 2.5 16-1" stroke="#FF9900" strokeWidth="1.5" strokeLinecap="round" fill="none"/><path d="M18.5 15.5c1 0.5 1.5 1 1 1.5" stroke="#FF9900" strokeWidth="1" strokeLinecap="round" fill="none"/></svg>;
  // Tesla T
  if (name === "tesla") return <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff"><path d="M12 3.5C8.1 3.5 4.7 5.9 3 9.3h4.1C8.2 8.1 9.5 7.4 12 7.4s3.8.7 4.9 1.9H21C19.3 5.9 15.9 3.5 12 3.5z"/><path d="M12 7.4c-1.3 0-2.5.3-3.3.9L12 20.5l3.3-12.2c-.8-.6-2-.9-3.3-.9z"/></svg>;
  // Meta
  if (name === "meta") return <svg width={s} height={s} viewBox="0 0 24 24" fill="white"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z"/><text x="2" y="15" fontSize="7" fontWeight="900" fontFamily="Arial,sans-serif" fill="white">META</text></svg>;
  // Disney D
  if (name === "disney") return <svg width={s} height={s} viewBox="0 0 24 24"><text x="1" y="17" fontSize="11" fontWeight="900" fontFamily="Arial,sans-serif" fill="white">D</text><circle cx="15" cy="7" r="5" fill="none" stroke="white" strokeWidth="1.5"/></svg>;
  // Mastercard
  if (name === "mc") return <svg width={s} height={s} viewBox="0 0 24 24"><circle cx="8"  cy="12" r="7" fill="#EB001B"/><circle cx="16" cy="12" r="7" fill="#F79E1B" fillOpacity="0.85"/></svg>;
  // BBVA
  if (name === "bbva") return <svg width={s} height={s} viewBox="0 0 24 24"><rect width="24" height="24" fill="#004A97"/><text x="2" y="16" fontSize="8" fontWeight="900" fontFamily="Arial,sans-serif" fill="white">BBVA</text></svg>;
  // YPF
  if (name === "ypf") return <svg width={s} height={s} viewBox="0 0 24 24"><rect width="24" height="24" fill="#003087"/><text x="2" y="16" fontSize="9" fontWeight="900" fontFamily="Arial,sans-serif" fill="#FFD700">YPF</text></svg>;
  // Telecom
  if (name === "telecom") return <svg width={s} height={s} viewBox="0 0 24 24"><rect width="24" height="24" fill="#00B0F0"/><text x="1" y="15" fontSize="7.5" fontWeight="900" fontFamily="Arial,sans-serif" fill="white">TECO</text></svg>;
  // Bitcoin B
  if (name === "btc") return <svg width={s} height={s} viewBox="0 0 24 24" fill="white"><path d="M14.5 9.5C14.5 8.1 13.5 7 12 7H8v5h4c1.5 0 2.5-1.1 2.5-2.5zm.5 4.5c0-1.5-1.1-2.5-2.5-2.5H8v5h4.5C14 16.5 15 15.4 15 14zM6 4v16h6.5c3.3 0 5.5-2 5.5-4.5 0-1.6-.8-3-2.2-3.8C17 10.9 17.5 9.7 17.5 8.5 17.5 6.3 15.8 4 12.5 4H6z"/></svg>;
  // Ethereum
  if (name === "eth") return <svg width={s} height={s} viewBox="0 0 24 24" fill="white"><polyline points="12,2 4,12 12,16 20,12"/><polyline points="12,16 4,12 12,22 20,12"/></svg>;
  return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><text fontSize={Math.round(s/2.5)} fontWeight="900" fontFamily="Arial,sans-serif" fill="white" x="1" y={Math.round(s*0.7)}>{name.toUpperCase().slice(0,3)}</text></svg>;
}

function AssetLogo({ asset, size = 36, C }) {
  const catColors = { Acciones:C.accent, CEDEAR:"#7C3AED", ETF:"#2563EB", Commodity:C.green, Crypto:"#F7931A" };
  const col = catColors[asset.cat] || C.accent;
  const r = Math.round(size / 3);
  return (
    <div style={{ width:size, height:size, borderRadius:r, background:col+"22", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:Math.round(size/3.6), color:col, flexShrink:0, border:"1px solid " + col+"33" }}>
      {asset.ticker.slice(0,3)}
    </div>
  );
}

// ============================================================
// YAHOO FINANCE CHART
// ============================================================
function YahooChart({ asset, C }) {
  const [period, setPeriod] = useState("1mo");
  const [hovered, setHovered] = useState(null);

  // Synthetic price series: random walk seeded by ticker, targeting a plausible
  // start price so the curve ends at the current `asset.price`. All percents are
  // decimal (0.384 = +38.4%). The final pass scales values so the last point
  // matches asset.price exactly, avoiding the "flat line" visual mismatch.
  const generateSeries = (p) => {
    const counts = { "1d":78, "5d":130, "1mo":22, "3mo":66, "6mo":130, "1y":252, "2y":504 };
    const n = counts[p] || 22;
    const current = asset.price;

    // Approximate period return from available asset data
    const pct1m  = (asset.chg1m  || 0) / 100;
    const pctYTD = (asset.chgYTD || 0) / 100;
    const pctDay = (asset.change || 0) / 100;
    const periodReturn = (
      p === "1d"  ? pctDay :
      p === "5d"  ? pctDay * 3 :
      p === "1mo" ? pct1m :
      p === "3mo" ? pctYTD * 0.25 :
      p === "6mo" ? pctYTD * 0.5 :
      p === "1y"  ? pctYTD :
      /* 2y */      pctYTD * 1.5
    );

    // Per-step volatility (fraction of price) — tunes noise amplitude
    const vol = (
      p === "1d"  ? 0.003 :
      p === "5d"  ? 0.006 :
      p === "1mo" ? 0.012 :
      p === "3mo" ? 0.020 :
      p === "6mo" ? 0.028 :
      p === "1y"  ? 0.035 :
      /* 2y */      0.045
    );

    const startPrice = current / (1 + periodReturn);
    const driftPerStep = periodReturn / Math.max(n - 1, 1);

    // Deterministic PRNG seeded from ticker + period so charts are stable
    const seed = (asset.ticker + p).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const rng  = (i) => { const x = Math.sin(seed + i * 127.1) * 43758.5453; return x - Math.floor(x); };

    const raw = [startPrice];
    let v = startPrice;
    for (let i = 1; i < n; i++) {
      const noise = (rng(i) - 0.5) * vol;
      v = v * (1 + driftPerStep + noise);
      raw.push(v);
    }
    // Rescale so the final point lands exactly on current price
    const last = raw[raw.length - 1] || current;
    const k = current / last;
    return raw.map(x => x * k);
  };

  const vals = generateSeries(period);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const range = mx - mn || 1;
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? C.green : C.red;
  const pChange = ((vals[vals.length - 1] - vals[0]) / vals[0] * 100).toFixed(2);

  const W = 320, H = 110, PAD = 8;
  const toX = i => PAD + (i / (vals.length - 1)) * (W - PAD * 2);
  const toY = v => H - PAD - ((v - mn) / range) * (H - PAD * 2);

  const points = vals.map((v, i) => toX(i) + "," + toY(v)).join(" ");
  const fillPts = toX(0) + "," + H + " " + points + " " + toX(vals.length-1) + "," + H;

  const periods = ["1d","5d","1mo","3mo","6mo","1y","2y"];
  const labels = { "1d":"1D","5d":"5D","1mo":"1M","3mo":"3M","6mo":"6M","1y":"1A","2y":"2A" };

  const hovX = hovered !== null ? toX(hovered) : null;
  const hovV = hovered !== null ? vals[hovered] : null;

  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        <div style={{ fontSize:10, color:C.textLt }}>Grafico de precio</div>
        <div style={{ fontSize:13, fontWeight:800, color:col, fontFamily:"monospace" }}>{up?"+":""}{pChange}%</div>
      </div>
      <div style={{ display:"flex", gap:4, marginBottom:8, overflowX:"auto" }}>
        {periods.map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            style={{ background: p===period ? C.accent : C.creamDk, color: p===period ? "#fff" : C.textMd, border:"none", borderRadius:7, padding:"4px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
            {labels[p]}
          </button>
        ))}
      </div>
      <div style={{ background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:"8px 4px 4px", position:"relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display:"block", overflow:"visible" }}
          onMouseMove={e => { const rect = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - rect.left) / rect.width * W; setHovered(Math.min(vals.length-1, Math.max(0, Math.round((x - PAD) / (W - PAD*2) * (vals.length-1))))); }}
          onMouseLeave={() => setHovered(null)}>
          <defs>
            <linearGradient id={"cg" + asset.ticker} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={col} stopOpacity="0.3"/>
              <stop offset="100%" stopColor={col} stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          <polyline points={fillPts} fill={"url(#cg"+asset.ticker+")"} stroke="none"/>
          <polyline points={points} stroke={col} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          {hovX !== null && (
            <g>
              <line x1={hovX} y1={PAD} x2={hovX} y2={H-PAD} stroke={C.textLt} strokeWidth="1" strokeDasharray="3,2"/>
              <circle cx={hovX} cy={toY(hovV)} r="4" fill={col} stroke={C.card} strokeWidth="2"/>
            </g>
          )}
        </svg>
        {hovX !== null && hovV !== null && (
          <div style={{ position:"absolute", top:4, right:8, background:C.card, border:"1px solid "+C.border, borderRadius:8, padding:"4px 8px", pointerEvents:"none" }}>
            <div style={{ fontSize:12, fontWeight:700, fontFamily:"monospace", color:C.text }}>${fN(Math.round(hovV))}</div>
          </div>
        )}
        <div style={{ display:"flex", justifyContent:"space-between", padding:"2px 8px", marginTop:2 }}>
          <span style={{ fontSize:9, color:C.textLt }}>${fN(Math.round(mn))}</span>
          <span style={{ fontSize:9, color:C.textLt }}>${fN(Math.round(mx))}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SPARKLINE
// ============================================================
function Spark({ up, color, w=50, h=24 }) {
  const pts = (up ? [50,44,38,32,24,18,12,8,5,2] : [2,6,10,16,24,32,38,44,48,50])
    .map((y, x) => ((x / 9) * w) + "," + ((y / 50) * h)).join(" ");
  const fill = pts + " " + w + "," + h + " 0," + h;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <defs>
        <linearGradient id={"sg" + w + (up?"u":"d")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline points={fill} fill={"url(#sg" + w + (up?"u":"d") + ")"} stroke="none"/>
      <polyline points={pts} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ============================================================
// EMAIL NOTIFICATION (simulated)
// ============================================================
// Fire-and-forget trade notification. Routes through the user's configured
// EmailJS credentials if present; otherwise logs only (no network call).
// Previously this fired a request with placeholder credentials on every
// trade, which always 4xx'd and leaked fake service ids to EmailJS.
function sendEmailNotification({ to, subject, body }) {
  console.log("EMAIL to " + to + " | Subject: " + subject + " | Body: " + body);
  const cfg = loadEmailjsConfig();
  if (!cfg) return;  // no real credentials → don't spam EmailJS
  sendViaEmailjs(cfg, { to, subject, message: body, code: "" })
    .catch(err => console.warn("[SAMAS/email] send failed:", err?.message || err));
}

// ============================================================
// TICKER BANNER
// ============================================================
function TickerBanner({ C }) {
  const items = ASSETS.filter(a => a.cat === "ETF" || a.cat === "Commodity" || a.cat === "Crypto");
  const all = [...items, ...items, ...items];
  return (
    <div style={{ background:C.navy, height:28, overflow:"hidden", position:"relative", flexShrink:0 }}>
      <style>{"@keyframes tkS{from{transform:translateX(0)}to{transform:translateX(-33.33%)}} .tks{display:flex;animation:tkS 50s linear infinite;width:max-content;}"}</style>
      <div style={{ position:"absolute", left:0, top:0, bottom:0, zIndex:5, background:C.accent, display:"flex", alignItems:"center", padding:"0 8px", fontSize:8, fontWeight:900, color:"#fff", letterSpacing:1.5 }}>LIVE</div>
      <div style={{ marginLeft:38, height:"100%", overflow:"hidden" }}>
        <div className="tks">
          {all.map((a, i) => (
            <div key={i} style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"0 11px", height:28, borderRight:"1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ color:C.goldLt, fontWeight:800, fontSize:9, fontFamily:"monospace" }}>{a.ticker}</span>
              <span style={{ color:"rgba(255,255,255,0.55)", fontSize:9, fontFamily:"monospace" }}>${fN(a.price)}</span>
              <span style={{ color: a.up ? "#4ADE80" : "#F87171", fontSize:9, fontWeight:700 }}>{a.up ? "+" : "-"}{Math.abs(a.change).toFixed(2)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// FX STRIP with USD conversion
// ============================================================
function FXStrip({ C, totalARS }) {
  const [showConv, setShowConv] = useState(false);
  return (
    <div>
      <div style={{ background:C.creamDk, borderBottom:"1px solid " + C.border, display:"flex", height:40, flexShrink:0 }}>
        {FX.map((fx, i) => (
          <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", borderRight: i < FX.length-1 ? "1px solid " + C.border : "none", cursor:"pointer" }} onClick={() => setShowConv(v => !v)}>
            <div style={{ fontSize:8, fontWeight:700, color:C.textLt }}>USD {fx.label}</div>
            <div style={{ fontSize:12, fontWeight:800, fontFamily:"monospace", color:C.text }}>${fN(fx.value)}</div>
            <div style={{ fontSize:8, fontWeight:700, color: fx.up ? C.green : C.red }}>{fx.up ? "+" : "-"}{Math.abs(fx.change).toFixed(1)}%</div>
          </div>
        ))}
      </div>
      {showConv && totalARS > 0 && (
        <div style={{ background:C.card, borderBottom:"1px solid " + C.border, padding:"10px 14px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:8 }}>TU CARTERA EN USD</div>
          <div style={{ display:"flex", gap:8 }}>
            {FX.map(fx => (
              <div key={fx.label} style={{ flex:1, background:C.creamDk, borderRadius:10, padding:"8px 10px", textAlign:"center" }}>
                <div style={{ fontSize:9, color:C.textLt, fontWeight:600, marginBottom:3, display:"flex", alignItems:"center", justifyContent:"center", gap:2 }}>
                  <span>USD {fx.label}</span>
                  <InfoBadge term={fx.label === "OF." ? "Oficial" : fx.label} C={C}/>
                </div>
                <div style={{ fontSize:14, fontWeight:800, color:C.accent, fontFamily:"monospace" }}>
                  u$s{fN(Math.round(totalARS / fx.value))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:10, color:C.textLt, marginTop:6, textAlign:"center" }}>Toca para cerrar</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PRICE INPUT PANEL
// ============================================================
function PriceInputPanel({ asset, accentColor, suggestions, inputMode, setInputMode, price, setPrice, direction, C }) {
  // Guard the divisor — if asset.price transiently hits 0 during a live
  // feed outage, the pct label would otherwise read "Infinity%".
  const pctVal = price && parseInt(price) > 0 && asset.price > 0
    ? (((parseInt(price) - asset.price) / asset.price) * 100).toFixed(1)
    : null;
  const valid  = price && parseInt(price) > 0 && (direction === "below" ? parseInt(price) < asset.price : parseInt(price) > asset.price);
  return (
    <div>
      <div style={{ background:C.card, borderRadius:12, border:"1px solid " + C.border, padding:"10px 14px", marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:12, color:C.textMd }}>Precio actual</span>
        <span style={{ fontFamily:"monospace", fontWeight:700, fontSize:14, color:C.text }}>${fN(asset.price)}</span>
      </div>
      <div style={{ display:"flex", background:C.creamDk, borderRadius:10, padding:3, gap:3, marginBottom:12 }}>
        {[["pct","Por %"],["price","Precio exacto"]].map(([v, l]) => (
          <button key={v} onClick={() => { setInputMode(v); setPrice(""); }}
            style={{ flex:1, padding:"7px", background: v === inputMode ? C.card : "transparent", color: v === inputMode ? C.text : C.textMd, border:"none", borderRadius:8, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>{l}</button>
        ))}
      </div>
      {inputMode === "pct" ? (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            {suggestions.map(s => {
              const val = String(Math.round(asset.price * (1 + s.pct / 100)));
              const sel = price === val;
              return <button key={s.label} onClick={() => setPrice(val)} style={{ flex:1, background: sel ? accentColor + "22" : C.card, color: sel ? accentColor : C.textMd, border:"1.5px solid " + (sel ? accentColor : C.border), borderRadius:10, padding:"8px 0", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{s.label}<br/><span style={{ fontSize:10 }}>${fN(Math.round(asset.price * (1 + s.pct/100)))}</span></button>;
            })}
          </div>
          <div style={{ position:"relative", marginBottom:10 }}>
            <input type="number" placeholder="%" onChange={e => { const p = parseFloat(e.target.value); if (!isNaN(p)) setPrice(String(Math.round(asset.price * (1 + (direction === "below" ? -Math.abs(p) : Math.abs(p)) / 100)))); }}
              style={{ background:C.card, border:"1.5px solid " + C.border, borderRadius:10, padding:"10px 28px 10px 12px", fontSize:14, fontFamily:"monospace", fontWeight:700, color:C.text, outline:"none", width:"100%", boxSizing:"border-box" }}/>
            <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", color:C.textMd, fontSize:13 }}>%</span>
          </div>
        </div>
      ) : (
        <div style={{ position:"relative", marginBottom:10 }}>
          <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", color:C.textMd, fontSize:15 }}>$</span>
          <input type="text" inputMode="decimal" value={price}
            onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            onKeyDown={e => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault(); }}
            style={{ background:C.card, border:"1.5px solid " + C.border, borderRadius:12, padding:"12px 12px 12px 28px", fontSize:16, fontFamily:"monospace", fontWeight:700, color:C.text, outline:"none", width:"100%", boxSizing:"border-box" }}/>
        </div>
      )}
      {price && parseInt(price) > 0 && (
        <div style={{ background: valid ? C.green + "18" : C.red + "18", border:"1px solid " + (valid ? C.green : C.red) + "44", borderRadius:10, padding:"10px 13px", marginBottom:4 }}>
          <div style={{ fontSize:12, color: valid ? C.green : C.red }}>
            {!valid ? "Debe ser " + (direction === "below" ? "menor" : "mayor") + " al precio actual." : asset.ticker + " a $" + fN(parseInt(price)) + " (" + pctVal + "% desde ahora)"}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// STOP LOSS MODAL
// ============================================================
function StopLossModal({ asset, current, onSave, onClose, C }) {
  useEscapeKey(onClose);
  const [price, setPrice]         = useState(current ? String(current) : "");
  const [inputMode, setInputMode] = useState("pct");
  const sug = [{ label:"-5%", pct:-5 }, { label:"-10%", pct:-10 }, { label:"-15%", pct:-15 }];
  const valid = price && parseInt(price) > 0 && parseInt(price) < asset.price;
  return (
    <div style={{ position:"absolute", inset:0, zIndex:60, display:"flex", flexDirection:"column", background:"rgba(0,0,0,0.7)" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"20px 18px", maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
          <div><div style={{ fontWeight:800, fontSize:17, color:C.text }}>Stop Loss - {asset.ticker}</div><div style={{ fontSize:12, color:C.textMd, marginTop:2 }}>Venta automatica si el precio cae</div></div>
          <button onClick={onClose} style={{ background:"transparent", border:"none", fontSize:18, color:C.textLt, cursor:"pointer" }}>x</button>
        </div>
        <PriceInputPanel asset={asset} accentColor={C.red} suggestions={sug} inputMode={inputMode} setInputMode={setInputMode} price={price} setPrice={setPrice} direction="below" C={C}/>
        <div style={{ display:"flex", gap:10, marginTop:14 }}>
          {current && <button onClick={() => onSave(null)} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"none", borderRadius:11, padding:"13px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Eliminar</button>}
          <button onClick={() => { if (valid) onSave(parseInt(price)); }} style={{ flex:2, background: valid ? C.red : C.creamDk, color: valid ? "#fff" : C.textLt, border:"none", borderRadius:11, padding:"13px", fontWeight:700, fontSize:14, cursor: valid ? "pointer" : "not-allowed", fontFamily:"inherit" }}>Activar Stop Loss</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PRICE ALERT MODAL
// ============================================================
function PriceAlertModal({ asset, current, onSave, onClose, C }) {
  useEscapeKey(onClose);
  const [price, setPrice]         = useState(current ? String(current.price) : "");
  const [inputMode, setInputMode] = useState("pct");
  const [dir, setDir]             = useState(current ? current.direction : "above");
  const sug = dir === "above" ? [{ label:"+5%", pct:5 }, { label:"+10%", pct:10 }, { label:"+20%", pct:20 }] : [{ label:"-5%", pct:-5 }, { label:"-10%", pct:-10 }, { label:"-15%", pct:-15 }];
  const valid = price && parseInt(price) > 0 && (dir === "above" ? parseInt(price) > asset.price : parseInt(price) < asset.price);
  return (
    <div style={{ position:"absolute", inset:0, zIndex:60, display:"flex", flexDirection:"column", background:"rgba(0,0,0,0.7)" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"20px 18px", maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
          <div><div style={{ fontWeight:800, fontSize:17, color:C.text }}>Alerta de precio - {asset.ticker}</div><div style={{ fontSize:12, color:C.textMd, marginTop:2 }}>Aviso cuando el precio llegue a este nivel</div></div>
          <button onClick={onClose} style={{ background:"transparent", border:"none", fontSize:18, color:C.textLt, cursor:"pointer" }}>x</button>
        </div>
        <div style={{ display:"flex", background:C.creamDk, borderRadius:10, padding:3, gap:3, marginBottom:14 }}>
          {[["above","Sube a"],["below","Baja a"]].map(([v, l]) => (
            <button key={v} onClick={() => { setDir(v); setPrice(""); }} style={{ flex:1, padding:"8px", background: v === dir ? C.card : "transparent", color: v === dir ? C.text : C.textMd, border:"none", borderRadius:8, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>{l}</button>
          ))}
        </div>
        <PriceInputPanel asset={asset} accentColor={C.gold} suggestions={sug} inputMode={inputMode} setInputMode={setInputMode} price={price} setPrice={setPrice} direction={dir} C={C}/>
        <div style={{ display:"flex", gap:10, marginTop:14 }}>
          {current && <button onClick={() => onSave(null)} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"none", borderRadius:11, padding:"13px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Eliminar</button>}
          <button onClick={() => { if (valid) onSave({ price: parseInt(price), direction: dir }); }} style={{ flex:2, background: valid ? C.gold : C.creamDk, color: valid ? "#fff" : C.textLt, border:"none", borderRadius:11, padding:"13px", fontWeight:700, fontSize:14, cursor: valid ? "pointer" : "not-allowed", fontFamily:"inherit" }}>Activar Alerta</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CONFIRM TRADE MODAL (with 2FA + email)
// ============================================================
function ConfirmTradeModal({ trade, onConfirm, onCancel, C, isWeb = false, displayUser = DEMO_USER, storedPinHash = null }) {
  useEscapeKey(onCancel);
  const [step, setStep]       = useState("alert");   // alert | review | faceid | pin
  const [pin, setPin]         = useState("");
  const [pinErr, setPinErr]   = useState(false);
  const [facePhase, setFacePhase] = useState("idle"); // idle | scanning | success
  const isBuy = trade.side === "Compra";
  const total = trade.qty * trade.price;

  const doFaceID = () => {
    setFacePhase("scanning");
    setTimeout(() => {
      setFacePhase("success");
      setTimeout(() => {
        sendEmailNotification({
          to: displayUser.email,
          subject: "Operacion ejecutada: " + trade.side + " " + trade.ticker,
          body: trade.side + " " + trade.qty + " " + trade.ticker + " a $" + fN(trade.price) + ". Total: $" + fN(total) + ". Fecha: " + new Date().toLocaleString("es-AR") + ". Si no reconoces esta operacion contacta a SAMAS inmediatamente."
        });
        onConfirm();
      }, 700);
    }, 1800);
  };

  const doPin = async () => {
    // Hash the entered PIN and compare against the profile's stored PIN
    // hash. If we somehow don't have a hash (new account with no PIN set
    // — shouldn't happen because the app gates behind PinLockScreen),
    // fall back to demo "4821" so local-only testing keeps working.
    try {
      const hash = await hashPin(pin);
      const ok = storedPinHash ? (hash === storedPinHash) : pin === "4821";
      if (ok) {
        sendEmailNotification({
          to: displayUser.email,
          subject: "Operacion ejecutada: " + trade.side + " " + trade.ticker,
          body: trade.side + " " + trade.qty + " " + trade.ticker + " a $" + fN(trade.price) + ". Total: $" + fN(total) + ". Fecha: " + new Date().toLocaleString("es-AR") + ". Si no reconoces esta operacion contacta a SAMAS inmediatamente."
        });
        onConfirm();
      } else {
        setPinErr(true); setPin(""); setTimeout(() => setPinErr(false), 1400);
      }
    } catch (e) {
      console.error("[trade-pin] hash failed:", e);
      setPinErr(true); setPin(""); setTimeout(() => setPinErr(false), 1400);
    }
  };

  return (
    <div style={{ position:"absolute", inset:0, zIndex:70, display:"flex", flexDirection:"column", background:"rgba(0,0,0,0.88)" }}>
      <style>{"@keyframes scanLine2{0%{top:15%}100%{top:82%}}"}</style>
      <div onClick={onCancel} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"22px 18px", maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>

        {/* Order summary - hidden during big alert */}
        {step !== "alert" && <div style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"12px 14px", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:isBuy?C.green+"22":C.red+"22", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isBuy?C.green:C.red} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {isBuy ? <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></> : <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>}
              </svg>
            </div>
            <div><div style={{ fontWeight:800, fontSize:16, color:C.text }}>{trade.side} {trade.ticker}</div><div style={{ fontSize:12, color:C.textMd }}>{trade.qty} unidades a ${fN(trade.price)}</div></div>
            <div style={{ marginLeft:"auto", textAlign:"right" }}><div style={{ fontSize:11, color:C.textMd }}>Total</div><div style={{ fontSize:18, fontWeight:800, fontFamily:"monospace", color:isBuy?C.green:C.red }}>${fN(total)}</div></div>
          </div>
          <div style={{ background:C.creamDk, borderRadius:10, padding:"8px 12px", fontSize:11, color:C.textMd, display:"flex", alignItems:"center", gap:6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textMd} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.29 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.61a16 16 0 0 0 6 6l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            Confirmacion por email a {displayUser.email}
          </div>
        </div>}

        {step === "alert" && (() => {
          // Calculos del boleto estilo agente de bolsa argentino
          const subtotal    = trade.qty * trade.price;
          const comisionPct = 0.005;                         // 0.5% comision SAMAS
          const comision    = Math.round(subtotal * comisionPct);
          const derMercado  = Math.round(subtotal * 0.0008); // derechos de mercado 0.08%
          const ivaBase     = comision + derMercado;
          const iva         = Math.round(ivaBase * 0.21);    // IVA 21% sobre comision
          const totalFees   = comision + derMercado + iva;
          const totalFinal  = isBuy ? subtotal + totalFees : subtotal - totalFees;

          return (
            <div>
              <div style={{ textAlign:"center", marginBottom:18 }}>
                <div style={{ width:70, height:70, borderRadius:18, background: isBuy ? C.green + "22" : C.red + "22", margin:"0 auto 12px", display:"flex", alignItems:"center", justifyContent:"center", border: "3px solid " + (isBuy ? C.green : C.red) }}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={isBuy ? C.green : C.red} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    {isBuy ? <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></> : <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>}
                  </svg>
                </div>
                <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>ESTAS A PUNTO DE</div>
                <div style={{ fontSize:24, fontWeight:900, color: isBuy ? C.green : C.red, marginBottom:8, lineHeight:1.1 }}>
                  {isBuy ? "COMPRAR" : "VENDER"}
                </div>
                <div style={{ fontSize:32, fontWeight:900, color:C.text, fontFamily:"Georgia,serif", letterSpacing:-1, lineHeight:1 }}>
                  {trade.qty} {trade.ticker}
                </div>
              </div>

              {/* BOLETO */}
              <div style={{ background:C.card, border:"2px dashed "+C.border, borderRadius:14, padding:"14px 18px 16px", marginBottom:14 }}>
                <div style={{ textAlign:"center", paddingBottom:10, marginBottom:6, borderBottom:"1px dotted "+C.border }}>
                  <span style={{ fontSize:10, fontWeight:800, color:C.textLt, letterSpacing:2 }}>BOLETO DE OPERACION</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dotted "+C.border }}>
                  <span style={{ fontSize:11, color:C.textMd }}>Tipo</span>
                  <span style={{ fontSize:11, fontWeight:700, color:C.text }}>{trade.side} a mercado</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dotted "+C.border }}>
                  <span style={{ fontSize:11, color:C.textMd }}>Cantidad</span>
                  <span style={{ fontSize:11, fontWeight:700, color:C.text, fontFamily:"monospace" }}>{trade.qty} unidades</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px dotted "+C.border }}>
                  <span style={{ fontSize:11, color:C.textMd }}>Precio unitario</span>
                  <span style={{ fontSize:11, fontWeight:700, color:C.text, fontFamily:"monospace" }}>${fN(trade.price)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid "+C.border, marginTop:4 }}>
                  <span style={{ fontSize:12, color:C.text, fontWeight:700 }}>Subtotal</span>
                  <span style={{ fontSize:13, fontWeight:800, color:C.text, fontFamily:"monospace" }}>${fN(subtotal)}</span>
                </div>

                <div style={{ marginTop:8, marginBottom:4, fontSize:9, fontWeight:800, color:C.textLt, letterSpacing:1.5 }}>GASTOS Y COMISIONES</div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
                  <span style={{ fontSize:11, color:C.textMd }}>Comision SAMAS (0,50%)</span>
                  <span style={{ fontSize:11, color:C.textMd, fontFamily:"monospace" }}>${fN(comision)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
                  <span style={{ fontSize:11, color:C.textMd }}>Derechos de mercado (0,08%)</span>
                  <span style={{ fontSize:11, color:C.textMd, fontFamily:"monospace" }}>${fN(derMercado)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
                  <span style={{ fontSize:11, color:C.textMd }}>IVA 21% s/comisiones</span>
                  <span style={{ fontSize:11, color:C.textMd, fontFamily:"monospace" }}>${fN(iva)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderTop:"1px dotted "+C.border, marginTop:4 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:C.textMd }}>Total gastos</span>
                  <span style={{ fontSize:12, fontWeight:700, color:C.red, fontFamily:"monospace" }}>${fN(totalFees)}</span>
                </div>

                <div style={{ marginTop:10, paddingTop:10, borderTop:"2px solid "+C.text, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1 }}>{isBuy ? "TOTAL A PAGAR" : "TOTAL A RECIBIR"}</div>
                    <div style={{ fontSize:9, color:C.textLt }}>{isBuy ? "Se debitara de tu cuenta" : "Se acreditara en tu cuenta"}</div>
                  </div>
                  <div style={{ fontSize:22, fontWeight:900, color: isBuy ? C.red : C.green, fontFamily:"monospace", letterSpacing:-0.5 }}>
                    ${fN(totalFinal)}
                  </div>
                </div>
              </div>

              <div style={{ background: C.gold + "18", border:"1.5px solid " + C.gold + "55", borderRadius:12, padding:"10px 12px", marginBottom:14, display:"flex", gap:8, alignItems:"flex-start" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:2 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div style={{ fontSize:10, color:C.textMd, lineHeight:1.5 }}>Una vez confirmada, la operacion se envia al mercado y no podes cancelarla.</div>
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={onCancel} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"none", borderRadius:14, padding:"15px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                  Cancelar
                </button>
                <button onClick={() => setStep("review")} style={{ flex:2, background: isBuy ? C.green : C.red, color:"#fff", border:"none", borderRadius:14, padding:"15px", fontWeight:800, fontSize:14, cursor:"pointer", fontFamily:"inherit", boxShadow:"0 4px 14px " + (isBuy?C.green:C.red) + "55" }}>
                  Si, continuar
                </button>
              </div>
            </div>
          );
        })()}

        {step === "review" && (
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:12, textAlign:"center" }}>
              {isWeb ? "VERIFICA ESTA OPERACION CON TU PIN" : "ELIGE COMO VERIFICAR ESTA OPERACION"}
            </div>
            {/* Face ID removed: it was a cosmetic-only button in web/mobile
                (no secure biometric API is accessible from a browser). It'll
                come back as the primary option once we wrap the app with
                Capacitor + the Native Biometric plugin on iOS / Android.
                Until then, PIN is the only path to keep the UX honest. */}
            <button onClick={() => setStep("pin")} style={{ width:"100%", background:C.accent, color:"#fff", border:"none", borderRadius:14, padding:"15px", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:10, fontSize:14, fontWeight:800, marginBottom:10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Confirmar con PIN
            </button>
            <button onClick={onCancel} style={{ width:"100%", background:C.creamDk, color:C.textMd, border:"none", borderRadius:12, padding:"13px", fontWeight:600, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Cancelar</button>
          </div>
        )}

        {step === "faceid" && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
            <div style={{ position:"relative", width:140, height:140 }}>
              <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:"2px solid "+(facePhase==="success"?"#4ADE80":facePhase==="scanning"?"#0D1117":"rgba(255,255,255,0.12)"), transition:"border-color 0.4s" }}/>
              <div style={{ position:"absolute", inset:10, borderRadius:"50%", background:"rgba(255,255,255,0.03)", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                {facePhase === "scanning" && <div style={{ position:"absolute", left:0, right:0, height:2, background:"linear-gradient(90deg,transparent,#0D1117,transparent)", animation:"scanLine2 0.9s ease-in-out infinite alternate", top:"50%" }}/>}
                {facePhase !== "success" ? (
                  <svg width="60" height="60" viewBox="0 0 80 80" fill="none" style={{ opacity:facePhase==="scanning"?0.4:0.25 }}>
                    <ellipse cx="40" cy="36" rx="24" ry="28" stroke="rgba(255,255,255,0.6)" strokeWidth="2"/>
                    <ellipse cx="31" cy="30" rx="3.5" ry="4.5" stroke="rgba(255,255,255,0.6)" strokeWidth="2"/>
                    <ellipse cx="49" cy="30" rx="3.5" ry="4.5" stroke="rgba(255,255,255,0.6)" strokeWidth="2"/>
                    <path d="M32 50 Q40 55 48 50" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" fill="none"/>
                  </svg>
                ) : (
                  <svg width="48" height="48" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="24" fill="rgba(74,222,128,0.15)" stroke="#4ADE80" strokeWidth="2"/><polyline points="17,28 24,36 39,20" stroke="#4ADE80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              </div>
              {["tl","tr","bl","br"].map(p => <div key={p} style={{ position:"absolute", top:p.startsWith("t")?-2:"auto", bottom:p.startsWith("b")?-2:"auto", left:p.endsWith("l")?-2:"auto", right:p.endsWith("r")?-2:"auto", width:16, height:16, borderTop:p.startsWith("t")?"2px solid #0D1117":"none", borderBottom:p.startsWith("b")?"2px solid #0D1117":"none", borderLeft:p.endsWith("l")?"2px solid #0D1117":"none", borderRight:p.endsWith("r")?"2px solid #0D1117":"none" }}/>)}
            </div>
            <div style={{ fontSize:14, fontWeight:600, color:facePhase==="success"?"#4ADE80":facePhase==="scanning"?"#0D1117":C.textMd, textAlign:"center" }}>
              {facePhase==="idle"?"Toca para escanear tu rostro":facePhase==="scanning"?"Escaneando...":"Identidad verificada"}
            </div>
            {facePhase === "idle" && (
              <div style={{ display:"flex", gap:10, width:"100%" }}>
                <button onClick={() => setStep("review")} style={{ flex:1, background:C.creamDk, border:"none", borderRadius:12, padding:"13px", fontWeight:600, fontSize:13, cursor:"pointer", color:C.textMd, fontFamily:"inherit" }}>Atras</button>
                <button onClick={doFaceID} style={{ flex:2, background:"linear-gradient(135deg,#0D1117,#E080B0)", border:"none", borderRadius:12, padding:"13px", fontWeight:700, fontSize:14, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Escanear Face ID</button>
              </div>
            )}
          </div>
        )}

        {step === "pin" && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, width:"100%" }}>
            <div style={{ fontSize:13, color:C.textMd }}>Ingresa tu PIN de 4 digitos</div>
            <div style={{ display:"flex", gap:14 }}>
              {[0,1,2,3].map(i => <div key={i} style={{ width:14, height:14, borderRadius:"50%", background: i < pin.length ? (pinErr?"#F87171":C.accent) : C.border, border:"1.5px solid "+(i < pin.length ? (pinErr?"#F87171":C.accent) : C.border), transition:"all 0.15s" }}/>)}
            </div>
            {pinErr && <div style={{ color:"#F87171", fontSize:12, fontWeight:600, marginTop:-8 }}>PIN incorrecto. Intenta de nuevo.</div>}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, width:"100%" }}>
              {[1,2,3,4,5,6,7,8,9,"",0,"x"].map((k, i) => (
                <button key={i} onClick={() => {
                  if (k === "x") { setPin(p => p.slice(0,-1)); return; }
                  if (k === "") return;
                  const next = pin + String(k); setPin(next);
                  if (next.length === 4) setTimeout(async () => {
                    // Verify against the stored hash from profiles (cross-
                    // device PIN). Fall back to demo "4821" if no hash yet.
                    try {
                      const h = await hashPin(next);
                      const ok = storedPinHash ? (h === storedPinHash) : next === "4821";
                      if (ok) {
                        sendEmailNotification({ to:displayUser.email, subject:"Operacion ejecutada: "+trade.side+" "+trade.ticker, body:trade.side+" "+trade.qty+" "+trade.ticker+" a $"+fN(trade.price)+". Total: $"+fN(total)+". Fecha: "+new Date().toLocaleString("es-AR")+"." });
                        onConfirm();
                      } else { setPinErr(true); setPin(""); setTimeout(() => setPinErr(false), 1400); }
                    } catch (e) { setPinErr(true); setPin(""); setTimeout(() => setPinErr(false), 1400); }
                  }, 80);
                }}
                disabled={k === ""}
                style={{ background:k===""?"transparent":C.card, border:k===""?"none":"1px solid "+C.border, borderRadius:12, padding:"14px 0", color:k==="x"?C.textLt:C.text, fontSize:k==="x"?16:20, fontWeight:600, cursor:k===""?"default":"pointer", fontFamily:"monospace" }}>
                  {k==="x"?"<-":k}
                </button>
              ))}
            </div>
            <button onClick={() => { setStep("review"); setPin(""); setPinErr(false); }} style={{ width:"100%", background:C.creamDk, border:"none", borderRadius:12, padding:"11px", fontWeight:600, fontSize:13, cursor:"pointer", color:C.textMd, fontFamily:"inherit" }}>Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ASSET DETAIL
// ============================================================
// "What if" simulator for a single asset. Lets the user pick an amount and
// a lookback window (1w / 1m / 6m / YTD), and shows what a purchase back
// then would be worth today based on the asset's seeded change percentages.
// Small, self-contained, no network.
function WhatIfPanel({ asset, C }) {
  const [amount, setAmount] = useState(100000);
  const [range, setRange]   = useState("1m");
  // Derive return % for each window from the seeded fields. 1w = 1/4 of 1m
  // as a crude approximation; 6m = chgYTD * 0.5 (monthly rate squashed);
  // YTD uses chgYTD directly.
  const ranges = [
    { key: "1w",  label: "1 sem", pct: (asset.chg1m || 0) / 4 },
    { key: "1m",  label: "1 mes", pct: asset.chg1m || 0 },
    { key: "6m",  label: "6 m",   pct: (asset.chgYTD || 0) * 0.6 },
    { key: "ytd", label: "YTD",   pct: asset.chgYTD || 0 },
  ];
  const sel = ranges.find(r => r.key === range) || ranges[1];
  const projected = amount * (1 + sel.pct / 100);
  const delta     = projected - amount;
  const up        = delta >= 0;
  return (
    <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:12, padding:"11px 13px", marginTop:10 }}>
      <div style={{ fontSize:9, fontWeight:700, color:C.textLt, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
        Qué hubiera pasado si compraba…
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:10 }}>
        {ranges.map(r => {
          const active = range === r.key;
          return (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              style={{ flex:1, background: active ? C.accent + "22" : C.bg, border: "1.5px solid " + (active ? C.accent : C.border), borderRadius:8, padding:"6px 4px", fontSize:10, fontWeight:700, color: active ? C.accent : C.textMd, cursor:"pointer", fontFamily:"inherit" }}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize:9, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>Monto (ARS)</div>
      <div style={{ position:"relative", marginBottom:10 }}>
        <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:C.textLt, fontSize:13, fontWeight:600, pointerEvents:"none" }}>$</span>
        <input
          type="text"
          inputMode="numeric"
          value={amount > 0 ? String(amount) : ""}
          placeholder="0"
          onFocus={e => { try { e.target.select(); } catch {} }}
          onChange={e => {
            const cleaned = e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
            setAmount(cleaned === "" ? 0 : Number(cleaned));
          }}
          style={{ background:C.bg, border:"1.5px solid "+C.border, borderRadius:10, padding:"10px 12px 10px 22px", fontSize:14, fontFamily:"Sora,sans-serif", fontWeight:700, color:C.text, outline:"none", width:"100%", boxSizing:"border-box" }}
        />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <div style={{ background:C.bg, border:"1px solid "+C.border, borderRadius:10, padding:"8px 10px" }}>
          <div style={{ fontSize:9, color:C.textLt, fontWeight:700 }}>HOY VALDRÍA</div>
          <div style={{ fontSize:14, fontWeight:800, color:C.text, fontFamily:"monospace" }}>${fN(Math.round(projected))}</div>
        </div>
        <div style={{ background: up ? C.green + "18" : C.red + "18", border:"1px solid " + (up ? C.green + "44" : C.red + "44"), borderRadius:10, padding:"8px 10px" }}>
          <div style={{ fontSize:9, color: up ? C.green : C.red, fontWeight:700 }}>{up ? "GANANCIA" : "PÉRDIDA"}</div>
          <div style={{ fontSize:14, fontWeight:800, color: up ? C.green : C.red, fontFamily:"monospace" }}>
            {up ? "+" : "-"}${fN(Math.round(Math.abs(delta)))} ({sel.pct >= 0 ? "+" : ""}{sel.pct.toFixed(1)}%)
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// NEWS — components shared by AssetDetail and PageNoticias
// ============================================================
// NewsCard renders a single article (image + title + source/time +
// optional ticker chip). Clicking opens the article in a new tab.
//
// NewsSection wraps a list of articles with a header + loading /
// empty / error states. Used both inside AssetDetail (per-ticker)
// and PageNoticias (mixed feed).
// Detect known-bad image URLs client-side as a second line of defense.
// Server already filters most placeholders in fetch-news; this catches
// anything that leaked through (cached articles from before the
// server-side filter was added, mostly).
function isBadThumbnail(url) {
  if (!url || typeof url !== "string") return true;
  const lc = url.toLowerCase();
  if (lc.includes("s.yimg.com/rz/")) return true;
  if (lc.includes("s.yimg.com/cv/")) return true;
  if (lc.includes("yahoo_logo")) return true;
  if (lc.includes("/pixel")) return true;
  if (lc.includes("transparent")) return true;
  if (lc.includes("1x1") || lc.includes("16x16") || lc.includes("32x32")) return true;
  return false;
}

function NewsCard({ article, C, lang, showTicker, onTickerClick, onOpen }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (!article) return null;
  const open = () => {
    if (onOpen) {
      onOpen(article);
      return;
    }
    if (article.url) {
      try { window.open(article.url, "_blank", "noopener,noreferrer"); }
      catch { /* swallow popup-blocker errors */ }
    }
  };
  // Image rendering: skip entirely when the URL looks like a known
  // placeholder, OR when the browser already failed to load it.
  const showImage = article.image_url && !isBadThumbnail(article.image_url) && !imgFailed;
  return (
    <div
      onClick={open}
      style={{
        background: C.card, borderRadius: 12, border: "1px solid " + C.border,
        padding: 0, overflow: "hidden", cursor: "pointer",
        display: "flex", flexDirection: "column",
        transition: "border-color 120ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent + "55"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
    >
      {showImage && (
        <div style={{
          width: "100%", aspectRatio: "16 / 9", overflow: "hidden",
          background: C.creamDk, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <img src={article.image_url} alt="" loading="lazy"
            onError={() => setImgFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
        </div>
      )}
      <div style={{ padding: "11px 13px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {showTicker && article.ticker && (
            <span
              onClick={onTickerClick ? (e) => { e.stopPropagation(); onTickerClick(article.ticker); } : undefined}
              style={{
                background: C.gold + "22", color: C.gold,
                fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                borderRadius: 5, padding: "2px 7px", fontFamily: "monospace",
                cursor: onTickerClick ? "pointer" : "default",
              }}
            >
              {article.ticker}
            </span>
          )}
          {article.source && (
            <span style={{ fontSize: 10, color: C.textMd, fontWeight: 600 }}>
              {article.source}
            </span>
          )}
          <span style={{ fontSize: 10, color: C.textLt, marginLeft: "auto" }}>
            {relativeTime(article.published_at, lang)}
          </span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.text, lineHeight: 1.4 }}>
          {article.title}
        </div>
        {article.summary && (
          <div style={{ fontSize: 11, color: C.textMd, lineHeight: 1.5 }}>
            {article.summary.length > 200 ? article.summary.slice(0, 200) + "…" : article.summary}
          </div>
        )}
      </div>
    </div>
  );
}

// In-app article preview modal. Shows the title + image + summary in
// a slide-up sheet so the user gets context without immediately
// jumping to a different app/tab. The "Leer artículo completo" button
// then opens the original URL externally (we can't iframe most news
// sites — they set X-Frame-Options: DENY — so an honest "preview +
// external read" pattern is the cleanest UX).
function ArticleModal({ article, C, lang, onClose }) {
  useEffect(() => {
    if (!article) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [article, onClose]);
  if (!article) return null;
  const showImage = article.image_url && !isBadThumbnail(article.image_url);
  const openExternal = () => {
    if (!article.url) return;
    try { window.open(article.url, "_blank", "noopener,noreferrer"); } catch {}
  };
  return (
    <div
      onClick={onClose}
      style={{
        // `absolute` (not `fixed`) so the backdrop and sheet stay
        // contained within the app's frame in desktop preview / phone
        // mockup wrappers. The nearest positioned ancestor (the app
        // root) is the scrolling/overlay boundary.
        position: "absolute", inset: 0, zIndex: 90,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        animation: "fadeIn 120ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480, maxHeight: "90%",
          background: C.bg, borderRadius: "20px 20px 0 0",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.4)",
          position: "relative",
        }}
      >
        {/* drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border }}/>
        </div>
        {/* close button */}
        <button
          onClick={onClose}
          aria-label="Cerrar"
          style={{
            position: "absolute", top: 14, right: 14,
            width: 32, height: 32, borderRadius: 16,
            background: C.card, border: "1px solid " + C.border,
            color: C.textMd, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit", fontSize: 14, fontWeight: 600, zIndex: 1,
          }}
        >✕</button>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 18px" }}>
          {/* meta row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            {article.ticker && (
              <span style={{ background: C.gold + "22", color: C.gold, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, borderRadius: 5, padding: "3px 8px", fontFamily: "monospace" }}>
                {article.ticker}
              </span>
            )}
            {article.source && (
              <span style={{ fontSize: 11, color: C.textMd, fontWeight: 600 }}>{article.source}</span>
            )}
            <span style={{ fontSize: 10, color: C.textLt, marginLeft: "auto" }}>
              {relativeTime(article.published_at, lang)}
            </span>
          </div>
          {/* title */}
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1.35, margin: "0 0 12px" }}>
            {article.title}
          </h2>
          {/* image */}
          {showImage && (
            <div style={{
              width: "100%", aspectRatio: "16 / 9",
              borderRadius: 14, overflow: "hidden",
              background: C.creamDk, marginBottom: 12,
            }}>
              <img src={article.image_url} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
            </div>
          )}
          {/* summary */}
          {article.summary && (
            <div style={{ fontSize: 13, color: C.textMd, lineHeight: 1.65, marginBottom: 18 }}>
              {article.summary}
            </div>
          )}
          {/* CTA */}
          <button
            onClick={openExternal}
            style={{
              width: "100%", background: C.accent, color: "#fff",
              border: "none", borderRadius: 12, padding: "13px",
              fontSize: 14, fontWeight: 800,
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Leer artículo completo
          </button>
          <div style={{ fontSize: 10, color: C.textLt, textAlign: "center", marginTop: 8 }}>
            Se abre en una pestaña nueva en {article.source || "la fuente original"}
          </div>
        </div>
      </div>
    </div>
  );
}

// Per-ticker news block — used inside AssetDetail. Lazy-fetches on
// mount, refetches when the ticker changes. Errors don't block the
// rest of the screen — we just hide the section gracefully.
function NewsSection({ ticker, C, lang, max = 5 }) {
  const [articles, setArticles] = useState(null);  // null = loading, [] = none, [...] = data
  const [err, setErr] = useState(null);
  const [openArticle, setOpenArticle] = useState(null);
  useEffect(() => {
    let alive = true;
    setArticles(null);
    setErr(null);
    if (!ticker) return;
    fetchNewsForTicker(ticker, lang)
      .then((arr) => { if (alive) setArticles(arr || []); })
      .catch((e) => {
        console.error("[news] fetch failed:", e);
        if (alive) { setArticles([]); setErr(e?.message || "error"); }
      });
    return () => { alive = false; };
  }, [ticker, lang]);
  // Hide silently if there are no articles (rather than showing a
  // negative-feeling empty state inside an asset detail view).
  if (articles && articles.length === 0 && !err) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Noticias</div>
        {articles && <div style={{ fontSize: 10, color: C.textLt }}>{articles.length} {articles.length === 1 ? "artículo" : "artículos"}</div>}
      </div>
      {articles === null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, height: 60, opacity: 0.5 }}/>
          ))}
        </div>
      )}
      {err && articles && articles.length === 0 && (
        <div style={{ fontSize: 11, color: C.textLt, padding: "10px 12px", background: C.card, border: "1px dashed " + C.border, borderRadius: 10 }}>
          No pudimos traer noticias ahora. Probá de nuevo en un rato.
        </div>
      )}
      {articles && articles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {articles.slice(0, max).map((a) => (
            <NewsCard key={a.url} article={a} C={C} lang={lang} onOpen={setOpenArticle}/>
          ))}
        </div>
      )}
      <ArticleModal article={openArticle} C={C} lang={lang} onClose={() => setOpenArticle(null)}/>
    </div>
  );
}

function AssetDetail({ asset, holding, stopLoss, priceAlert, balance, isInWatchlist, onToggleWatchlist, onClose, onTrade, onSetStopLoss, onSetAlert, C, uiMode, lang }) {
  useEscapeKey(onClose);
  const isPro = uiMode !== "principiante";
  const [mode, setMode]           = useState(null);
  const [qty, setQty]             = useState("");
  const [done, setDone]           = useState(false);
  const [showSL, setShowSL]       = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  // Drag-to-dismiss state. The panel's translateY follows the finger
  // while it's pulling DOWN; passing the threshold on release closes
  // the sheet. Pulling up does nothing (would compete with the inner
  // scroll). Touch events here, not React Pointer events, because
  // pointer-events on iOS can race with native scroll handling.
  const [dragY, setDragY]         = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);
  const DISMISS_THRESHOLD = 120; // px — finger has to pull this far.

  const handleTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    dragStartRef.current = { y: t.clientY, time: Date.now() };
    setIsDragging(true);
  };
  const handleTouchMove = (e) => {
    const start = dragStartRef.current;
    if (!start) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dy = t.clientY - start.y;
    if (dy > 0) {
      // Pull down — apply with rubber-banding (resistance increases
      // with distance so the user feels they're stretching something).
      setDragY(dy < 200 ? dy : 200 + (dy - 200) * 0.4);
    } else {
      setDragY(0);
    }
  };
  const handleTouchEnd = () => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    if (!start) return;
    const elapsed = Date.now() - start.time;
    // Close if pulled past threshold OR if a quick downward flick.
    const flick = elapsed < 300 && dragY > 40;
    if (dragY > DISMISS_THRESHOLD || flick) {
      onClose();
    } else {
      setDragY(0);
    }
  };
  const up        = asset.change >= 0;
  const color     = up ? C.green : C.red;
  const qtyNum    = parseInt(qty) || 0;
  const maxSell   = holding ? holding.qty : 0;
  const totalCost = qtyNum * asset.price;
  // Guard against zero/undefined price (can happen transiently while a
  // live-data fetch is in flight). Without this, maxBuy becomes Infinity
  // and the "Max" button hydrates the input with an unusable value.
  const maxBuy    = asset.price > 0 ? Math.floor(balance / asset.price) : 0;
  const sellErr   = mode === "sell" && qtyNum > maxSell && qtyNum > 0 ? "Solo tienes " + maxSell + " unidades" : null;
  const buyErr    = mode === "buy"  && qtyNum > 0 && totalCost > balance ? "Saldo insuficiente. Max: " + maxBuy + " u" : null;
  const canGo     = qtyNum > 0 && !sellErr && !buyErr;

  const doConfirm = () => {
    if (!canGo) return;
    onTrade({ ticker:asset.ticker, side: mode === "buy" ? "Compra" : "Venta", qty:qtyNum, price:asset.price });
    setDone(true);
    setTimeout(() => { setDone(false); setMode(null); setQty(""); onClose(); }, 1200);
  };

  // Backdrop fade-out and panel slide-down go together so the
  // dismissal feels like one continuous gesture.
  const dragProgress = Math.min(1, dragY / DISMISS_THRESHOLD);
  const backdropOpacity = 0.5 * (1 - dragProgress * 0.7);
  const panelTransform = `translateY(${dragY}px)`;
  // No transition while the finger is actively dragging, but spring
  // back smoothly on release without dismissal.
  const transition = isDragging ? "none" : "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)";

  return (
    <div style={{ position:"absolute", inset:0, zIndex:40, display:"flex", flexDirection:"column" }}>
      {showSL && <StopLossModal asset={asset} current={stopLoss} onSave={v => { onSetStopLoss(asset.ticker, v); setShowSL(false); }} onClose={() => setShowSL(false)} C={C}/>}
      {showAlert && <PriceAlertModal asset={asset} current={priceAlert} onSave={v => { onSetAlert(asset.ticker, v); setShowAlert(false); }} onClose={() => setShowAlert(false)} C={C}/>}
      <div onClick={onClose} style={{ flex:"0 0 55px", background:`rgba(0,0,0,${backdropOpacity})`, transition: isDragging ? "none" : "background 220ms" }}/>
      <div
        style={{
          flex:1,
          background:C.bg,
          borderRadius:"20px 20px 0 0",
          overflow:"hidden",
          display:"flex",
          flexDirection:"column",
          transform: panelTransform,
          transition,
          willChange: "transform",
        }}
      >
        {/* Drag handle — small grey pill at the top, plus a generous
            32px-tall touch target above and around the inner scroll
            content. Pulling down on the handle lets the user dismiss
            with their thumb without having to reach for the X button. */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={{
            display:"flex", justifyContent:"center",
            padding:"10px 0 6px",
            cursor:"grab",
            touchAction:"none",
            // Make the entire header strip (where the ticker + close
            // button sit) draggable too, so the user can pull anywhere
            // near the top — but only while dragging actually exceeds
            // a few pixels.
            userSelect:"none",
          }}
        >
          <div style={{
            width:36, height:4, borderRadius:2,
            background: dragY > 20 ? C.accent : C.border,
            transition: "background 120ms",
          }}/>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"0 16px 20px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <AssetLogo asset={asset} size={44} C={C}/>
              <div>
                <div style={{ fontWeight:900, fontSize:20, color:C.text }}>{asset.ticker}</div>
                <div style={{ fontSize:12, color:C.textMd }}>{asset.name}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <button onClick={() => onToggleWatchlist(asset.ticker)} title={isInWatchlist ? "Quitar de watchlist" : "Agregar a watchlist"}
                style={{ background:isInWatchlist?C.gold+"22":"transparent", border:"1.5px solid "+(isInWatchlist?C.gold+"66":C.border), borderRadius:10, cursor:"pointer", padding:"6px 8px", display:"flex", alignItems:"center", gap:4, fontFamily:"inherit" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={isInWatchlist?C.gold:"none"} stroke={isInWatchlist?C.gold:C.textMd} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              <button onClick={onClose} style={{ background:"transparent", border:"none", fontSize:20, color:C.textLt, cursor:"pointer", padding:4 }}>x</button>
            </div>
          </div>
          <div style={{ background:C.card, borderRadius:16, border:"1px solid " + C.border, padding:"14px 16px", marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
              <div>
                <div style={{ fontSize:28, fontWeight:800, fontFamily:"monospace", color:C.text }}>${fN(asset.price)}</div>
                <div style={{ display:"flex", gap:10, marginTop:4 }}>
                  <span style={{ color, fontWeight:700, fontSize:12 }}>{up ? "+" : "-"}{Math.abs(asset.change).toFixed(2)}% hoy</span>
                  <span style={{ color: asset.chg1m >= 0 ? C.green : C.red, fontSize:11 }}>{asset.chg1m >= 0 ? "+" : ""}{asset.chg1m}% 1M</span>
                  <span style={{ color: asset.chgYTD >= 0 ? C.green : C.red, fontSize:11 }}>{asset.chgYTD >= 0 ? "+" : ""}{asset.chgYTD}% YTD</span>
                </div>
              </div>
              <Spark up={up} color={color} w={60} h={30}/>
            </div>
          </div>

          <YahooChart asset={asset} C={C}/>

          {/* What-if: simulated gain/loss at seeded chg1m/chgYTD deltas.
              Hidden in beginner mode — it's a "play with numbers" surface
              that assumes some comfort with returns math. */}
          {isPro && <WhatIfPanel asset={asset} C={C}/>}

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10, marginTop:10 }}>
            {[["Volumen",asset.vol],["Mkt Cap",asset.mktCap],["Max 52s","$"+fN(asset.hi52)],["Min 52s","$"+fN(asset.lo52)], ...(asset.pe ? [["P/E",asset.pe+"x"]] : [])].map(([l, v]) => (
              <div key={l} style={{ background:C.card, borderRadius:12, border:"1px solid " + C.border, padding:"9px 12px" }}>
                <div style={{ fontSize:9, color:C.textLt, fontWeight:600, marginBottom:2 }}>{l}</div>
                <div style={{ fontSize:13, fontWeight:700, color:C.text, fontFamily:"monospace" }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ background:C.card, borderRadius:12, border:"1px solid " + C.border, padding:"11px 13px", marginBottom:10 }}>
            <div style={{ fontSize:9, fontWeight:700, color:C.textLt, letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>Sobre este activo</div>
            <div style={{ fontSize:12, color:C.textMd, lineHeight:1.6 }}>{asset.desc}</div>
          </div>

          {holding && (
            <div style={{ background:"#2563EB18", borderRadius:12, border:"1px solid #2563EB33", padding:"11px 13px", marginBottom:10 }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#2563EB", letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>Tu posicion</div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <div><div style={{ fontSize:13, color:C.text, fontWeight:600 }}>{holding.qty} unidades</div><div style={{ fontSize:11, color:C.textLt }}>Promedio: ${fN(holding.avg)}</div></div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:700, fontSize:14, color:C.text, fontFamily:"monospace" }}>{fARS(holding.qty * asset.price)}</div>
                  <div style={{ fontSize:11, fontWeight:600, color: ((asset.price-holding.avg)/holding.avg) >= 0 ? C.green : C.red }}>{((asset.price-holding.avg)/holding.avg*100) >= 0 ? "+" : ""}{((asset.price-holding.avg)/holding.avg*100).toFixed(1)}% desde compra</div>
                </div>
              </div>
            </div>
          )}

          {stopLoss && (
            <div style={{ background:C.red+"18", borderRadius:12, border:"1px solid "+C.red+"33", padding:"10px 13px", marginBottom:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <div><div style={{ fontSize:11, fontWeight:700, color:C.red }}>Stop Loss activo</div><div style={{ fontSize:11, color:C.textMd }}>Venta a ${fN(stopLoss)}</div></div>
              </div>
              <button onClick={() => setShowSL(true)} style={{ background:"transparent", color:C.red, border:"1px solid "+C.red+"44", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Editar</button>
            </div>
          )}

          {priceAlert && (
            <div style={{ background:C.gold+"18", borderRadius:12, border:"1px solid "+C.gold+"44", padding:"10px 13px", marginBottom:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <div><div style={{ fontSize:11, fontWeight:700, color:C.gold }}>Alerta activa</div><div style={{ fontSize:11, color:C.textMd }}>{priceAlert.direction === "above" ? "Sube a" : "Baja a"} ${fN(priceAlert.price)}</div></div>
              </div>
              <button onClick={() => setShowAlert(true)} style={{ background:"transparent", color:C.gold, border:"1px solid "+C.gold+"44", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Editar</button>
            </div>
          )}

          {!mode && !done && (
            <div style={{ display:"flex", gap:8, marginBottom:10 }}>
              <button onClick={() => setMode("buy")} style={{ flex:1, background:C.green, color:"#fff", border:"none", borderRadius:12, padding:"13px", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>Comprar</button>
              {holding && <button onClick={() => setMode("sell")} style={{ flex:1, background:"transparent", color:C.red, border:"2px solid "+C.red, borderRadius:12, padding:"13px", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>Vender</button>}
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {holding && <button onClick={() => setShowSL(true)} style={{ width:44, height:44, background:stopLoss?C.red+"22":C.creamDk, color:stopLoss?C.red:C.textMd, border:"1.5px solid "+(stopLoss?C.red+"55":C.border), borderRadius:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></button>}
                <button onClick={() => setShowAlert(true)} style={{ width:44, height:44, background:priceAlert?C.gold+"22":C.creamDk, color:priceAlert?C.gold:C.textMd, border:"1.5px solid "+(priceAlert?C.gold+"55":C.border), borderRadius:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>
              </div>
            </div>
          )}
          {mode && !done && (
            <div style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"14px" }}>
              <div style={{ fontWeight:700, fontSize:14, color:C.text, marginBottom:10 }}>{mode === "buy" ? "Comprar" : "Vender"} {asset.ticker}</div>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1 }}>CANTIDAD</div>
                {mode === "sell" && <div style={{ fontSize:10, color:C.textLt }}>Disponible: <strong>{maxSell}</strong></div>}
                {mode === "buy"  && <div style={{ fontSize:10, color:C.textLt }}>Saldo: <strong>${fN(balance)}</strong></div>}
              </div>
              <input type="text" inputMode="numeric" value={qty}
                onChange={e => setQty(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={e => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-" || e.key === ".") e.preventDefault(); }}
                placeholder="0"
                style={{ background:C.bg, border:"1.5px solid "+(sellErr||buyErr?C.red:C.border), borderRadius:10, padding:"12px", fontSize:16, fontFamily:"monospace", fontWeight:700, color:C.text, outline:"none", width:"100%", boxSizing:"border-box", marginBottom:6 }}/>
              {sellErr && <div style={{ color:C.red, fontSize:12, fontWeight:600, marginBottom:8 }}>{sellErr}</div>}
              {buyErr  && <div style={{ color:C.red, fontSize:12, fontWeight:600, marginBottom:8 }}>{buyErr}</div>}
              {qtyNum > 0 && !sellErr && !buyErr && (
                <div style={{ background:(mode==="buy"?C.green:C.red)+"18", border:"1px solid "+(mode==="buy"?C.green:C.red)+"44", borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:14 }}>
                    <span style={{ fontWeight:700, color:C.text }}>Total</span>
                    <span style={{ fontFamily:"monospace", fontWeight:800, color:mode==="buy"?C.green:C.red }}>${fN(totalCost)}</span>
                  </div>
                </div>
              )}
              <div style={{ display:"flex", gap:8, marginTop:4 }}>
                <button onClick={() => { setMode(null); setQty(""); }} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"none", borderRadius:10, padding:"12px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Cancelar</button>
                <button onClick={doConfirm} style={{ flex:2, background:canGo?(mode==="buy"?C.green:C.red):C.creamDk, color:canGo?"#fff":C.textLt, border:"none", borderRadius:10, padding:"12px", fontWeight:700, fontSize:13, cursor:canGo?"pointer":"not-allowed", fontFamily:"inherit" }}>Confirmar {mode==="buy"?"Compra":"Venta"}</button>
              </div>
            </div>
          )}
          {done && <div style={{ background:C.green, borderRadius:14, padding:"18px", textAlign:"center", color:"#fff" }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:"block", margin:"0 auto 8px" }}><circle cx="12" cy="12" r="10"/><polyline points="6 12 10 16 18 8"/></svg><div style={{ fontWeight:700, fontSize:15 }}>Procesando orden...</div></div>}
          {/* Per-ticker news. Lazy-loaded on mount of the detail view.
              Hidden when there are no articles so the asset card stays
              tight for tickers our news provider has zero coverage on. */}
          <NewsSection ticker={asset.ticker} C={C} lang={lang || "es"} max={5}/>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PAGE: POSICIONES
// ============================================================
// ============================================================
// ARS / USD TOGGLE (global context via prop)
// ============================================================
function CurrencyToggle({ showUSD, onToggle, C }) {
  const mep = 1247.50;
  return (
    <div onClick={onToggle} style={{ display:"flex", alignItems:"center", gap:6, background:showUSD?C.accent+"22":C.creamDk, border:"1.5px solid "+(showUSD?C.accent:C.border), borderRadius:20, padding:"4px 10px", cursor:"pointer", userSelect:"none" }}>
      <div style={{ width:28, height:16, borderRadius:8, background:showUSD?C.accent:C.border, position:"relative", transition:"background 0.2s" }}>
        <div style={{ position:"absolute", top:2, left:showUSD?12:2, width:12, height:12, borderRadius:6, background:"#fff", transition:"left 0.2s" }}/>
      </div>
      <span style={{ fontSize:11, fontWeight:700, color:showUSD?C.accent:C.textMd }}>USD</span>
    </div>
  );
}

function fmtPrice(price, showUSD, ticker) {
  const mep = 1247.50;
  if (showUSD) {
    const usd = price / mep;
    return usd >= 1000 ? "u$s" + (usd/1000).toFixed(2) + "k" : "u$s" + usd.toFixed(2);
  }
  return "$" + fN(price);
}

// ============================================================
// PAGE: OBLIGACIONES NEGOCIABLES
// ============================================================
function PageON({ C, showUSD, lang }) {
  const t = useT(lang);
  const [selected, setSelected] = useState(null);
  const typeColor = { "Hard Dollar":"#2563EB", "UVA":"#C9A84C", "Tasa Variable":"#7C3AED" };
  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:2 }}>{t("on_title")}</div>
        <div style={{ fontSize:12, color:C.textMd }}>{t("on_sub")}</div>
      </div>
      {selected && (
        <div style={{ position:"fixed", inset:0, zIndex:80, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end" }}>
          <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"20px 18px 32px", width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:typeColor[selected.type]||C.accent, background:(typeColor[selected.type]||C.accent)+"22", borderRadius:6, padding:"2px 8px", marginBottom:6, display:"inline-block" }}>{selected.type}</div>
                <div style={{ fontSize:20, fontWeight:800, color:C.text }}>{selected.name}</div>
                <div style={{ fontSize:12, color:C.textMd, marginTop:2 }}>{selected.issuer}</div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Cerrar" style={{ background:"transparent", border:"none", padding:4, color:C.textLt, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
              {[
                ["Precio", (showUSD || selected.currency==="USD") ? "u$s"+selected.price : "$"+fN(Math.round(selected.price*1247.5))],
                ["Tasa", selected.rate],
                ["Vencimiento", selected.maturity],
                ["TIR", selected.yield ? selected.yield+"%" : "N/A"],
                ["Rating", selected.rating],
                ["Moneda", selected.currency],
                ["Lote min.", "$"+selected.minLot],
                ["Tipo", selected.type],
              ].map(([l,v]) => (
                <div key={l} style={{ background:C.card, borderRadius:10, border:"1px solid "+C.border, padding:"9px 12px" }}>
                  <div style={{ fontSize:9, color:C.textLt, fontWeight:600, marginBottom:2 }}>{l}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:"12px", marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.textMd, lineHeight:1.6 }}>{selected.desc}</div>
            </div>
            <button style={{ width:"100%", background:C.accent, color:"#fff", border:"none", borderRadius:12, padding:"13px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Suscribir / Comprar
            </button>
          </div>
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {ON_DATA.map(on => (
          <button key={on.ticker} onClick={() => setSelected(on)} style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"13px 14px", textAlign:"left", cursor:"pointer", fontFamily:"inherit", width:"100%" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
                  <span style={{ fontWeight:800, fontSize:14, color:C.text }}>{on.ticker}</span>
                  <span style={{ fontSize:9, fontWeight:700, color:typeColor[on.type]||C.accent, background:(typeColor[on.type]||C.accent)+"22", borderRadius:5, padding:"2px 7px" }}>{on.type}</span>
                  <span style={{ fontSize:9, fontWeight:700, color:on.currency==="USD"?"#2563EB":C.gold, background:(on.currency==="USD"?"#2563EB":C.gold)+"18", borderRadius:5, padding:"2px 7px" }}>{on.currency}</span>
                </div>
                <div style={{ fontSize:11, color:C.textMd }}>{on.name}</div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:15, fontWeight:800, color:C.text, fontFamily:"monospace" }}>{(showUSD||on.currency==="USD") ? "u$s"+on.price : "$"+fN(Math.round(on.price*1247.5))}</div>
                {on.yield && <div style={{ fontSize:11, color:C.green, fontWeight:700 }}>TIR {on.yield}%</div>}
              </div>
            </div>
            <div style={{ display:"flex", gap:12, fontSize:10, color:C.textLt }}>
              <span>Cupon: <strong style={{ color:C.text }}>{on.rate}</strong></span>
              <span>Vence: <strong style={{ color:C.text }}>{on.maturity.slice(0,7)}</strong></span>
              <span>Rating: <strong style={{ color:C.text }}>{on.rating}</strong></span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PAGE: FONDOS
// ============================================================
function PageFondos({ C, lang }) {
  const t = useT(lang);
  const [selected, setSelected] = useState(null);
  const riskColor = { "Bajo":C.green, "Moderado":C.gold, "Agresivo":C.red };
  const typeIcon  = { "Money Market":"MM", "Renta Fija ARS":"RF$", "Renta Fija USD":"RF$", "Mixto":"MX", "Acciones":"RV" };
  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:2 }}>{t("fondos_title")}</div>
        <div style={{ fontSize:12, color:C.textMd }}>{t("fondos_sub")}</div>
      </div>
      {selected && (
        <div style={{ position:"fixed", inset:0, zIndex:80, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end" }}>
          <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"20px 18px 32px", width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
              <div>
                <div style={{ fontSize:20, fontWeight:800, color:C.text }}>{selected.name}</div>
                <div style={{ fontSize:12, color:C.textMd, marginTop:2 }}>{selected.manager} - {selected.type}</div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Cerrar" style={{ background:"transparent", border:"none", padding:4, color:C.textLt, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
              {[
                ["Rendim. YTD", (selected.ytd > 0 ? "+" : "") + selected.ytd + "%"],
                ["TNA Est.", selected.tna + "%"],
                ["Moneda", selected.currency],
                ["Riesgo", selected.risk],
                ["Horizonte", selected.horizonte],
                ["Inversion min.", "$" + selected.min],
              ].map(([l,v]) => (
                <div key={l} style={{ background:C.card, borderRadius:10, border:"1px solid "+C.border, padding:"9px 10px" }}>
                  <div style={{ fontSize:9, color:C.textLt, fontWeight:600, marginBottom:2 }}>{l}</div>
                  <div style={{ fontSize:12, fontWeight:800, color: l==="Riesgo" ? riskColor[v]||C.text : C.text }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:"12px", marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.textMd, lineHeight:1.6 }}>{selected.desc}</div>
            </div>
            <button style={{ width:"100%", background:C.green, color:"#fff", border:"none", borderRadius:12, padding:"13px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Suscribir al fondo
            </button>
          </div>
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {FONDOS.map(f => (
          <button key={f.id} onClick={() => setSelected(f)} style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"13px 14px", textAlign:"left", cursor:"pointer", fontFamily:"inherit", width:"100%" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
                  <div style={{ width:32, height:32, borderRadius:8, background:C.accent+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:800, color:C.accent, flexShrink:0 }}>{typeIcon[f.type]||"FCI"}</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{f.name}</div>
                    <div style={{ fontSize:10, color:C.textMd }}>{f.manager} - {f.type}</div>
                  </div>
                </div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:15, fontWeight:800, color:C.green }}>{f.ytd > 0 ? "+" : ""}{f.ytd}%</div>
                <div style={{ fontSize:10, color:C.textLt }}>YTD</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:8 }}>
              <div style={{ background:(riskColor[f.risk]||C.text)+"18", borderRadius:6, padding:"3px 8px", fontSize:10, fontWeight:700, color:riskColor[f.risk]||C.text }}>{f.risk}</div>
              <div style={{ background:C.creamDk, borderRadius:6, padding:"3px 8px", fontSize:10, color:C.textMd }}>{f.currency}</div>
              <div style={{ background:C.creamDk, borderRadius:6, padding:"3px 8px", fontSize:10, color:C.textMd }}>{f.horizonte}</div>
              <div style={{ marginLeft:"auto", fontSize:10, color:C.textLt }}>TNA {f.tna}%</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PAGE: BONOS
// ============================================================
function PageBonos({ C, showUSD, lang }) {
  const t = useT(lang);
  const [selected, setSelected] = useState(null);
  const typeColor = { "Hard Dollar":"#2563EB", "CER":"#C9A84C", "LEDE":"#7C3AED" };
  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:2 }}>{t("bonos_title")}</div>
        <div style={{ fontSize:12, color:C.textMd }}>{t("bonos_sub")}</div>
      </div>
      {selected && (
        <div style={{ position:"fixed", inset:0, zIndex:80, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end" }}>
          <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"20px 18px 32px", width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <span style={{ fontWeight:800, fontSize:18, color:C.text }}>{selected.ticker}</span>
                  <span style={{ fontSize:10, fontWeight:700, color:typeColor[selected.type]||C.accent, background:(typeColor[selected.type]||C.accent)+"22", borderRadius:5, padding:"2px 7px" }}>{selected.type}</span>
                </div>
                <div style={{ fontSize:13, color:C.textMd }}>{selected.name}</div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Cerrar" style={{ background:"transparent", border:"none", padding:4, color:C.textLt, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
              {[
                ["Precio", selected.currency==="USD" ? "u$s"+selected.price : "$"+fN(Math.round(selected.price*(showUSD?1:1247.5))), null],
                ["TIR", selected.ytm ? selected.ytm+"%" : "N/A", "YTM"],
                ["Duration", selected.duration+" años", "Duration"],
                ["Vencimiento", selected.maturity.slice(0,7), null],
                ["Rating", selected.rating, null],
                ["Paridad", selected.paridad ? selected.paridad+"%" : "N/A", "Paridad"],
              ].map(([l, v, term]) => (
                <div key={l} style={{ background:C.card, borderRadius:10, border:"1px solid "+C.border, padding:"9px 12px" }}>
                  <div style={{ fontSize:9, color:C.textLt, fontWeight:600, marginBottom:2, display:"flex", alignItems:"center" }}>
                    {l}
                    {term && <InfoBadge term={term} C={C}/>}
                  </div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:"12px", marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.textMd, lineHeight:1.6 }}>{selected.desc}</div>
            </div>
            <button style={{ width:"100%", background:C.accent, color:"#fff", border:"none", borderRadius:12, padding:"13px", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Comprar</button>
          </div>
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {BONOS.map(b => (
          <button key={b.ticker} onClick={() => setSelected(b)} style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"13px 14px", textAlign:"left", cursor:"pointer", fontFamily:"inherit", width:"100%" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
                  <span style={{ fontWeight:800, fontSize:14, color:C.text }}>{b.ticker}</span>
                  <span style={{ fontSize:9, fontWeight:700, color:typeColor[b.type]||C.accent, background:(typeColor[b.type]||C.accent)+"22", borderRadius:5, padding:"2px 7px" }}>{b.type}</span>
                </div>
                <div style={{ fontSize:11, color:C.textMd }}>{b.name}</div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:15, fontWeight:800, color:C.text, fontFamily:"monospace" }}>
                  {b.currency==="USD" ? "u$s"+b.price : b.price.toFixed(1)}
                  {b.currency!=="USD" && <span style={{ fontSize:9, color:C.textLt, fontWeight:600, marginLeft:4 }}>par</span>}
                </div>
                {b.ytm && <div style={{ fontSize:11, color:C.green, fontWeight:700 }}>TIR {b.ytm}%</div>}
              </div>
            </div>
            <div style={{ display:"flex", gap:12, fontSize:10, color:C.textLt }}>
              {b.duration && <span>Duration: <strong style={{ color:C.text }}>{b.duration}a</strong></span>}
              <span>Vence: <strong style={{ color:C.text }}>{b.maturity.slice(0,7)}</strong></span>
              <span>Rating: <strong style={{ color:C.text }}>{b.rating}</strong></span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PAGE: INVESTMENT IDEAS
// ============================================================
function PageIdeas({ C, showUSD, onSelectAsset, lang }) {
  const t = useT(lang);
  const [topTab, setTopTab]     = useState("ideas");
  const [expanded, setExpanded] = useState(null);
  const riskColor = { "Bajo":C.green, "Moderado":C.gold, "Agresivo":C.red };

  const topTabs = [["ideas","Ideas"],["on","ON"],["fondos","Fondos"],["bonos","Bonos"]];

  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:2 }}>{t("inv_title")}</div>
        <div style={{ fontSize:12, color:C.textMd }}>{t("inv_sub")}</div>
      </div>
      <div style={{ display:"flex", background:C.creamDk, borderRadius:12, padding:3, gap:3, marginBottom:14 }}>
        {topTabs.map(([v,l]) => (
          <button key={v} onClick={() => setTopTab(v)}
            style={{ flex:1, padding:"9px 4px", background:v===topTab?C.card:"transparent", color:v===topTab?C.text:C.textMd, border:"none", borderRadius:9, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", boxShadow:v===topTab?"0 1px 4px rgba(0,0,0,0.1)":"none", transition:"all 0.15s" }}>
            {l}
          </button>
        ))}
      </div>
      {topTab === "on"     && <PageON C={C} showUSD={showUSD} lang={lang}/>}
      {topTab === "fondos" && <PageFondos C={C} lang={lang}/>}
      {topTab === "bonos"  && <PageBonos C={C} showUSD={showUSD} lang={lang}/>}
      {topTab === "ideas"  && <>
      <div style={{ background:C.isDark?"#0D1117":"#FFF5F5", borderRadius:12, border:"1px solid "+C.accent+"33", padding:"10px 13px", marginBottom:14, fontSize:11, color:C.textMd }}>
        Estas ideas son sugerencias del equipo de research de SAMAS y no constituyen asesoramiento financiero. Consulta a tu asesor antes de invertir.
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {IDEAS.map(idea => (
          <div key={idea.id} style={{ background:C.card, borderRadius:16, border:"1px solid "+C.border, overflow:"hidden" }}>
            <button onClick={() => setExpanded(expanded === idea.id ? null : idea.id)}
              style={{ width:"100%", background:"transparent", border:"none", cursor:"pointer", padding:"14px 16px", textAlign:"left", fontFamily:"inherit" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                    <div style={{ background:idea.color+"22", color:idea.color, borderRadius:6, padding:"2px 8px", fontSize:9, fontWeight:800 }}>{idea.tag}</div>
                    <div style={{ width:8, height:8, borderRadius:4, background:riskColor[idea.risk] }}/>
                    <span style={{ fontSize:9, color:riskColor[idea.risk], fontWeight:700 }}>{idea.risk}</span>
                  </div>
                  <div style={{ fontSize:15, fontWeight:800, color:C.text, marginBottom:3 }}>{idea.title}</div>
                  <div style={{ fontSize:11, color:C.textMd }}>{idea.subtitle}</div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0, marginLeft:12 }}>
                  <div style={{ fontSize:14, fontWeight:800, color:C.green }}>{idea.expReturn}</div>
                  <div style={{ fontSize:10, color:C.textLt }}>{idea.horizon}</div>
                </div>
              </div>
            </button>
            {expanded === idea.id && (
              <div style={{ padding:"0 16px 16px" }}>
                <div style={{ background:C.creamDk, borderRadius:10, padding:"10px 12px", marginBottom:12, fontSize:11, color:C.textMd, lineHeight:1.6 }}>
                  {idea.rationale}
                </div>
                <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:8 }}>COMPOSICION DE LA CARTERA</div>
                {idea.assets.map(a => {
                  const asset = ASSETS.find(x => x.ticker === a.ticker) || ON_DATA.find(x => x.ticker === a.ticker) || FONDOS.find(x => x.id === a.ticker);
                  return (
                    <div key={a.ticker} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid "+C.border+"44" }}>
                      <div style={{ width:36, height:8, borderRadius:4, background:idea.color, opacity: a.pct/100 + 0.3 }}/>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:C.text }}>{a.ticker}</div>
                        <div style={{ fontSize:10, color:C.textLt }}>{a.reason}</div>
                      </div>
                      <div style={{ fontSize:14, fontWeight:800, color:idea.color }}>{a.pct}%</div>
                    </div>
                  );
                })}
                <button style={{ width:"100%", marginTop:14, background:idea.color, color:"#fff", border:"none", borderRadius:12, padding:"12px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                  Armar esta cartera
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      </>}
    </div>
  );
}

// ============================================================
// PAGE: PRODUCTOS (legacy - now merged into PageIdeas)
// ============================================================
function PageProductos({ C, showUSD, onSelectAsset }) {
  const [subTab, setSubTab] = useState("on");
  const subtabs = [["on","ON"],["fondos","Fondos"],["bonos","Bonos"]];
  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:2 }}>Productos</div>
        <div style={{ fontSize:12, color:C.textMd }}>Renta fija y fondos de inversion</div>
      </div>
      <div style={{ display:"flex", background:C.creamDk, borderRadius:12, padding:3, gap:3, marginBottom:16 }}>
        {subtabs.map(([v,l]) => (
          <button key={v} onClick={() => setSubTab(v)}
            style={{ flex:1, padding:"8px", background:v===subTab?C.card:"transparent", color:v===subTab?C.text:C.textMd, border:"none", borderRadius:9, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", boxShadow:v===subTab?"0 1px 4px rgba(0,0,0,0.1)":"none", transition:"all 0.15s" }}>
            {l}
          </button>
        ))}
      </div>
      {subTab === "on"     && <PageON C={C} showUSD={showUSD}/>}
      {subTab === "fondos" && <PageFondos C={C}/>}
      {subTab === "bonos"  && <PageBonos C={C} showUSD={showUSD}/>}
    </div>
  );
}

// ============================================================
// PAGE: REPORTES COHEN (web only)
// ============================================================
const REPORTES = [
  { id:1, cat:"Estrategia",  date:"Abr 2025", title:"Perspectivas de mercado Q2 2025", summary:"Analisis del contexto macro y oportunidades de inversion para el segundo trimestre. Foco en bonos soberanos y acciones bancarias.", pages:18, download:"samas_perspectivas_q2_2025.pdf", highlight:true  },
  { id:2, cat:"Renta Fija",  date:"Mar 2025", title:"Guia de bonos soberanos argentinos 2025", summary:"Descripcion detallada de la curva soberana, analisis de TIRs por plazo y recomendaciones de posicionamiento.", pages:24, download:"samas_bonos_soberanos_2025.pdf", highlight:false },
  { id:3, cat:"Equities",    date:"Mar 2025", title:"Banking sector: recovery trade en perspectiva", summary:"Valuaciones del sector bancario argentino vs pares regionales. Analisis de GGAL, BBAR y SUPV.", pages:14, download:"samas_banking_2025.pdf", highlight:false },
  { id:4, cat:"Macro",       date:"Feb 2025", title:"Argentina: normalizacion macro y oportunidades", summary:"Analisis del programa economico, proyecciones de inflacion y tipo de cambio para 2025.", pages:32, download:"samas_macro_arg_2025.pdf", highlight:false },
  { id:5, cat:"Fondos",      date:"Feb 2025", title:"Comparativa fondos comunes Q1 2025", summary:"Rendimientos, volatilidad y ratios de Sharpe de los principales FCIs del mercado argentino.", pages:20, download:"samas_fondos_q1_2025.pdf", highlight:false },
  { id:6, cat:"ON",          date:"Ene 2025", title:"Obligaciones negociables: oportunidades en el mercado primario", summary:"Pipeline de emisiones de ONs y analisis de spreads en el mercado secundario.", pages:16, download:"samas_on_2025.pdf", highlight:false },
  { id:7, cat:"Estrategia",  date:"Ene 2025", title:"Informe anual 2024 y outlook 2025", summary:"Resumen del año 2024 y proyecciones estrategicas para el 2025. El informe mas completo del equipo.", pages:48, download:"samas_anual_2024.pdf", highlight:false },
  { id:8, cat:"Cripto",      date:"Dic 2024", title:"Bitcoin y el ecosistema cripto en 2025", summary:"Analisis del mercado cripto, adoption curves y oportunidades para inversores institucionales.", pages:22, download:"samas_cripto_2025.pdf", highlight:false },
];

function PageReportes({ C, lang }) {
  const t = useT(lang);
  const [filter, setFilter] = useState("Todos");
  const cats = ["Todos","Estrategia","Renta Fija","Equities","Macro","Fondos","ON","Cripto"];
  const filtered = filter === "Todos" ? REPORTES : REPORTES.filter(r => r.cat === filter);
  const catColor = { "Estrategia":"#16C784","Renta Fija":"#2563EB","Equities":"#7C3AED","Macro":"#C9A84C","Fondos":"#16C784","ON":"#0891B2","Cripto":"#F7931A" };
  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:22, fontWeight:800, color:C.text, marginBottom:4 }}>{t("reports_title")}</div>
        <div style={{ fontSize:12, color:C.textMd }}>{t("reports_sub")}</div>
      </div>
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:10, marginBottom:14 }}>
        {cats.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ background:f===filter?C.accent:C.card, color:f===filter?"#fff":C.textMd, border:"1.5px solid "+(f===filter?C.accent:C.border), borderRadius:20, padding:"5px 14px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}>
            {f}
          </button>
        ))}
      </div>
      {filtered[0]?.highlight && (
        <div style={{ background:"linear-gradient(135deg,"+C.accent+"22 0%,"+C.accent+"08 100%)", borderRadius:16, border:"1.5px solid "+C.accent+"44", padding:"18px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <div style={{ background:C.accent, color:"#fff", borderRadius:6, padding:"2px 10px", fontSize:10, fontWeight:800 }}>DESTACADO</div>
            <span style={{ fontSize:10, color:C.textLt }}>{filtered[0].cat} - {filtered[0].date}</span>
          </div>
          <div style={{ fontSize:17, fontWeight:800, color:C.text, marginBottom:6 }}>{filtered[0].title}</div>
          <div style={{ fontSize:12, color:C.textMd, lineHeight:1.6, marginBottom:12 }}>{filtered[0].summary}</div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:11, color:C.textLt }}>{filtered[0].pages} paginas</span>
            <button style={{ background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"8px 18px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Descargar PDF
            </button>
          </div>
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {(filtered[0]?.highlight ? filtered.slice(1) : filtered).map(r => (
          <div key={r.id} style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"14px 16px", display:"flex", gap:12 }}>
            <div style={{ width:44, height:54, borderRadius:8, background:(catColor[r.cat]||C.accent)+"18", border:"1px solid "+(catColor[r.cat]||C.accent)+"33", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={catColor[r.cat]||C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div style={{ fontSize:8, color:catColor[r.cat]||C.accent, fontWeight:700, marginTop:3 }}>PDF</div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                <span style={{ background:(catColor[r.cat]||C.accent)+"22", color:catColor[r.cat]||C.accent, fontSize:9, fontWeight:700, borderRadius:5, padding:"1px 6px" }}>{r.cat}</span>
                <span style={{ fontSize:10, color:C.textLt }}>{r.date}</span>
                <span style={{ fontSize:10, color:C.textLt, marginLeft:"auto" }}>{r.pages}p</span>
              </div>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:4, lineHeight:1.3 }}>{r.title}</div>
              <div style={{ fontSize:11, color:C.textMd, lineHeight:1.5, marginBottom:10 }}>{r.summary.slice(0,100)}...</div>
              <button style={{ background:C.creamDk, border:"1px solid "+C.border, borderRadius:8, padding:"6px 14px", fontSize:11, fontWeight:600, cursor:"pointer", color:C.text, fontFamily:"inherit", display:"flex", alignItems:"center", gap:5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Descargar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Progress card shown on the portfolio page once the user has saved a plan
// from the Objetivos wizard. Compares current portfolio value against the
// plan's target, and offers quick actions to reopen the wizard or discard.
// Inline SVG sparkline of the last N days of portfolio total. Accepts the
// persisted portfolioHistory array and highlights the current value.
function PortfolioSparkline({ history, width = 280, height = 56, stroke = "#16C784", fill = "rgba(22,199,132,0.14)" }) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const values = history.map(p => Number(p.value) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - 4) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = 2 + i * step;
    const y = 2 + (height - 4) * (1 - (v - min) / range);
    return [x, y];
  });
  const linePath = pts.map(([x, y], i) => (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  const areaPath = linePath + ` L${width - 2},${height - 1} L2,${height - 1} Z`;
  const lastX = pts[pts.length - 1][0];
  const lastY = pts[pts.length - 1][1];
  const isUp = values[values.length - 1] >= values[0];
  const color = isUp ? stroke : "#F87171";
  const areaColor = isUp ? fill : "rgba(248,113,113,0.14)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }} aria-hidden="true">
      <defs>
        <linearGradient id="spkFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spkFade)"/>
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={lastX} cy={lastY} r="2.5" fill={color}/>
    </svg>
  );
}

// Modal that lets the user program a monthly auto-contribution (or clear
// an existing one). Amount is persisted; the parent applies it on mount
// when a calendar month has passed since lastApplied.
function RecurringAporteModal({ current, onSave, onClose, C }) {
  useEscapeKey(onClose);
  const [amount, setAmount] = useState(current?.amount || 50000);
  return (
    <div className="samas-fade" style={{ position:"absolute", inset:0, zIndex:45, background:"rgba(0,0,0,0.6)", display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div className="samas-slide-up" style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"18px 18px 20px", border:"1px solid "+C.border, borderBottom:"none" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:C.accent+"22", color:C.accent, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:C.text }}>Aporte mensual automático</div>
            <div style={{ fontSize:11, color:C.textMd }}>Acredita el monto elegido a tu saldo el día 1 de cada mes.</div>
          </div>
        </div>
        <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginTop:14, marginBottom:6 }}>Monto (ARS)</div>
        <div style={{ position:"relative", marginBottom:14 }}>
          <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:C.textLt, fontSize:14, fontWeight:600, pointerEvents:"none" }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={amount > 0 ? String(amount) : ""}
            placeholder="0"
            onFocus={e => { try { e.target.select(); } catch {} }}
            onChange={e => {
              const cleaned = e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
              setAmount(cleaned === "" ? 0 : Number(cleaned));
            }}
            style={{ background:C.bg, border:"1.5px solid "+C.border, borderRadius:12, padding:"12px 12px 12px 28px", fontSize:18, fontFamily:"Sora,sans-serif", fontWeight:700, color:C.text, outline:"none", width:"100%", boxSizing:"border-box" }}
          />
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {current && (
            <button
              onClick={() => { onSave(null); onClose(); }}
              style={{ flex:1, background:C.red+"18", color:C.red, border:"1.5px solid "+C.red+"44", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}
            >
              Cancelar aporte
            </button>
          )}
          <button
            onClick={() => {
              if (amount <= 0) return onClose();
              const today = new Date().toISOString().slice(0, 10);
              onSave({ amount, lastApplied: current?.lastApplied || today });
              onClose();
            }}
            disabled={amount <= 0}
            style={{ flex:2, background: amount <= 0 ? C.creamDk : C.accent, color: amount <= 0 ? C.textLt : "#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor: amount <= 0 ? "not-allowed" : "pointer", fontFamily:"inherit" }}
          >
            {current ? "Actualizar" : "Programar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MARKET MOVERS — top 3 gainers + top 3 losers of the day
// ============================================================
// Computed from ASSETS. Rank by daily change %. Shows small rows with
// ticker + name + price + chg pct; tapping opens the asset detail.
function MarketMovers({ onSelectAsset, C }) {
  // Stable sort: tie-break on ticker alphabetical order so the same
  // ties always render in the same order instead of depending on the
  // engine's implementation detail.
  const sorted = [...ASSETS].sort((a, b) => {
    const d = (b.change || 0) - (a.change || 0);
    if (d !== 0) return d;
    return (a.ticker || "").localeCompare(b.ticker || "");
  });
  const gainers = sorted.slice(0, 3);
  const losers  = sorted.slice(-3).reverse();
  const row = (a) => (
    <button
      key={a.ticker}
      onClick={() => onSelectAsset && onSelectAsset(a)}
      style={{ width:"100%", background:"transparent", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:8, padding:"7px 2px", borderBottom:"1px solid "+C.border+"33", fontFamily:"inherit", textAlign:"left" }}
    >
      <AssetLogo asset={a} size={24} C={C}/>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:700, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.ticker}</div>
        <div style={{ fontSize:9, color:C.textLt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</div>
      </div>
      {/* flexShrink:0 keeps the price block from being squeezed; overflow
          pressure is taken by the ticker/name column instead. */}
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontSize:11, fontWeight:700, fontFamily:"monospace", color:C.text }}>${fN(a.price)}</div>
        <div style={{ fontSize:10, fontWeight:800, color: a.up ? C.green : C.red }}>
          {a.up ? "+" : "-"}{Math.abs(a.change).toFixed(2)}%
        </div>
      </div>
    </button>
  );
  return (
    <div style={{ padding:"12px 14px 0" }}>
      <div style={{ fontSize:11, fontWeight:700, color:C.textMd, marginBottom:8, letterSpacing:0.5 }}>Top del día</div>
      {/* minmax(0, 1fr) forces each column to stay within its fraction even
          when the ticker / price content is wide — without this, long
          strings on one side push it out of the 50/50 split. */}
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:8 }}>
        <div style={{ background:C.card, border:"1px solid "+C.green+"33", borderRadius:12, padding:"10px 12px", minWidth:0 }}>
          <div style={{ fontSize:9, fontWeight:800, color:C.green, letterSpacing:1, textTransform:"uppercase", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            Mayores subas
          </div>
          {gainers.map(row)}
        </div>
        <div style={{ background:C.card, border:"1px solid "+C.red+"33", borderRadius:12, padding:"10px 12px", minWidth:0 }}>
          <div style={{ fontSize:9, fontWeight:800, color:C.red, letterSpacing:1, textTransform:"uppercase", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
            Mayores bajas
          </div>
          {losers.map(row)}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SHOCK TEST — what-if-history-repeated scenario panel
// ============================================================
// Applies a simulated percentage shock to the current total portfolio and
// shows what the new value would be. Doesn't mutate state; purely a "try
// this mentally" aid so users grok volatility.
function ShockTestPanel({ totalValue, C }) {
  const [selected, setSelected] = useState(null);
  const scenarios = [
    { id: "covid",   label: "Crash COVID (2020)",   pct: -30, note: "Marzo 2020: S&P cae 30% en 4 semanas." },
    { id: "gfc",     label: "Gran crisis 2008",     pct: -37, note: "S&P cae 37% en el año. Recuperación en 2 años." },
    { id: "dotcom",  label: "Burbuja .com (2000)",  pct: -49, note: "Nasdaq pierde casi 80% entre 2000 y 2002." },
    { id: "bull",    label: "Rally fuerte",         pct: +25, note: "Semestre alcista tipo post-COVID 2020." },
  ];
  if (!totalValue || totalValue <= 0) return null;
  return (
    <div style={{ margin:"14px 14px 0", background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color:C.text, display:"flex", alignItems:"center", gap:6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textMd} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Shock test
          </div>
          <div style={{ fontSize:10, color:C.textMd, marginTop:1 }}>Simulá qué pasaría con tu cartera en escenarios históricos</div>
        </div>
        {selected && (
          <button onClick={() => setSelected(null)} style={{ background:"transparent", border:"none", fontSize:11, color:C.textLt, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>Limpiar</button>
        )}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
        {scenarios.map(s => {
          const active = selected?.id === s.id;
          const isDown = s.pct < 0;
          return (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              style={{
                background: active ? (isDown ? C.red + "22" : C.green + "22") : C.bg,
                border: "1.5px solid " + (active ? (isDown ? C.red + "66" : C.green + "66") : C.border),
                color: active ? (isDown ? C.red : C.green) : C.textMd,
                borderRadius: 10,
                padding: "5px 9px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {s.label} <span style={{ fontFamily:"monospace" }}>{s.pct > 0 ? "+" : ""}{s.pct}%</span>
            </button>
          );
        })}
      </div>
      {selected && (() => {
        const newValue = Math.max(0, Math.round(totalValue * (1 + selected.pct / 100)));
        const delta    = newValue - totalValue;
        const isDown   = delta < 0;
        return (
          <div className="samas-fade" style={{ background: isDown ? C.red + "14" : C.green + "14", border: "1px solid " + (isDown ? C.red + "44" : C.green + "44"), borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize:9, fontWeight:800, color: isDown ? C.red : C.green, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>{selected.label}</div>
            <div style={{ fontSize:10, color:C.textMd, lineHeight:1.4, marginBottom:8 }}>{selected.note}</div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
              <div>
                <div style={{ fontSize:9, color:C.textLt, fontWeight:700 }}>Tu cartera quedaría en</div>
                <div style={{ fontSize:18, fontWeight:800, color: isDown ? C.red : C.green, fontFamily:"monospace" }}>${fN(newValue)}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:C.textLt, fontWeight:700 }}>Impacto</div>
                <div style={{ fontSize:14, fontWeight:800, color: isDown ? C.red : C.green, fontFamily:"monospace" }}>
                  {isDown ? "-" : "+"}${fN(Math.abs(delta))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ============================================================
// REBALANCE HINT — compares holdings allocation vs saved plan
// ============================================================
// Maps each holding to its SAMAS category via ASSETS, aggregates the
// current % per category, and compares against the plan's target
// allocation. Flags categories that are >5 percentage points off.
const TICKER_TO_CAT = (ticker) => {
  const a = ASSETS.find(x => x.ticker === ticker);
  if (!a) return "Cash";
  if (a.cat === "Acciones")  return "Acciones";
  if (a.cat === "CEDEAR")    return "CEDEAR";
  if (a.cat === "ETF")       return "ETF";
  if (a.cat === "Commodity") return "ETF";   // commodity ETFs group with ETF
  if (a.cat === "Crypto")    return "Crypto";
  return "Acciones";
};
function RebalanceHint({ holdings, plan, C }) {
  if (!plan || !Array.isArray(plan.allocation) || plan.allocation.length === 0) return null;
  if (!holdings || holdings.length === 0) return null;
  // Current allocation from holdings value.
  const current = {};
  let total = 0;
  holdings.forEach(h => {
    const a = ASSETS.find(x => x.ticker === h.ticker);
    if (!a) return;
    const v = h.qty * a.price;
    const cat = TICKER_TO_CAT(h.ticker);
    current[cat] = (current[cat] || 0) + v;
    total += v;
  });
  if (total === 0) return null;
  const diffs = plan.allocation
    .map(p => {
      const currentPct = ((current[p.name] || 0) / total) * 100;
      const diff = currentPct - p.percent;
      return { name: p.name, target: p.percent, current: currentPct, diff };
    })
    .filter(d => Math.abs(d.diff) > 5)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 4);
  if (diffs.length === 0) {
    return (
      <div style={{ margin:"14px 14px 0", background:C.green + "14", border:"1px solid "+C.green+"44", borderRadius:14, padding:"11px 14px", display:"flex", alignItems:"center", gap:10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <div style={{ fontSize:12, color:C.text, lineHeight:1.4 }}>Tu cartera está <strong>alineada con el plan</strong>. Todas las categorías dentro de ±5pp del target.</div>
      </div>
    );
  }
  return (
    <div style={{ margin:"14px 14px 0", background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
        <div style={{ fontSize:12, fontWeight:700, color:C.text }}>Rebalanceo sugerido</div>
      </div>
      <div style={{ fontSize:10.5, color:C.textMd, marginBottom:10, lineHeight:1.5 }}>Estas categorías están lejos de tu plan. Considerá ajustar en próximas compras / ventas.</div>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {diffs.map(d => {
          const over = d.diff > 0;
          const col  = over ? C.gold : C.accent;
          return (
            <div key={d.name} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", background:C.bg, border:"1px solid "+C.border, borderRadius:10 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.text, minWidth:64 }}>{d.name}</div>
              <div style={{ flex:1, display:"flex", gap:3, alignItems:"center", fontSize:10 }}>
                <span style={{ color:C.textLt, fontFamily:"monospace" }}>actual {d.current.toFixed(0)}%</span>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                <span style={{ color:C.accent, fontWeight:700, fontFamily:"monospace" }}>target {d.target}%</span>
              </div>
              <div style={{ fontSize:10, fontWeight:800, color:col, fontFamily:"monospace", background:col+"22", borderRadius:6, padding:"2px 6px" }}>
                {over ? "+" : "−"}{Math.abs(d.diff).toFixed(0)}pp
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:9, color:C.textLt, marginTop:8, lineHeight:1.4 }}>
        <strong style={{ color:C.text }}>+</strong> = exceso (vender para bajar), <strong style={{ color:C.text }}>−</strong> = falta (comprar para subir). Unidad: puntos porcentuales (pp).
      </div>
    </div>
  );
}

// ============================================================
// KEYBOARD SHORTCUTS HELP MODAL — shown via "?" key
// ============================================================
function ShortcutsHelpModal({ onClose, C }) {
  useEscapeKey(onClose);
  const items = [
    { keys: ["G", "P"], desc: "Ir a Portafolio" },
    { keys: ["G", "M"], desc: "Ir a Mercado" },
    { keys: ["G", "W"], desc: "Ir a Watchlist" },
    { keys: ["G", "N"], desc: "Ir a Noticias" },
    { keys: ["G", "O"], desc: "Ir a Órdenes" },
    { keys: ["?"],      desc: "Mostrar esta ayuda" },
    { keys: ["Esc"],    desc: "Cerrar modal abierto" },
  ];
  const content = (
    <div className="samas-fade" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div className="samas-slide-up" onClick={e => e.stopPropagation()} style={{ background:C.bg, border:"1px solid "+C.border, borderRadius:16, maxWidth:380, width:"100%", padding:"18px 20px 18px", boxShadow:"0 24px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontSize:15, fontWeight:800, color:C.text }}>Atajos de teclado</div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background:"transparent", border:"none", padding:4, color:C.textMd, cursor:"pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", borderBottom: i < items.length - 1 ? "1px solid "+C.border+"66" : "none" }}>
              <div style={{ display:"flex", gap:4, minWidth:70 }}>
                {it.keys.map((k, j) => (
                  <kbd key={j} style={{ background:C.creamDk, border:"1px solid "+C.border, borderRadius:5, padding:"2px 7px", fontSize:10, fontFamily:"monospace", fontWeight:700, color:C.text }}>{k}</kbd>
                ))}
              </div>
              <div style={{ fontSize:12, color:C.text }}>{it.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize:10, color:C.textLt, marginTop:14, textAlign:"center" }}>Tip: presioná <kbd style={{ background:C.creamDk, border:"1px solid "+C.border, borderRadius:4, padding:"1px 5px", fontSize:9, fontFamily:"monospace" }}>G</kbd> y después la segunda tecla.</div>
      </div>
    </div>
  );
  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}

function PlanProgressCard({ plan, currentValue, onOpen, onClear, C }) {
  const { confirm, ConfirmHost } = useConfirm(C);
  const profile = plan?._profile || {};
  const target  = Number(profile.targetAmount) || 0;
  const pct     = target > 0 ? Math.min(100, Math.max(0, (currentValue / target) * 100)) : 0;
  const strat   = plan?.strategy || "moderada";
  const stratColor =
    strat === "conservadora" ? "#0EA5E9" :
    strat === "agresiva"     ? "#F7931A" :
    "#C9A84C";
  // Saved-at timestamp (if stored) → "hace X dias"
  const savedAt = plan?._savedAt ? new Date(plan._savedAt) : null;
  const daysAgo = savedAt ? Math.max(0, Math.floor((Date.now() - savedAt.getTime()) / 86400000)) : null;
  return (
    <div style={{ margin:"12px 14px 0", background:"linear-gradient(135deg, "+stratColor+"18, #7C3AED12)", border:"1px solid "+stratColor+"55", borderRadius:14, padding:"14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
        <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,"+stratColor+",#7C3AED)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
          </svg>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:700, color:stratColor, letterSpacing:1, textTransform:"uppercase" }}>Mi plan</div>
          <div style={{ fontSize:13, fontWeight:700, color:C.text, textTransform:"capitalize" }}>
            Estrategia {strat}
            {daysAgo !== null && (
              <span style={{ fontSize:10, fontWeight:500, color:C.textLt, marginLeft:6 }}>
                · {daysAgo === 0 ? "hoy" : daysAgo === 1 ? "ayer" : "hace " + daysAgo + " dias"}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: "Borrar el plan guardado?",
              body: "Se va a perder la estrategia y los datos del perfil. Podes armar uno nuevo despues.",
              confirmLabel: "Borrar",
              cancelLabel: "Cancelar",
              danger: true,
            });
            if (ok) onClear && onClear();
          }}
          aria-label="Borrar plan"
          style={{ background:"transparent", border:"none", padding:4, cursor:"pointer", color:C.textLt }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>

      {target > 0 && (
        <>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textMd, marginBottom:5 }}>
            <span>${Math.round(currentValue).toLocaleString("es-AR")}</span>
            <span style={{ fontWeight:700, color:stratColor }}>{pct.toFixed(1)}%</span>
            <span>${Math.round(target).toLocaleString("es-AR")}</span>
          </div>
          <div style={{ height:8, borderRadius:4, background:C.creamDk, overflow:"hidden", marginBottom:12 }}>
            <div style={{ width: pct + "%", height:"100%", background: stratColor, transition:"width 0.3s" }}/>
          </div>
        </>
      )}

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
        {(plan.allocation || []).slice(0, 6).map((a, i) => (
          <span key={i} style={{ fontSize:10, color:C.text, background:C.card, border:"1px solid "+C.border, borderRadius:8, padding:"3px 7px", fontWeight:600 }}>
            {a.name} <span style={{ color:C.textMd, fontFamily:"monospace" }}>{a.percent}%</span>
          </span>
        ))}
      </div>

      <button
        onClick={() => onOpen && onOpen()}
        style={{ width:"100%", background:stratColor, color:"#fff", border:"none", borderRadius:10, padding:"9px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}
      >
        Revisar mi plan
      </button>
      <ConfirmHost/>
    </div>
  );
}

// Empty-state onboarding card shown on a fresh portfolio (no holdings, no
// saved plan). Three CTAs guide the user into the three core flows.
function OnboardingEmptyState({ onOpenObjectives, onSelectAsset, onDeposit, C }) {
  // Pick a couple of recognizable CEDEAR tickers as the "pick one" nudge.
  // These are the most liquid names in the SAMAS seed data.
  const suggested = ["AAPL", "NVDA", "SPY"].map(t => ASSETS.find(a => a.ticker === t)).filter(Boolean);
  return (
    <div
      className="samas-slide-up"
      style={{
        margin:"12px 14px 0",
        background:"linear-gradient(135deg, "+C.accent+"14, "+C.card+" 60%)",
        border:"1px solid "+C.accent+"44",
        borderRadius:16,
        padding:"18px 16px 14px",
        position:"relative",
        overflow:"hidden",
      }}
    >
      {/* Decorative glow */}
      <div aria-hidden style={{ position:"absolute", top:-40, right:-40, width:140, height:140, borderRadius:"50%", background: C.accent, opacity:0.08, filter:"blur(20px)", pointerEvents:"none" }}/>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4, position:"relative" }}>
        <div style={{ width:32, height:32, borderRadius:10, background:"linear-gradient(135deg, "+C.accent+", #7C3AED)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <span style={{ fontSize:16 }}>👋</span>
        </div>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:C.text }}>Arranquemos por aca</div>
          <div style={{ fontSize:10.5, color:C.textMd, marginTop:1 }}>Tres cosas simples para empezar</div>
        </div>
      </div>
      <div style={{ marginTop:14 }}/>

      <OnboardingRow
        n={1}
        title="Armar tu plan con IA"
        body="SAMAS IA analiza ingreso y gastos y te sugiere la estrategia."
        cta="Empezar"
        onClick={onOpenObjectives}
        accent={C.accent}
        C={C}
      />

      <OnboardingRow
        n={2}
        title="Tu primera compra simulada"
        body="Tocá un activo conocido y probá el flujo de orden."
        cta={null}
        C={C}
      >
        <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
          {suggested.map(a => (
            <button
              key={a.ticker}
              onClick={() => onSelectAsset && onSelectAsset(a)}
              style={{ background:C.bg, border:"1.5px solid "+C.border, borderRadius:10, padding:"6px 10px", display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontFamily:"inherit" }}
            >
              <AssetLogo asset={a} size={20} C={C}/>
              <span style={{ fontSize:11, fontWeight:700, color:C.text }}>{a.ticker}</span>
              <span style={{ fontSize:10, fontWeight:700, color: a.up ? C.green : C.red }}>
                {a.up ? "+" : "-"}{Math.abs(a.change).toFixed(1)}%
              </span>
            </button>
          ))}
        </div>
      </OnboardingRow>

      <OnboardingRow
        n={3}
        title="Fondear tu cuenta"
        body="Simulá un deposito para tener saldo antes de operar."
        cta="Depositar"
        onClick={onDeposit}
        accent={C.gold}
        C={C}
      />
    </div>
  );
}

function OnboardingRow({ n, title, body, cta, onClick, accent, children, C }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 0", borderTop:"1px solid "+C.border }}>
      <div style={{ width:22, height:22, borderRadius:11, background:(accent || C.accent)+"22", color:accent || C.accent, fontSize:11, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>{n}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:C.text, marginBottom:2 }}>{title}</div>
        <div style={{ fontSize:10.5, color:C.textMd, lineHeight:1.5 }}>{body}</div>
        {children}
      </div>
      {cta && (
        <button
          onClick={onClick}
          style={{ background:accent || C.accent, color:"#fff", border:"none", borderRadius:9, padding:"6px 11px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flexShrink:0, alignSelf:"center" }}
        >
          {cta}
        </button>
      )}
    </div>
  );
}

function PagePortfolio({ holdings, stopLosses, balance, watchlist, onToggleWatchlist, onSelectAsset, onDeposit, onOpenObjectives, savedPlan, onClearPlan, portfolioHistory, recurringAporte, onSetRecurring, C, showUSD, lang, uiMode }) {
  // In beginner mode ("principiante") we hide the dense advanced surfaces
  // (shock test, rebalanceo, market movers) and keep the page focused on
  // the minimum: balance, holdings, distribution, positions.
  const isPro = uiMode !== "principiante";
  // Debug badge — temporary, very visible, so we can confirm at a glance
  // that the toggle in Settings is actually flipping uiMode down here.
  // Remove once we trust the wiring.
  const t = useT(lang);
  // Privacy toggle: when true, amounts in the hero card are replaced with dots.
  // Percent gain is still shown so the user sees direction without a dollar figure.
  const [hideValues, setHideValues] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const mask = "••••••";
  const enriched = holdings.map(h => {
    const a = ASSETS.find(x => x.ticker === h.ticker);
    if (!a) return null;
    const val = h.qty * a.price, cost = h.qty * h.avg;
    // Guard: holding.avg could be 0 on a malformed record, which would
    // produce NaN% and break the colored gain chip downstream.
    const gPct = h.avg > 0 ? ((a.price - h.avg) / h.avg) * 100 : 0;
    return { ...h, a, val, cost, gAbs:val-cost, gPct };
  }).filter(Boolean);
  const tv = enriched.reduce((s, h) => s + h.val, 0);
  const tc = enriched.reduce((s, h) => s + h.cost, 0);
  const gA = tv - tc;
  const pal = [C.accent,"#7C3AED",C.green,C.gold,"#2563EB","#F7931A"];
  const fmtAmt = (amount) => hideValues ? mask : (showUSD ? "u$s" + fN(Math.round(amount/1247.5)) : "$" + fN(amount));
  return (
    <div style={{ paddingBottom:16 }}>
      <div style={{ background:C.isDark ? "linear-gradient(150deg,#0D1117 0%,#1F1F1F 100%)" : "linear-gradient(150deg,#0D1117 0%,#1F1F1F 100%)", margin:"14px 14px 0", borderRadius:20, padding:"20px 18px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", right:-20, top:-20, width:120, height:120, borderRadius:"50%", background:C.accent, opacity:0.08 }}/>
        {/* Privacy toggle — eye icon sits top-right of the hero card */}
        <button
          onClick={() => setHideValues(v => !v)}
          aria-label={hideValues ? "Mostrar valores" : "Ocultar valores"}
          title={hideValues ? "Mostrar valores" : "Ocultar valores"}
          style={{ position:"absolute", top:14, right:14, zIndex:2, background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0 }}
        >
          {hideValues ? (
            /* eye-off */
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            /* eye */
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, flexWrap:"wrap" }}>
          <div style={{ color:C.goldLt, fontSize:9, fontWeight:700, letterSpacing:2, textTransform:"uppercase" }}>{t("total_portfolio")}</div>
          {/* UI mode badge — live reflection of profiles.ui_mode. */}
          <span style={{ background: isPro ? "rgba(22,199,132,0.18)" : "rgba(201,168,76,0.22)", border: "1px solid " + (isPro ? "rgba(22,199,132,0.45)" : "rgba(201,168,76,0.45)"), color: isPro ? "#4ADE80" : "#E8C97A", fontSize:8, fontWeight:800, letterSpacing:1, padding:"2px 6px", borderRadius:5 }}>{isPro ? "PRO" : "SIMPLE"}</span>
        </div>
        {/* Total + today's change pill. Today's change is derived from
            portfolioHistory (last two data points). If we don't have
            enough history (brand-new account), we hide the pill. */}
        <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap", marginBottom:6 }}>
          <div style={{ color:"#fff", fontSize:30, fontWeight:700, letterSpacing:-1, fontFamily: hideValues ? "monospace" : "inherit" }}>{fmtAmt(tv)}</div>
          {(() => {
            const hist = Array.isArray(portfolioHistory) ? portfolioHistory : [];
            if (hideValues || hist.length < 2) return null;
            const prev = hist[hist.length - 2]?.value || 0;
            if (prev <= 0) return null;
            const dChange = tv - prev;
            const dPct = (dChange / prev) * 100;
            const up = dChange >= 0;
            return (
              <span style={{
                background: up ? "rgba(74,222,128,0.16)" : "rgba(248,113,113,0.16)",
                color: up ? "#4ADE80" : "#F87171",
                border: "1px solid " + (up ? "rgba(74,222,128,0.4)" : "rgba(248,113,113,0.4)"),
                borderRadius: 8,
                padding: "3px 8px",
                fontSize: 11, fontWeight: 800,
                whiteSpace: "nowrap",
              }}>
                {up ? "+" : "−"}{showUSD ? "u$s"+fN(Math.round(Math.abs(dChange)/1247.5)) : "$"+fN(Math.abs(dChange))} <span style={{ opacity: 0.85 }}>({up ? "+" : "−"}{Math.abs(dPct).toFixed(2)}%) hoy</span>
              </span>
            );
          })()}
        </div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          <div><div style={{ color:"rgba(255,255,255,0.5)", fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>{t("invested")}</div><div style={{ color:"#fff", fontWeight:600, fontSize:13, fontFamily:"monospace" }}>{fmtAmt(tc)}</div></div>
          <div><div style={{ color:"rgba(255,255,255,0.5)", fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>{t("gain")}</div><div style={{ color: gA >= 0 ? C.green : C.red, fontWeight:700, fontSize:14 }}>{hideValues ? mask : (gA >= 0 ? "+" : "-") + (showUSD ? "u$s" + fN(Math.round(Math.abs(gA)/1247.5)) : "$" + fN(Math.abs(gA)))} ({gA >= 0 ? "+" : ""}{((gA/tc)*100).toFixed(1)}%)</div></div>
          <div><div style={{ color:"rgba(255,255,255,0.5)", fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>{t("available")}</div><div style={{ color: balance > 0 ? "#4ADE80" : "#F87171", fontWeight:700, fontSize:14, fontFamily:"monospace" }}>{fmtAmt(balance)}</div></div>
        </div>
        <div style={{ marginTop:10, display:"flex", gap:8 }}>
          {FX.map(fx => <div key={fx.label} style={{ background:"rgba(255,255,255,0.1)", borderRadius:8, padding:"4px 10px" }}><div style={{ color:"rgba(255,255,255,0.5)", fontSize:8, fontWeight:700 }}>USD {fx.label}</div><div style={{ color:"#fff", fontSize:12, fontFamily:"monospace", fontWeight:700 }}>{hideValues ? mask : "u$s"+fN(Math.round(tv/fx.value))}</div></div>)}
        </div>
        {/* Portfolio-value sparkline — shows last ~30 days of history.
            Hidden when:
              - the user flipped the privacy eye off,
              - they're in beginner mode (line charts overwhelm new users),
              - the current portfolio value is 0 (account just funded /
                reset → showing a chart that ends at 0 is misleading,
                produces silly numbers like "-99.4%" if there's stale
                history from before a reset). */}
        {(() => {
          // Guard the chart against insane numbers from stale history.
          // Cases we hide:
          //   - tv == 0 (account empty / just reset)
          //   - history < 2 points
          //   - first point is so small relative to last that the % is
          //     obviously bogus (≥1000% gain or ≥90% loss): that's not
          //     a real portfolio swing in 30 days, it's the leftover
          //     of a previous reset still in the row.
          if (!isPro || hideValues || tv <= 0) return null;
          const hist = Array.isArray(portfolioHistory) ? portfolioHistory : [];
          if (hist.length < 2) return null;
          const start = hist[0]?.value || 0;
          const end   = hist[hist.length - 1]?.value || 0;
          if (start <= 0 || end <= 0) return null;
          const pct = ((end - start) / start) * 100;
          if (pct >= 1000 || pct <= -90) return null;
          const up = end >= start;
          return (
          <div style={{ marginTop:14, background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"8px 10px 6px", border:"1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <span style={{ color:"rgba(255,255,255,0.5)", fontSize:8, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Últimos {hist.length} días</span>
              <span style={{ fontSize:10, fontWeight:700, color: up ? "#4ADE80" : "#F87171", fontFamily:"monospace" }}>
                {up ? "+" : "-"}{Math.abs(pct).toFixed(1)}%
              </span>
            </div>
            <PortfolioSparkline history={portfolioHistory} width={320} height={48}/>
          </div>
          );
        })()}
        {/* Fund / withdraw actions */}
        <div style={{ marginTop:14, display:"flex", gap:8 }}>
          <button onClick={() => setShowDeposit(true)} style={{ flex:1, background:C.accent, color:"#fff", border:"none", borderRadius:11, padding:"11px", fontWeight:600, fontSize:13, fontFamily:"Sora,sans-serif", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Depositar
          </button>
          <button disabled style={{ flex:1, background:"rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.5)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:11, padding:"11px", fontWeight:600, fontSize:13, fontFamily:"Sora,sans-serif", cursor:"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }} title="Proximamente">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            Retirar
          </button>
        </div>
        {/* Recurring monthly aporte shortcut. Shows either a configure CTA
            or the current programmed amount with a click-to-edit. */}
        <button
          onClick={() => setShowRecurring(true)}
          style={{
            marginTop:10, width:"100%",
            background: recurringAporte ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)",
            border: "1px solid " + (recurringAporte ? "rgba(74,222,128,0.35)" : "rgba(255,255,255,0.1)"),
            borderRadius: 11,
            padding: "9px 12px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={recurringAporte ? "#4ADE80" : "rgba(255,255,255,0.5)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style={{ fontSize:12, fontWeight:600, color:recurringAporte ? "#4ADE80" : "rgba(255,255,255,0.7)" }}>
              {recurringAporte ? `Aporte mensual: $${fN(recurringAporte.amount)}` : "Programar aporte mensual"}
            </span>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      {showRecurring && (
        <RecurringAporteModal current={recurringAporte} onSave={onSetRecurring} onClose={() => setShowRecurring(false)} C={C}/>
      )}
      {showDeposit && (
        <DepositModal user={DEMO_USER} onClose={() => setShowDeposit(false)} onSimulate={(amt, method) => onDeposit && onDeposit(amt, method)} C={C}/>
      )}
      {/* AI Objectives: banner when there's no saved plan, progress card
          when there is one. Modal itself is hoisted to MobileApp /
          WebDashboard level so its absolute-positioned backdrop isn't
          clipped by this page's scroll container. */}
      {!savedPlan && (
        <button
          onClick={() => onOpenObjectives && onOpenObjectives()}
          style={{
            margin:"12px 14px 0",
            width:"calc(100% - 28px)",
            background:"linear-gradient(135deg, "+C.accent+"22, #7C3AED22)",
            border:"1px solid "+C.accent+"55",
            borderRadius:14,
            padding:"12px 14px",
            display:"flex",
            alignItems:"center",
            gap:12,
            cursor:"pointer",
            fontFamily:"inherit",
            textAlign:"left",
          }}
        >
          <div style={{ width:38, height:38, borderRadius:10, background:"linear-gradient(135deg,"+C.accent+",#7C3AED)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
            </svg>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
              <span style={{ fontSize:13, fontWeight:700, color:C.text }}>Armar mi plan con IA</span>
              <span style={{ fontSize:8, fontWeight:800, background:C.accent, color:"#0D1117", borderRadius:4, padding:"1px 5px", letterSpacing:0.5 }}>NUEVO</span>
            </div>
            <div style={{ fontSize:10.5, color:C.textMd, lineHeight:1.4 }}>
              SAMAS IA analiza tu ingreso, gastos y objetivo y te arma la estrategia.
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      )}
      {savedPlan && (
        <PlanProgressCard plan={savedPlan} currentValue={tv} onOpen={onOpenObjectives} onClear={onClearPlan} C={C}/>
      )}

      {/* Onboarding for fresh accounts: no holdings, no orders, no plan.
          Nudges the user toward the three core actions. Disappears as soon
          as any of them happens. */}
      {enriched.length === 0 && !savedPlan && (
        <OnboardingEmptyState
          onOpenObjectives={onOpenObjectives}
          onSelectAsset={onSelectAsset}
          onDeposit={() => setShowDeposit(true)}
          C={C}
        />
      )}
      <div style={{ margin:"12px 14px 0", background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"12px 14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.textMd, marginBottom:8 }}>{t("distribution")}</div>
        <div style={{ display:"flex", height:10, borderRadius:5, overflow:"hidden", gap:2 }}>{enriched.map((h, i) => {
          // Guard: tv can be 0 if all holdings momentarily have a 0 price
          // (e.g. during a Finnhub outage). Avoid NaN%/Infinity% widths.
          const pct = tv > 0 ? (h.val / tv) * 100 : 0;
          return <div key={h.ticker} style={{ width: pct.toFixed(1) + "%", background:pal[i%pal.length], borderRadius:2 }}/>;
        })}</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 14px", marginTop:8 }}>{enriched.map((h, i) => {
          const pct = tv > 0 ? (h.val / tv) * 100 : 0;
          return <div key={h.ticker} style={{ display:"flex", alignItems:"center", gap:4 }}><div style={{ width:8, height:8, borderRadius:2, background:pal[i%pal.length] }}/><span style={{ fontSize:10, color:C.textMd }}>{h.ticker} {pct.toFixed(0)}%</span></div>;
        })}</div>
      </div>
      <div style={{ padding:"12px 14px 0" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.textMd, marginBottom:8 }}>{t("positions")}</div>
        <div style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 1.2fr 1fr", padding:"8px 14px", background:C.creamDk, borderBottom:"1px solid "+C.border }}>
            {["Activo","Valor","Ganancia","Stop"].map(h => <div key={h} style={{ fontSize:9, fontWeight:700, color:C.textLt, letterSpacing:1, textTransform:"uppercase", textAlign: h === "Activo" ? "left" : "right" }}>{h}</div>)}
          </div>
          {enriched.map((h, i) => {
            const hasSL = stopLosses[h.ticker];
            const slPct = hasSL ? (((hasSL - h.a.price) / h.a.price) * 100).toFixed(1) : null;
            return (
              <div key={h.ticker} onClick={() => onSelectAsset(h.a)} style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 1.2fr 1fr", padding:"11px 14px", borderBottom: i < enriched.length-1 ? "1px solid "+C.border+"44" : "none", alignItems:"center", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <AssetLogo asset={h.a} size={28} C={C}/>
                  <div><div style={{ fontWeight:700, fontSize:13, color:C.text }}>{h.ticker}</div><div style={{ fontSize:10, color:C.textLt }}>{h.qty} u</div></div>
                </div>
                <div style={{ textAlign:"right" }}><div style={{ fontSize:12, fontWeight:700, fontFamily:"monospace", color:C.text }}>{fARS(h.val)}</div></div>
                <div style={{ textAlign:"right" }}><div style={{ fontSize:12, fontWeight:700, color: h.gPct >= 0 ? C.green : C.red }}>{h.gPct >= 0 ? "+" : ""}{h.gPct.toFixed(1)}%</div></div>
                <div style={{ textAlign:"right" }}>{hasSL ? <div style={{ fontSize:10, fontWeight:700, color:C.red }}>SL {slPct}%</div> : <button onClick={e => { e.stopPropagation(); onSelectAsset(h.a); }} style={{ background:C.creamDk, color:C.textLt, border:"none", borderRadius:6, padding:"3px 7px", fontSize:9, cursor:"pointer", fontFamily:"inherit" }}>+SL</button>}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Advanced surfaces — hidden in "principiante" mode. These are
          the surfaces that require some technical vocabulary to parse
          (rebalance deltas, shock test scenarios, market movers). */}
      {isPro && (
        <>
          {/* Rebalance hint — only renders when there's a saved plan and
              holdings diverge materially from the target allocation. */}
          <RebalanceHint holdings={holdings} plan={savedPlan} C={C}/>

          {/* Top / bottom 3 market movers of the day. */}
          <MarketMovers onSelectAsset={onSelectAsset} C={C}/>

          {/* Shock test — lets the user simulate big historical moves
              against their current portfolio. Doesn't touch any state. */}
          <ShockTestPanel totalValue={tv} C={C}/>
        </>
      )}

      {/* Watchlist moved to its own tab (Favoritos) so the Portfolio page
          stays focused on holdings + plan. Access via the bottom nav. */}
    </div>
  );
}

// ============================================================
// WATCHLIST PICKER MODAL
// ============================================================
// Shown when the user clicks the star on an asset and has multiple
// watchlists. Pre-checks lists that currently contain the ticker,
// lets them check/uncheck multiple, plus inline "create new list".
// Rendered via portal so it escapes any overflow ancestors.
function WatchlistPickerModal({ ticker, watchlists, onConfirm, onCreate, onClose, C }) {
  useEscapeKey(onClose);
  const lists = Array.isArray(watchlists) ? watchlists : [];
  const initiallySelected = useMemo(() => {
    return new Set(lists.filter(l => (l.tickers || []).includes(ticker)).map(l => l.id));
  }, [lists, ticker]);
  const [selected, setSelected] = useState(initiallySelected);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function submitCreate() {
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(""); return; }
    onCreate && onCreate(name);
    setCreating(false);
    setNewName("");
  }
  function save() {
    onConfirm([...selected]);
    onClose();
  }

  // position:absolute so we fill the nearest positioned ancestor (the
  // phone frame in mobile view, the main column in web). No portal —
  // using document.body escapes the phone frame and the modal ends up
  // floating somewhere else in the viewport.
  return (
    <div className="samas-fade" onClick={onClose} style={{ position:"absolute", inset:0, zIndex:70, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div className="samas-slide-up" onClick={e => e.stopPropagation()} style={{ background:C.bg, borderRadius:18, maxWidth:420, width:"100%", padding:"16px 16px 16px", border:"1px solid "+C.border, maxHeight:"90%", display:"flex", flexDirection:"column", boxShadow:"0 24px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:C.gold+"22", color:C.gold, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:C.text }}>Guardar {ticker}</div>
            <div style={{ fontSize:11, color:C.textMd }}>Elegí en qué listas querés tenerlo.</div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.textMd }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* List rows */}
        <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
          {lists.map(list => {
            const isSel = selected.has(list.id);
            return (
              <button
                key={list.id}
                onClick={() => toggle(list.id)}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  background: isSel ? C.gold + "18" : C.card,
                  border: "1.5px solid " + (isSel ? C.gold + "66" : C.border),
                  borderRadius: 12,
                  padding: "10px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6,
                  border: "2px solid " + (isSel ? C.gold : C.border),
                  background: isSel ? C.gold : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {isSel && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0D1117" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{list.name}</div>
                  <div style={{ fontSize:10, color:C.textLt }}>{(list.tickers || []).length} activos</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Create new list inline */}
        {creating ? (
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            <input
              autoFocus
              value={newName}
              maxLength={40}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
              placeholder="Nombre de la nueva lista"
              style={{ flex:1, background:C.bg, border:"1.5px solid "+C.accent+"66", borderRadius:10, padding:"9px 11px", fontSize:13, color:C.text, outline:"none", fontFamily:"inherit" }}
            />
            <button onClick={submitCreate} style={{ background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"9px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Crear</button>
            <button onClick={() => { setCreating(false); setNewName(""); }} style={{ background:"transparent", color:C.textMd, border:"1px solid "+C.border, borderRadius:10, padding:"9px 10px", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            style={{ width:"100%", background:"transparent", border:"1.5px dashed "+C.border, borderRadius:10, padding:"10px", fontSize:12, fontWeight:600, color:C.textMd, cursor:"pointer", fontFamily:"inherit", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva lista
          </button>
        )}

        {/* Actions */}
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"1.5px solid "+C.border, borderRadius:12, padding:"11px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
            Cancelar
          </button>
          <button onClick={save} style={{ flex:2, background:C.accent, color:"#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ASSET PICKER — shared modal for "add asset to this list"
// ============================================================
// Shows all ASSETS with a search filter + category chips. Tapping an
// asset calls onPick(ticker). The parent decides what to do with the
// selected ticker (add to a specific list, etc.). Disables rows for
// tickers that already exist in the target context (passed via
// alreadyIn, a Set of ticker strings). Rendered via portal.
function AssetPickerModal({ title = "Agregar activo", alreadyIn, onPick, onClose, C }) {
  useEscapeKey(onClose);
  const [search, setSearch] = useState("");
  const [cat, setCat]       = useState("Todos");
  const cats = ["Todos", "Acciones", "CEDEAR", "ETF", "Commodity", "Crypto"];
  const already = alreadyIn instanceof Set ? alreadyIn : new Set(alreadyIn || []);
  const q = search.trim().toLowerCase();
  const filtered = ASSETS.filter(a => {
    if (cat !== "Todos" && a.cat !== cat) return false;
    if (q && !a.ticker.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false;
    return true;
  });
  // position:absolute so we fill the nearest positioned ancestor.
  return (
    <div className="samas-fade" onClick={onClose} style={{ position:"absolute", inset:0, zIndex:70, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div className="samas-slide-up" onClick={e => e.stopPropagation()} style={{ background:C.bg, borderRadius:18, maxWidth:420, width:"100%", padding:"16px 16px 18px", border:"1px solid "+C.border, maxHeight:"90%", display:"flex", flexDirection:"column", boxShadow:"0 24px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <div style={{ flex:1, fontSize:14, fontWeight:800, color:C.text }}>{title}</div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.textMd }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {/* Search */}
        <div style={{ position:"relative", marginBottom:10 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por ticker o nombre"
            style={{ background:C.card, border:"1.5px solid "+C.border, borderRadius:12, padding:"10px 12px 10px 34px", fontSize:13, color:C.text, outline:"none", width:"100%", boxSizing:"border-box", fontFamily:"inherit" }}
          />
        </div>
        {/* Category chips */}
        <div style={{ display:"flex", gap:6, overflowX:"auto", marginBottom:10, flexShrink:0, paddingBottom:2 }}>
          {cats.map(k => (
            <button
              key={k}
              onClick={() => setCat(k)}
              style={{ background: k === cat ? C.accent : C.card, color: k === cat ? "#fff" : C.textMd, border:"1.5px solid "+(k === cat ? C.accent : C.border), borderRadius:20, padding:"4px 11px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}
            >
              {k}
            </button>
          ))}
        </div>
        {/* Asset rows */}
        <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:4, paddingBottom:4 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign:"center", padding:"20px 12px", fontSize:11, color:C.textLt }}>Sin resultados para "{search}"</div>
          )}
          {filtered.map(a => {
            const exists = already.has(a.ticker);
            return (
              <button
                key={a.ticker}
                onClick={() => { if (!exists) { onPick(a.ticker); onClose(); } }}
                disabled={exists}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  background: exists ? "transparent" : C.card,
                  border: "1px solid " + (exists ? C.border + "55" : C.border),
                  borderRadius: 10,
                  padding: "8px 10px",
                  cursor: exists ? "not-allowed" : "pointer",
                  opacity: exists ? 0.55 : 1,
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <AssetLogo asset={a} size={26} C={C}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.text }}>{a.ticker}</div>
                    <div style={{ fontSize:8, fontWeight:700, color:C.textLt, background:C.creamDk, borderRadius:3, padding:"1px 4px" }}>{a.cat}</div>
                  </div>
                  <div style={{ fontSize:10, color:C.textLt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</div>
                </div>
                <div style={{ textAlign:"right", minWidth:56 }}>
                  <div style={{ fontSize:11, fontWeight:700, fontFamily:"monospace", color:C.text }}>${fN(a.price)}</div>
                  <div style={{ fontSize:9, fontWeight:700, color: a.up ? C.green : C.red }}>{a.up ? "+" : "-"}{Math.abs(a.change).toFixed(2)}%</div>
                </div>
                {exists ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" title="Ya está en la lista"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PAGE: FAVORITOS (multiple named watchlists)
// ============================================================
// Each list is { id, name, tickers[] }. Users can create lists with custom
// names, rename, delete, and remove tickers from within a list. Adding a
// ticker to a specific list happens via the star button on an asset row —
// that goes through the default list today, but users can then drag or
// move items between lists once we add that flow.
function PageWatchlist({ watchlists, onCreate, onRename, onRemove, onRemoveTicker, onOpenAssetPicker, onSelectAsset, C, showUSD }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName]   = useState("");
  const [creating, setCreating]   = useState(false);
  const [newName, setNewName]     = useState("");
  // In-app confirm — replaces native window.confirm() which sometimes gets
  // suppressed inside nested overlays (mobile frame -> modal).
  const { confirm, ConfirmHost } = useConfirm(C);
  // Per-list collapsed state, persisted so your choice sticks across
  // sessions. All lists start expanded; toggle via the header chevron or
  // anywhere on the list's title row that isn't a button.
  const [collapsed, setCollapsed] = usePersistedState("samas_watchlist_collapsed", {});
  const toggleCollapsed = (id) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  const lists = Array.isArray(watchlists) ? watchlists : [];
  const total = lists.reduce((s, l) => s + (l.tickers?.length || 0), 0);
  const expandAll = () => setCollapsed({});
  const collapseAll = () => setCollapsed(Object.fromEntries(lists.map(l => [l.id, true])));
  const anyCollapsed = lists.some(l => collapsed[l.id]);

  function submitCreate() {
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(""); return; }
    onCreate && onCreate(name);
    setCreating(false);
    setNewName("");
  }
  function submitRename() {
    if (editingId && editName.trim()) onRename && onRename(editingId, editName.trim());
    setEditingId(null);
    setEditName("");
  }

  return (
    <div style={{ padding:"14px 14px 20px" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:14, gap:10 }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:18, fontWeight:800, color:C.text, display:"flex", alignItems:"center", gap:8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill={C.gold} stroke={C.gold} strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Watchlist
          </div>
          <div style={{ fontSize:10.5, color:C.textMd, marginTop:2 }}>{lists.length} {lists.length === 1 ? "lista" : "listas"} · {total} activos</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          {lists.length > 1 && (
            <button
              onClick={anyCollapsed ? expandAll : collapseAll}
              style={{ background:"transparent", color:C.textMd, border:"1px solid "+C.border, borderRadius:10, padding:"7px 10px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}
            >
              {anyCollapsed ? "Expandir" : "Colapsar"}
            </button>
          )}
          <button
            onClick={() => { setCreating(true); }}
            style={{ background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"7px 12px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:5 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva lista
          </button>
        </div>
      </div>

      {/* Inline "create list" row */}
      {creating && (
        <div className="samas-slide-up" style={{ background:C.card, border:"1.5px solid "+C.accent+"55", borderRadius:12, padding:"10px 12px", marginBottom:10, display:"flex", gap:8 }}>
          <input
            autoFocus
            value={newName}
            maxLength={40}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
            placeholder="Nombre de la lista (ej. Tech, Largo plazo)"
            style={{ flex:1, background:C.bg, border:"1.5px solid "+C.border, borderRadius:10, padding:"9px 11px", fontSize:13, color:C.text, outline:"none", fontFamily:"inherit" }}
          />
          <button onClick={submitCreate} style={{ background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"9px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Crear</button>
          <button onClick={() => { setCreating(false); setNewName(""); }} style={{ background:"transparent", border:"1px solid "+C.border, color:C.textMd, borderRadius:10, padding:"9px 12px", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>X</button>
        </div>
      )}

      {/* Lists */}
      {lists.length === 0 && !creating && (
        <div style={{ background:C.card, borderRadius:14, border:"1.5px dashed "+C.border, padding:"28px 18px", textAlign:"center" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:8 }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>Aún no tenés listas</div>
          <div style={{ fontSize:11, color:C.textLt, lineHeight:1.5 }}>Creá una para organizar tus activos por tema (tech, energía, dolarizado, etc).</div>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {lists.map((list, idx) => {
          const tickers = list.tickers || [];
          const isEditing = editingId === list.id;
          const isCollapsed = !!collapsed[list.id];
          return (
            <div key={list.id} style={{ background:C.card, border:"1px solid "+C.border, borderRadius:14, overflow:"hidden" }}>
              {/* List header — clickable anywhere outside the action buttons
                  to toggle collapse. Chevron on the right shows current
                  state and rotates when expanded. */}
              <div
                onClick={(e) => { if (!isEditing) toggleCollapsed(list.id); }}
                style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 14px", borderBottom: !isCollapsed && tickers.length ? "1px solid "+C.border+"66" : "none", cursor: isEditing ? "default" : "pointer", userSelect: "none" }}
              >
                <div style={{ width:28, height:28, borderRadius:8, background:C.gold+"22", color:C.gold, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editName}
                      maxLength={40}
                      onClick={(e) => e.stopPropagation()}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") submitRename(); if (e.key === "Escape") { setEditingId(null); setEditName(""); } }}
                      onBlur={submitRename}
                      style={{ width:"100%", background:C.bg, border:"1.5px solid "+C.accent+"66", borderRadius:8, padding:"5px 8px", fontSize:13, fontWeight:700, color:C.text, outline:"none", fontFamily:"inherit" }}
                    />
                  ) : (
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{list.name}</div>
                      <div style={{ fontSize:10, color:C.textLt }}>· {tickers.length} activos</div>
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(list.id); setEditName(list.name); }}
                      title="Renombrar"
                      style={{ background:"transparent", border:"none", padding:5, color:C.textMd, cursor:"pointer" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    </button>
                    {lists.length > 1 && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ok = await confirm({
                            title: "Borrar la lista?",
                            body: `Se va a eliminar "${list.name}" y los ${(list.tickers || []).length} activos que tenga. No se borra nada de tu portafolio, solo la lista.`,
                            confirmLabel: "Borrar lista",
                            cancelLabel: "Cancelar",
                            danger: true,
                          });
                          if (ok) onRemove && onRemove(list.id);
                        }}
                        title="Borrar lista"
                        style={{ background:"transparent", border:"none", padding:5, color:C.red, cursor:"pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                      </button>
                    )}
                    <div style={{ color: C.textMd, padding: 2, marginLeft: 2, transform: isCollapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                  </>
                )}
              </div>

              {/* Tickers — hidden when the list is collapsed. */}
              {!isCollapsed && (tickers.length === 0 ? (
                <div style={{ padding:"14px 16px 12px", textAlign:"center", fontSize:10.5, color:C.textLt, lineHeight:1.5 }}>
                  Lista vacía. <button onClick={() => onOpenAssetPicker && onOpenAssetPicker(list.id)} style={{ background:"transparent", border:"none", color:C.accent, fontWeight:700, cursor:"pointer", fontFamily:"inherit", padding:0, textDecoration:"underline" }}>Agregar un activo</button>
                </div>
              ) : tickers.map((tick, i) => {
                const a = ASSETS.find(x => x.ticker === tick);
                if (!a) return null;
                return (
                  <div key={tick} onClick={() => onSelectAsset && onSelectAsset(a)} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", borderBottom: i < tickers.length - 1 ? "1px solid "+C.border+"44" : "none", cursor:"pointer" }}>
                    <AssetLogo asset={a} size={30} C={C}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                        <div style={{ fontWeight:700, fontSize:13, color:C.text }}>{a.ticker}</div>
                        <div style={{ fontSize:8, fontWeight:700, color:C.textLt, background:C.creamDk, borderRadius:3, padding:"1px 4px" }}>{a.cat}</div>
                      </div>
                      <div style={{ fontSize:10, color:C.textLt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</div>
                    </div>
                    <Spark up={a.up} color={a.up ? C.green : C.red} w={36} h={18}/>
                    <div style={{ textAlign:"right", minWidth:62 }}>
                      <div style={{ fontSize:12, fontWeight:700, fontFamily:"monospace", color:C.text }}>{showUSD ? "u$s" + (a.price / 1247.5).toFixed(2) : "$" + fN(a.price)}</div>
                      <div style={{ fontSize:10, fontWeight:700, color: a.up ? C.green : C.red }}>{a.up ? "+" : "-"}{Math.abs(a.change).toFixed(2)}%</div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); onRemoveTicker && onRemoveTicker(list.id, tick); }}
                      title={`Quitar ${tick} de ${list.name}`}
                      style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.textMd }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                );
              }))}
              {/* Add-asset footer — renders whether the list is empty or
                  not (empty-state already has its own "agregar" link, but
                  this one is always visible at the bottom so power users
                  can keep adding without scrolling up). */}
              {!isCollapsed && tickers.length > 0 && (
                <button
                  onClick={() => onOpenAssetPicker && onOpenAssetPicker(list.id)}
                  style={{ width:"100%", background:"transparent", border:"none", borderTop:"1px dashed "+C.border+"66", padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"center", gap:6, color:C.accent, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Agregar activo
                </button>
              )}
            </div>
          );
        })}
      </div>
      <ConfirmHost/>
    </div>
  );
}

// ============================================================
// PAGE: MERCADO (with logos)
// ============================================================
function PageMercado({ onSelectAsset, C, showUSD, lang }) {
  const t = useT(lang);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Todos");
  const cats = ["Todos","Acciones","CEDEAR","ETF","Commodity","Crypto","Bonos"];
  // Unified list: ASSETS + BONOS mapped to look like assets
  const bondAssets = BONOS.map(b => ({
    ticker:    b.ticker,
    name:      b.name,
    cat:       "Bonos",
    // USD-denominated bonds quote paridad in USD → convert to ARS at MEP.
    // ARS-denominated bonds (CER, LEDES) quote paridad already in pesos
    // and should not be re-multiplied. Previously both branches applied
    // the same multiplication, double-inflating ARS bond prices.
    price:     b.currency === "USD" ? Math.round(b.price * 1247.5) : Math.round(b.price),
    change:    0,
    chg1m:     0,
    chgYTD:    0,
    vol:       "N/A",
    mktCap:    "N/A",
    hi52:      b.price * 1.15,
    lo52:      b.price * 0.85,
    pe:        null,
    up:        true,
    yf:        b.ticker,
    desc:      b.desc,
    isBond:    true,
    bondRef:   b,
  }));
  const unified = [...ASSETS, ...bondAssets];
  const filtered = unified.filter(a =>
    (a.ticker.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase())) &&
    (filter === "Todos" || a.cat === filter)
  ).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return (
    <div style={{ padding:"14px 14px 0" }}>
      <div style={{ position:"relative", marginBottom:10 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("search")}
          style={{ background:C.card, border:"1.5px solid "+C.border, borderRadius:12, padding:"10px 12px 10px 34px", fontSize:14, fontFamily:"inherit", color:C.text, outline:"none", width:"100%", boxSizing:"border-box" }}/>
        {search && <button onClick={() => setSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"transparent", border:"none", fontSize:16, color:C.textLt, cursor:"pointer" }}>x</button>}
      </div>
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:8, marginBottom:6 }}>
        {cats.map(c => <button key={c} onClick={() => setFilter(c)} style={{ background: c === filter ? C.accent : C.card, color: c === filter ? "#fff" : C.textMd, border:"1.5px solid "+(c===filter?C.accent:C.border), borderRadius:20, padding:"5px 13px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}>{c}</button>)}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:6, paddingBottom:16 }}>
        {filtered.map(a => (
          <button key={a.ticker} onClick={() => onSelectAsset(a)} style={{ background:C.card, borderRadius:13, border:"1px solid "+C.border, padding:"11px 13px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", width:"100%", textAlign:"left", fontFamily:"inherit" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <AssetLogo asset={a} size={36} C={C}/>
              <div><div style={{ fontWeight:700, fontSize:13, color:C.text }}>{a.ticker}</div><div style={{ fontSize:10, color:C.textLt }}>{a.name}</div></div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Spark up={a.up} color={a.up ? C.green : C.red} w={40} h={20}/>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:700, fontSize:12, fontFamily:"monospace", color:C.text }}>{a.isBond && a.bondRef.currency === "USD" ? "u$s" + a.bondRef.price : fmtPrice(a.price, showUSD)}</div>
                {a.isBond
                  ? <div style={{ color:C.green, fontSize:11, fontWeight:700 }}>{a.bondRef.ytm ? "TIR " + a.bondRef.ytm + "%" : "CER"}</div>
                  : <div style={{ color: a.up ? C.green : C.red, fontSize:11, fontWeight:700 }}>{a.up ? "+" : "-"}{Math.abs(a.change).toFixed(2)}%</div>
                }
              </div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ textAlign:"center", padding:"36px 0", color:C.textLt }}>{t("market_no_results")}</div>}
      </div>
    </div>
  );
}

// ============================================================
// PAGE: NOTICIAS
// ============================================================
// Optional news proxy — read from localStorage at runtime. If the user has
// not configured one, we skip the fetch entirely and stay on seeded data
// instead of hammering a hardcoded localhost URL that won't exist in a
// deployed single-file bundle.
function loadNewsEndpoint() {
  try {
    return (typeof localStorage !== "undefined" && localStorage.getItem("samas_news_endpoint")) || "";
  } catch { return ""; }
}

// PageNoticias — live news from the fetch-news Edge Function.
// Default view: mixed feed for tickers the user holds + their watchlists.
// Search bar: type a ticker → fetch only that ticker.
// Falls back to a friendly empty state if the user has no tickers and
// hasn't searched anything.
function PageNoticias({ holdings, watchlists, onSelectAsset, C, lang }) {
  const t = useT(lang);
  // Build the union of "tickers I care about" — holdings first (with a
  // visual flag) plus everything in any watchlist. Used both for the
  // default mixed feed and for the "is this article relevant to me?"
  // styling later.
  const portTickers = (holdings || []).map((h) => h.ticker);
  const watchTickers = (watchlists || []).flatMap((w) => w.tickers || []);
  const myTickers = Array.from(new Set([...portTickers, ...watchTickers]));

  const [search, setSearch]   = useState("");      // raw input
  const [activeTicker, setAT] = useState(null);    // committed search value (null = mixed feed)
  const [articles, setArt]    = useState(null);    // null=loading, []=none, [...]=data
  const [err, setErr]         = useState(null);
  const [refreshKey, setRefreshKey] = useState(0); // bumped to trigger refetch
  const [openArticle, setOpenArticle] = useState(null);

  // Debounce the search → activeTicker transition. 350ms is short enough
  // that hitting Enter feels instant but long enough to skip mid-typing
  // network calls.
  useEffect(() => {
    const trimmed = (search || "").trim().toUpperCase();
    if (trimmed.length === 0) { setAT(null); return; }
    const id = setTimeout(() => setAT(trimmed), 350);
    return () => clearTimeout(id);
  }, [search]);

  // Fetch effect — runs on activeTicker change OR on refreshKey bump.
  useEffect(() => {
    let alive = true;
    setArt(null);
    setErr(null);
    const run = async () => {
      try {
        if (activeTicker) {
          const arr = await fetchNewsForTicker(activeTicker, lang);
          if (!alive) return;
          setArt(arr || []);
        } else if (myTickers.length > 0) {
          const arr = await fetchNewsForTickers(myTickers, lang);
          if (!alive) return;
          setArt(arr || []);
        } else {
          if (!alive) return;
          setArt([]);
        }
      } catch (e) {
        console.error("[news] page fetch failed:", e);
        if (alive) { setErr(e?.message || "error"); setArt([]); }
      }
    };
    run();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, refreshKey, lang]);

  const isInPortfolio = (ticker) => portTickers.includes(ticker);

  return (
    <div style={{ padding: "14px 14px 20px" }}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 2 }}>{t("news_title")}</div>
          <div style={{ fontSize: 10, color: C.textLt }}>
            {activeTicker
              ? <>Buscando: <strong style={{ color: C.text, fontFamily: "monospace" }}>{activeTicker}</strong></>
              : myTickers.length > 0
                ? `Mezclando ${myTickers.length} ${myTickers.length === 1 ? "ticker" : "tickers"} de tu cartera y watchlist`
                : "Buscá por ticker para ver noticias"}
          </div>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          title="Actualizar"
          style={{ background: C.creamDk, border: "1px solid " + C.border, borderRadius: 8, padding: "5px 10px", fontSize: 11, cursor: "pointer", color: C.textMd, fontFamily: "inherit" }}
        >
          ↻
        </button>
      </div>

      {/* Search bar — input + clear chip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: C.card, border: "1.5px solid " + (activeTicker ? C.accent + "66" : C.border),
        borderRadius: 12, padding: "9px 12px", marginBottom: 12,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMd} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value.replace(/[^a-zA-Z0-9.\-]/g, "").toUpperCase().slice(0, 15))}
          placeholder="Buscar noticias por ticker (GGAL, AAPL, BTC...)"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: C.text, fontFamily: "inherit", fontSize: 13, fontWeight: 600,
            letterSpacing: 0.5,
          }}
        />
        {search && (
          <button
            onClick={() => { setSearch(""); }}
            style={{ background: "transparent", border: "none", color: C.textMd, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 13 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Quick-pick chips of your tickers — one tap to filter without
          typing. Hidden when you're already filtering or when you have
          no tickers. */}
      {!activeTicker && myTickers.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
          {myTickers.slice(0, 12).map((tk) => (
            <button
              key={tk}
              onClick={() => setSearch(tk)}
              style={{
                background: isInPortfolio(tk) ? C.gold + "22" : C.card,
                color: isInPortfolio(tk) ? C.gold : C.textMd,
                border: "1.5px solid " + (isInPortfolio(tk) ? C.gold + "55" : C.border),
                borderRadius: 20, padding: "4px 11px",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
                fontFamily: "monospace", letterSpacing: 0.5,
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {tk}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton — show 3 placeholder cards while we wait */}
      {articles === null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, height: 120, opacity: 0.5 }}/>
          ))}
        </div>
      )}

      {/* Empty / error states */}
      {articles && articles.length === 0 && !activeTicker && myTickers.length === 0 && (
        <div style={{ textAlign: "center", padding: "30px 16px", background: C.card, border: "1px dashed " + C.border, borderRadius: 14, color: C.textMd, fontSize: 12, lineHeight: 1.6 }}>
          No tenés tickers en tu cartera ni en tus watchlists. Buscá un ticker arriba o agregá algo a una watchlist para ver noticias acá.
        </div>
      )}
      {articles && articles.length === 0 && (activeTicker || myTickers.length > 0) && !err && (
        <div style={{ textAlign: "center", padding: "30px 16px", background: C.card, border: "1px dashed " + C.border, borderRadius: 14, color: C.textMd, fontSize: 12, lineHeight: 1.6 }}>
          {activeTicker
            ? <>No encontramos noticias recientes para <strong style={{ color: C.text, fontFamily: "monospace" }}>{activeTicker}</strong>. Probá otro ticker o volvé en un rato.</>
            : <>Sin noticias frescas para tus tickers ahora. Probá actualizar en un rato.</>}
        </div>
      )}
      {articles && articles.length === 0 && err && (
        <div style={{ textAlign: "center", padding: "20px 16px", background: C.red + "11", border: "1px solid " + C.red + "44", borderRadius: 12, color: C.red, fontSize: 12 }}>
          No pudimos cargar noticias. Probá actualizar.
        </div>
      )}

      {/* Article list */}
      {articles && articles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {articles.slice(0, 40).map((a) => (
            <NewsCard
              key={a.url}
              article={a}
              C={C}
              lang={lang}
              showTicker={!activeTicker}
              onTickerClick={(tk) => setSearch(tk)}
              onOpen={setOpenArticle}
            />
          ))}
        </div>
      )}
      <ArticleModal article={openArticle} C={C} lang={lang} onClose={() => setOpenArticle(null)}/>
    </div>
  );
}

// ============================================================
// PAGE: TRENDING
// ============================================================
function PageTrending({ onSelectAsset, C, lang }) {
  const t = useT(lang);
  const sorted = [...ASSETS].sort((a, b) => b.change - a.change);
  const top3 = sorted.slice(0, 3), bot3 = sorted.slice(-3).reverse();
  const Row = ({ asset, rank, up }) => (
    <button onClick={() => onSelectAsset(asset)} style={{ background:C.card, borderRadius:14, border:"1px solid "+(up?C.green+"33":C.red+"33"), padding:"12px 14px", display:"flex", alignItems:"center", gap:12, cursor:"pointer", width:"100%", textAlign:"left", fontFamily:"inherit", marginBottom:8 }}>
      <div style={{ width:28, height:28, borderRadius:8, background:up?C.green+"22":C.red+"22", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><span style={{ fontFamily:"monospace", fontWeight:800, fontSize:13, color:up?C.green:C.red }}>{rank+1}</span></div>
      <AssetLogo asset={asset} size={34} C={C}/>
      <div style={{ flex:1, minWidth:0 }}><div style={{ fontWeight:700, fontSize:13, color:C.text }}>{asset.ticker}</div><div style={{ fontSize:10, color:C.textLt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{asset.name}</div></div>
      <div style={{ textAlign:"right", flexShrink:0 }}><div style={{ fontWeight:700, fontSize:13, fontFamily:"monospace", color:C.text }}>${fN(asset.price)}</div><div style={{ fontWeight:800, fontSize:14, color:up?C.green:C.red }}>{up?"+":"-"}{Math.abs(asset.change).toFixed(2)}%</div></div>
    </button>
  );
  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:20 }}><div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:3 }}>{t("trend_title")}</div><div style={{ fontSize:12, color:C.textMd }}>{t("trend_sub")}</div></div>
      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}><div style={{ width:28, height:28, borderRadius:8, background:C.green+"22", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div><div><div style={{ fontWeight:700, fontSize:13, color:C.green }}>{t("trend_gainers")}</div><div style={{ fontSize:10, color:C.textLt }}>Top 3 por ganancia</div></div></div>
        {top3.map((a, i) => <Row key={a.ticker} asset={a} rank={i} up={true}/>)}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}><div style={{ flex:1, height:1, background:C.border }}/><div style={{ fontSize:10, fontWeight:700, color:C.textLt, letterSpacing:1 }}>HOY</div><div style={{ flex:1, height:1, background:C.border }}/></div>
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}><div style={{ width:28, height:28, borderRadius:8, background:C.red+"22", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg></div><div><div style={{ fontWeight:700, fontSize:13, color:C.red }}>{t("trend_losers")}</div><div style={{ fontSize:10, color:C.textLt }}>Top 3 por perdida</div></div></div>
        {bot3.map((a, i) => <Row key={a.ticker} asset={a} rank={i} up={false}/>)}
      </div>
    </div>
  );
}

// ============================================================
// PAGE: ORDENES
// ============================================================
function PageOrdenes({ orders, C, lang }) {
  const t = useT(lang);
  return (
    <div style={{ padding:"14px" }}>
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        {[["30d","+3.2%",C.green],["90d","+11.8%",C.green],["1 año","+41.7%",C.gold]].map(([l,v,col]) => (
          <div key={l} style={{ flex:1, background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:"9px 6px", textAlign:"center" }}><div style={{ fontSize:9, fontWeight:700, color:C.textLt, textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:17, fontWeight:800, color:col, marginTop:1 }}>{v}</div></div>
        ))}
      </div>
      <div style={{ fontWeight:700, fontSize:13, color:C.text, marginBottom:10 }}>{t("order_history")}</div>
      {orders.length === 0 && <div style={{ textAlign:"center", padding:"36px 0", color:C.textLt }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:"block", margin:"0 auto 8px" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>{t("no_orders")}</div>}
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {orders.map((o, i) => (
          <div key={i} style={{ background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:"11px 13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div><div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:2 }}><span style={{ fontWeight:800, fontSize:13, color:C.text }}>{o.ticker}</span><span style={{ color:o.side==="Compra"?C.green:C.red, fontSize:10, fontWeight:700, background:(o.side==="Compra"?C.green:C.red)+"22", padding:"1px 6px", borderRadius:5 }}>{o.side}</span></div><div style={{ fontSize:10, color:C.textLt }}>{o.qty} unid - ${fN(o.price)}</div></div>
            <div style={{ textAlign:"right" }}><div style={{ color:C.green, fontSize:11, fontWeight:700, display:"flex", alignItems:"center", gap:3 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 12 10 16 18 8"/></svg>{t("executed")}</div><div style={{ fontSize:10, color:C.textLt, fontFamily:"monospace" }}>${fN(o.qty*o.price)}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TAB ICONS
// ============================================================
function TabIcon({ id, active, C, bigger }) {
  const col = active ? C.accent : C.textLt;
  const sz = bigger ? 24 : 20;
  const s = { width:sz, height:sz, viewBox:"0 0 24 24", fill:"none", stroke:col, strokeWidth: active ? 2.2 : 1.8, strokeLinecap:"round", strokeLinejoin:"round" };
  if (id === "portfolio") return <svg {...s}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="9" y1="14" x2="15" y2="14"/></svg>;
  if (id === "mercado")    return <svg {...s}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
  if (id === "favoritos")  return <svg {...s} fill={active ? C.gold : "none"} stroke={active ? C.gold : C.textLt}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
  if (id === "noticias")   return <svg {...s}><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/></svg>;
  if (id === "trending")   return <svg {...s}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
  if (id === "ordenes")    return <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
  if (id === "productos")  return <svg {...s}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;
  if (id === "ideas")      return <svg {...s}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
  if (id === "bonos")      return <svg {...s}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>;
  if (id === "reportes")   return <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="12" y1="9" x2="8" y2="9"/></svg>;
  return null;
}

// ============================================================
// SAMAS LOGO
// ============================================================
function SamasMark({ size = 56, markColor = "#0D1117", dotColor = "#16C784" }) {
  const w = size;
  const h = size * 1.15;
  // Each half: short horizontal tail → 180° semicircle → shorter horizontal return.
  // Upper cap pair both extend right; lower pair both extend left → diagonal S flow.
  return (
    <svg width={w} height={h} viewBox="0 0 100 115" fill="none" aria-label="SAMAS">
      {/* Upper reversed-C: top tail length 32, bottom tail length 21, semicircle r=16 on left */}
      <path
        d="M 67 17 L 35 17 A 16 16 0 0 0 35 49 L 56 49"
        stroke={markColor}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Lower regular-C: top tail length 21, bottom tail length 32, semicircle r=16 on right */}
      <path
        d="M 44 65 L 65 65 A 16 16 0 0 1 65 97 L 33 97"
        stroke={markColor}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Green núcleo dot — slightly right of center, in the S waist */}
      <circle cx="52" cy="60" r="9" fill={dotColor} />
    </svg>
  );
}

function SAMASLogo({ textColor = "#FFFFFF" }) {
  // Inline wordmark. Mark flips to light when text is light (dark nav), else navy.
  const markColor = textColor === "#FFFFFF" || textColor === "#fff" ? "#FFFFFF" : "#0D1117";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:9 }}>
      <SamasMark size={24} markColor={markColor} dotColor="#16C784"/>
      <span style={{ fontFamily:"Sora,sans-serif", fontSize:16, fontWeight:600, color:textColor, letterSpacing:2 }}>SAMAS</span>
    </div>
  );
}

function SAMASLogoLarge() {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
      <SamasMark size={84} markColor="#FFFFFF" dotColor="#16C784"/>
      <div style={{ color:"#FFFFFF", fontSize:30, fontWeight:500, fontFamily:"Sora,sans-serif", letterSpacing:6 }}>SAMAS</div>
      <div style={{ color:"#16C784", fontSize:13, fontWeight:400, fontFamily:"Sora,sans-serif", letterSpacing:1, marginTop:-6 }}>Tu centro financiero</div>
    </div>
  );
}

// ============================================================
// LOGIN SCREEN
// ============================================================
// ============================================================
// ONBOARDING TUTORIAL
// ============================================================
function OnboardingTutorial({ onClose, onComplete, setTab, setShowUSD, setShowProfile, currentTab, C, uiMode }) {
  const [step, setStep] = useState(0);
  useEscapeKey(onClose);
  const isPro = uiMode !== "principiante";

  // In beginner mode we keep the tour short and don't fight with
  // pixel-perfect highlight boxes — the layout shifts depending on
  // whether the hero card is taller (showed plan, fresh account, etc.)
  // and chasing those coordinates per render is fragile. Each step is
  // a centered tooltip with a clear description; the user advances
  // with Continuar. Fewer steps, less misalignment, same coverage.
  const beginnerSteps = [
    {
      title: "Bienvenido a SAMAS",
      body: "Te hago un recorrido rapido. Menos de un minuto y empezas a operar.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Tu cartera",
      body: "En la pantalla principal vas a ver cuanta plata tenes invertida, cuanto ganaste hoy, y cuanto te queda disponible para nuevas operaciones.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Depositar y retirar",
      body: "Con los botones verde y gris en la cartera podes acreditar plata o retirarla. Tambien podes programar un aporte mensual automatico.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Armar un plan con IA",
      body: "Tocando 'Armar mi plan con IA' la app te ayuda a definir un objetivo (cuanto queres tener y para cuando) y te sugiere como invertir.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Mercado",
      body: "Buscas un activo (acciones, bonos, etc.) y compras o vendes desde su pagina. Podes filtrar por categoria.",
      target: null,
      tabTo: "mercado",
      accent: "#16C784",
    },
    {
      title: "Watchlist",
      body: "Guarda los activos que queres seguir sin comprarlos todavia. Te muestran precio en vivo.",
      target: null,
      tabTo: "favoritos",
      accent: "#16C784",
    },
    {
      title: "Ajustes",
      body: "Tocando el boton de tus iniciales arriba a la derecha entras a tu perfil. Ahi cambias de modo simple a pro, idioma, o cerras sesion.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Listo",
      body: "Ya podes empezar a usar SAMAS. Si queres repasar el tutorial, entra a tu perfil y toca 'Ver tutorial'.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
  ];

  // Full pro tutorial — steps reference elements (ticker, FX strip) that
  // only exist in profesional mode.
  const proSteps = [
    // All steps use the SAMAS brand green (#16C784) as the accent so the
    // tutorial stays on-palette against the dark modal surface.
    {
      title: "Bienvenido a SAMAS",
      body: "Vamos a hacer un recorrido rapido para que conozcas tu nueva app de inversiones. Dura menos de un minuto.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "El ticker en vivo",
      body: "Aca ves los precios mas importantes del mercado moviendose en tiempo real: ETFs, commodities y crypto.",
      target: { top:66, left:0, width:357, height:28 },
      tipSide: "below",
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Dolar MEP, CCL y Oficial",
      body: "Las tres cotizaciones del dolar que importan para invertir en Argentina, actualizadas siempre.",
      target: { top:94, left:0, width:357, height:40 },
      tipSide: "below",
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Toggle ARS / USD",
      body: "Toca este switch para ver todos los precios en dolares MEP. Todo se convierte automaticamente.",
      // CurrencyToggle sits at right of the mobile header; measured from
      // the 357-wide inner phone frame: right padding 20, MG button 28,
      // gap 6 → toggle right edge at x=303, width ~78 → left=225.
      target: { top:34, left:222, width:80, height:26, radius:20 },
      tipSide: "below",
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Tu Portafolio",
      body: "Aca ves todos tus activos, tu rendimiento y tu distribucion. Toca cualquier posicion para comprar o vender mas.",
      target: { top:148, left:10, width:337, height:200 },
      tipSide: "below",
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Navegacion principal",
      body: "Los 5 menus de la app: Portafolio, Mercado, Noticias, Inversiones y Ordenes. Toca cualquiera para navegar.",
      target: { top:664, left:0, width:357, height:78 },
      tipSide: "above",
      tabTo: "portfolio",
      accent: "#16C784",
    },
    {
      title: "Mercado",
      body: "Aca encontras todas las acciones, CEDEARs, ETFs, bonos, commodities y crypto. Busca o filtra por categoria.",
      target: null,
      tabTo: "mercado",
      accent: "#16C784",
    },
    {
      title: "Noticias filtradas",
      body: "Las noticias mas relevantes para los activos que tenes. Las de tu portafolio aparecen destacadas en verde.",
      target: null,
      tabTo: "noticias",
      accent: "#16C784",
    },
    {
      title: "Inversiones",
      body: "Ideas de carteras, obligaciones negociables, fondos comunes y bonos soberanos. Todo en un solo lugar.",
      target: null,
      tabTo: "ideas",
      accent: "#16C784",
    },
    {
      title: "Listo!",
      body: "Ya podes empezar a operar. Si queres volver a ver este tutorial, entra a tu perfil y toca 'Ver tutorial'.",
      target: null,
      tabTo: "portfolio",
      accent: "#16C784",
    },
  ];

  // Pick the right tutorial flavor based on the active UI mode.
  const steps = isPro ? proSteps : beginnerSteps;

  // When step changes, navigate to the corresponding tab automatically.
  // Guard against out-of-bounds step indexes — e.g. if a future edit makes
  // the wizard advance past the last entry, the previous direct index
  // access would crash here instead of failing gracefully.
  useEffect(() => {
    const current = steps[step];
    if (current && current.tabTo && setTab) setTab(current.tabTo);
  }, [step]);

  const s = steps[step] || steps[steps.length - 1];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;

  // Calculate tooltip position based on target
  const target = s.target;
  const phoneW = 357, phoneH = 742;

  // Tooltip card positioning: if target exists, place above or below; otherwise center
  let tooltipStyle = { position:"absolute", left:"50%", transform:"translateX(-50%)", top:"40%" };
  if (target) {
    if (s.tipSide === "below") {
      tooltipStyle = { position:"absolute", left:12, right:12, top: target.top + target.height + 16 };
    } else if (s.tipSide === "above") {
      tooltipStyle = { position:"absolute", left:12, right:12, bottom: phoneH - target.top + 16 };
    }
  }

  return (
    // pointerEvents:"auto" on the outer overlay blocks interaction
    // with (and scrolling of) the page behind the tutorial. The user
    // can only progress via the Next / Previous / Skip buttons in the
    // tooltip card below.
    <div
      style={{ position:"absolute", inset:0, zIndex:150, pointerEvents:"auto" }}
      onWheel={(e) => e.preventDefault()}
      onTouchMove={(e) => e.preventDefault()}
    >
      <style>{"@keyframes tutPulse{0%,100%{box-shadow:0 0 0 0 " + s.accent + "66,0 0 0 9999px rgba(0,0,0,0.72)}50%{box-shadow:0 0 0 8px " + s.accent + "33,0 0 0 9999px rgba(0,0,0,0.72)}} @keyframes tutSlide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}"}</style>

      {/* Dim overlay with cutout around target. Border-radius uses the target's
          own radius hint so the spotlight matches pill/rect targets. */}
      {target ? (
        <div style={{ position:"absolute", top:target.top, left:target.left, width:target.width, height:target.height, borderRadius: target.radius != null ? target.radius : 12, animation:"tutPulse 2s ease-in-out infinite", pointerEvents:"none", zIndex:1 }}/>
      ) : (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.72)", pointerEvents:"auto" }}/>
      )}

      {/* Tooltip card - outer div does positioning, inner handles animation (so translateX(-50%) isn't clobbered) */}
      <div style={{ ...tooltipStyle, zIndex:5, pointerEvents:"auto" }}>
        <div key={step} style={{ background:C.bg, borderRadius:18, padding:"18px 16px 16px", border:"2px solid "+s.accent+"55", boxShadow:"0 16px 48px rgba(0,0,0,0.5)", animation:"tutSlide 0.3s ease-out" }}>
          {/* Progress dots */}
          <div style={{ display:"flex", justifyContent:"center", gap:4, marginBottom:12 }}>
            {steps.map((_, i) => (
              <div key={i} style={{ width: i===step ? 16 : 5, height:5, borderRadius:3, background: i===step ? s.accent : i < step ? s.accent+"66" : C.border, transition:"all 0.25s" }}/>
            ))}
          </div>

          <div style={{ fontSize:9, fontWeight:700, color:s.accent, letterSpacing:2, marginBottom:6, textAlign:"center" }}>PASO {step+1} DE {steps.length}</div>
          <div style={{ fontSize:17, fontWeight:600, color:C.text, fontFamily:"Sora,sans-serif", marginBottom:6, textAlign:"center", lineHeight:1.25 }}>{s.title}</div>
          <div style={{ fontSize:12, color:C.textMd, lineHeight:1.55, textAlign:"center", marginBottom:14 }}>{s.body}</div>

          <div style={{ display:"flex", gap:8 }}>
            {!isFirst && (
              <button onClick={() => setStep(step-1)} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"none", borderRadius:10, padding:"10px", fontWeight:500, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                Atras
              </button>
            )}
            <button onClick={onClose} style={{ flex:1, background:"transparent", color:C.textLt, border:"1.5px solid "+C.border, borderRadius:10, padding:"10px", fontWeight:500, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
              Saltar
            </button>
            <button onClick={isLast ? onComplete : () => setStep(step+1)}
              style={{ flex:2, background:s.accent, color:"#fff", border:"none", borderRadius:10, padding:"10px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit", boxShadow:"0 3px 10px "+s.accent+"55" }}>
              {isLast ? "Terminar" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Generate a 6-digit numeric code with leading-zero safe padding
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ============================================================
// DEPOSIT MODAL (info-only — user transfers from their bank)
// ============================================================
// SAMAS doesn't set the deposit amount. The user chooses it in their own
// bank / MP / wallet. This modal only shows destination details (CBU,
// alias, address) and a unique reference code so an eventual backend can
// match incoming transfers to this account.
function DepositModal({ user, onClose, onSimulate, C }) {
  useEscapeKey(onClose);
  const [method, setMethod] = useState("transfer");
  const [copied, setCopied] = useState(null);
  const [showSim, setShowSim] = useState(false);
  const [simAmount, setSimAmount] = useState("");

  // Reference code tied to the user — persists per-account, stable across
  // sessions so the bank reference stays the same on repeat deposits.
  const ref = "SAMAS-" + (user?.email || "demo").split("@")[0].toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, "X");

  const methods = [
    { id: "transfer", label: "Transferencia bancaria", desc: "Acreditacion ~minutos · Sin comision",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18"/><path d="M12 2l3 6H9l3-6z"/></svg> },
    { id: "mp",       label: "MercadoPago",            desc: "Instantaneo · 1.5% + IVA",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg> },
    { id: "crypto",   label: "USDT (TRC-20)",          desc: "~10 min confirmacion · 0.5%",
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg> },
  ];

  const details = {
    transfer: [
      { label: "CBU",       value: "0000003100010012345678" },
      { label: "Alias",     value: "SAMAS.WALLET.DEMO" },
      { label: "Titular",   value: "SAMAS S.A." },
      { label: "CUIT",      value: "30-12345678-9" },
      { label: "Referencia", value: ref, note: "Incluí esta referencia en el concepto para que se asocie a tu cuenta" },
    ],
    mp: [
      { label: "Link",       value: "mercadopago.com.ar/samas/" + ref.toLowerCase() },
      { label: "Alias MP",   value: "samas.wallet" },
      { label: "Referencia", value: ref, note: "Se agrega automaticamente al link" },
    ],
    crypto: [
      { label: "Address",    value: "TR7NHqjeKQxGTCi8q8ZY4pL5SomeFakeAddress" },
      { label: "Red",        value: "TRC-20 (solo USDT)" },
      { label: "Memo / Tag", value: ref, note: "Obligatorio — sin este memo no podemos identificar tu deposito" },
    ],
  };

  const copy = async (value, label) => {
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  const simAmt = parseInt(simAmount.replace(/\D/g, ""), 10) || 0;
  const runSim = () => {
    if (simAmt <= 0) return;
    onSimulate(simAmt, method);
    onClose();
  };

  return (
    <div style={{ position:"absolute", inset:0, zIndex:60, display:"flex", flexDirection:"column", background:"rgba(0,0,0,0.55)" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"18px 18px 22px", maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:600, color:C.text, fontFamily:"Sora,sans-serif" }}>Depositar fondos</div>
            <div style={{ fontSize:11, color:C.textLt, marginTop:2, lineHeight:1.4 }}>Transferi desde tu banco el monto que quieras.<br/>Se acredita automaticamente al recibirlo.</div>
          </div>
          <button onClick={onClose} style={{ background:C.creamDk, border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textMd} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Method selector — pills */}
        <div style={{ display:"flex", gap:6, marginBottom:14, overflowX:"auto" }}>
          {methods.map(m => (
            <button key={m.id} onClick={() => setMethod(m.id)}
              style={{ background: m.id === method ? C.accent : C.creamDk, color: m.id === method ? "#fff" : C.textMd, border:"none", borderRadius:20, padding:"8px 14px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0, display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ color: m.id === method ? "#fff" : C.textMd, display:"flex", alignItems:"center" }}>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize:11, color:C.textLt, marginBottom:12 }}>{methods.find(m => m.id === method)?.desc}</div>

        {/* Destination details with per-row copy */}
        <div style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"6px 0", marginBottom:14 }}>
          {details[method].map((d, i) => (
            <div key={d.label} style={{ padding:"10px 14px", borderBottom: i < details[method].length - 1 ? "1px solid "+C.border : "none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:11, color:C.textMd, flexShrink:0 }}>{d.label}</span>
                <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                  <span style={{ fontSize:12, fontFamily:"monospace", fontWeight:600, color:C.text, textAlign:"right", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.value}</span>
                  <button onClick={() => copy(d.value, d.label)} title="Copiar" style={{ background:"transparent", border:"1px solid "+C.border, borderRadius:7, padding:"4px 6px", cursor:"pointer", display:"flex", alignItems:"center", flexShrink:0 }}>
                    {copied === d.label ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textMd} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    )}
                  </button>
                </div>
              </div>
              {d.note && <div style={{ fontSize:10, color:C.textLt, marginTop:4, lineHeight:1.5 }}>{d.note}</div>}
            </div>
          ))}
        </div>

        <div style={{ background:C.accent+"14", border:"1px solid "+C.accent+"33", borderRadius:12, padding:"10px 12px", marginBottom:14, display:"flex", gap:8, alignItems:"flex-start" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:2 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div style={{ fontSize:11, color:C.text, lineHeight:1.5 }}>
            El monto lo elegís vos al hacer la transferencia desde tu banco / app. Cuando detectemos el ingreso con la referencia <span style={{ fontFamily:"monospace", fontWeight:700 }}>{ref}</span>, los fondos se acreditan automáticamente.
          </div>
        </div>

        {/* Demo-only: simulate a received deposit so testers can exercise the
            balance update without a real backend. Remove once a gateway is
            wired in. */}
        <div style={{ borderTop:"1px dashed "+C.border, paddingTop:14 }}>
          <button onClick={() => setShowSim(v => !v)} style={{ background:"transparent", border:"none", color:C.textLt, fontSize:11, cursor:"pointer", fontFamily:"inherit", padding:0, display:"flex", alignItems:"center", gap:6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showSim ? "rotate(90deg)" : "rotate(0deg)", transition:"transform 0.2s" }}><polyline points="9 18 15 12 9 6"/></svg>
            <span style={{ textTransform:"uppercase", letterSpacing:1, fontWeight:600 }}>Modo demo — simular deposito</span>
          </button>
          {showSim && (
            <div style={{ marginTop:10, background:C.creamDk, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:C.textLt, marginBottom:6, lineHeight:1.5 }}>
                En produccion, el backend detecta la transferencia y acredita. Para testear localmente:
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <input value={simAmount ? fN(simAmt) : ""} onChange={e => setSimAmount(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="$ Monto recibido" inputMode="numeric"
                  style={{ flex:1, background:C.bg, border:"1.5px solid "+C.border, borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"monospace", color:C.text, outline:"none", boxSizing:"border-box" }}/>
                <button onClick={runSim} disabled={simAmt <= 0}
                  style={{ background: simAmt > 0 ? C.accent : C.creamDk, color: simAmt > 0 ? "#fff" : C.textLt, border:"none", borderRadius:8, padding:"8px 14px", fontSize:12, fontWeight:600, cursor: simAmt > 0 ? "pointer" : "not-allowed", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                  Simular
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SignupForm({ onBack, onComplete, emailjsCfg, C }) {
  // Stages: "form" → "confirm" → onComplete()
  const [stage, setStage]       = useState("form");
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin]           = useState("");
  const [err, setErr]           = useState(null);
  const [busy, setBusy]         = useState(false);

  // Email confirmation state
  const [emailCode, setEmailCode] = useState("");        // code user types in
  const [sentCode, setSentCode]   = useState(null);      // code "sent" to email
  const [sentVia, setSentVia]     = useState("demo");    // "emailjs" | "demo"
  const [resendCooldown, setResendCooldown] = useState(0);

  // Validation
  const emailOk      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const nameOk       = name.trim().split(/\s+/).length >= 2;
  const pwdLenOk     = password.length >= 6;
  const pwdHasNumSym = /[^a-zA-Z\s]/.test(password);   // digit or symbol
  const pwdOk        = pwdLenOk && pwdHasNumSym;
  const pinOk        = /^\d{4}$/.test(pin);
  const allOk        = nameOk && emailOk && pwdOk && pinOk;

  const fieldStyle = { background:"rgba(255,255,255,0.06)", border:"1.5px solid rgba(255,255,255,0.12)", borderRadius:12, padding:"12px 14px", fontSize:14, fontFamily:"Sora,sans-serif", color:"#fff", outline:"none", width:"100%", boxSizing:"border-box" };

  // Send a verification email. Uses EmailJS if configured (emailjs.com), else
  // falls back to the console.log stub and shows the code inline for the demo.
  const sendConfirmationEmail = async (addr, userName) => {
    const code = genCode();
    setSentCode(code);
    setResendCooldown(30);
    const body = `Tu codigo de confirmacion es: ${code}. Expira en 10 minutos. Si no creaste esta cuenta, ignora este email.`;
    sendEmailNotification({ to: addr, subject: "Confirma tu cuenta SAMAS", body });
    if (emailjsCfg) {
      try {
        await sendViaEmailjs(emailjsCfg, { to: addr, name: userName, code, message: body });
        setSentVia("emailjs");
        return { ok: true, code };
      } catch (e) {
        console.error("[SAMAS/EmailJS] send failed:", e);
        setSentVia("demo");
        return { ok: false, code, error: e?.message || "Error enviando email" };
      }
    }
    setSentVia("demo");
    return { ok: true, code };
  };

  // Cooldown tick
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const submitForm = async () => {
    if (!allOk) {
      setErr(
        !nameOk ? "Ingresa nombre y apellido" :
        !emailOk ? "Email invalido" :
        !pwdLenOk ? "Contrasena: minimo 6 caracteres" :
        !pwdHasNumSym ? "Contrasena: al menos un numero o simbolo" :
        "PIN: 4 digitos"
      );
      return;
    }
    setBusy(true);
    setErr(null);
    const result = await sendConfirmationEmail(email, name);
    setBusy(false);
    if (result.error) {
      setErr("No pudimos enviar el email (" + result.error + "). Usamos modo demo: codigo abajo.");
    }
    setStage("confirm");
    setEmailCode("");
  };

  const submitCode = () => {
    if (emailCode.length !== 6) {
      setErr("Ingresa los 6 digitos");
      return;
    }
    if (emailCode !== sentCode) {
      setErr("Codigo incorrecto");
      setEmailCode("");
      return;
    }
    setBusy(true);
    setErr(null);
    setTimeout(() => {
      registerUser({ name, email, pin });
      onComplete();
    }, 500);
  };

  const resend = async () => {
    if (resendCooldown > 0) return;
    setEmailCode("");
    setErr(null);
    const result = await sendConfirmationEmail(email, name);
    if (result.error) setErr("Reenvio fallo: " + result.error);
  };

  // ----- FORM STAGE -----
  if (stage === "form") return (
    <div style={{ position:"absolute", inset:0, zIndex:100, background:"linear-gradient(160deg,#0D1117 0%,#0D2B1C 55%,#000000 100%)", display:"flex", flexDirection:"column", padding:"32px 24px 24px", overflowY:"auto" }}>
      <style>{"@keyframes fadeInUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}"}</style>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <button onClick={onBack} aria-label="Volver" style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <SamasMark size={34} markColor="#FFFFFF" dotColor="#16C784"/>
        <div style={{ color:"#fff", fontSize:16, fontWeight:600, letterSpacing:3, fontFamily:"Sora,sans-serif" }}>SAMAS</div>
      </div>

      <div style={{ animation:"fadeInUp 0.4s ease-out", flex:1 }}>
        <div style={{ color:"#FFFFFF", fontSize:22, fontWeight:600, fontFamily:"Sora,sans-serif", marginBottom:6 }}>Crear cuenta</div>
        <div style={{ color:"#16C784", fontSize:12, marginBottom:22 }}>Tu centro financiero, en un minuto.</div>

        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.5)", letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>Nombre completo</div>
            <input value={name} onChange={e => { setName(e.target.value); setErr(null); }} placeholder="Nombre y apellido" autoComplete="name" style={fieldStyle}/>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.5)", letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>Email</div>
            <input value={email} onChange={e => { setEmail(e.target.value); setErr(null); }} placeholder="tu@email.com" type="email" autoComplete="email" style={fieldStyle}/>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.5)", letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>Contrasena</div>
            <input value={password} onChange={e => { setPassword(e.target.value); setErr(null); }} placeholder="Min 6 caracteres con numero o simbolo" type="password" autoComplete="new-password" style={fieldStyle}/>
            {password.length > 0 && (
              <div style={{ display:"flex", gap:10, marginTop:6, fontSize:10 }}>
                <span style={{ color: pwdLenOk ? "#16C784" : "rgba(255,255,255,0.4)" }}>{pwdLenOk ? "✓" : "○"} 6+ caracteres</span>
                <span style={{ color: pwdHasNumSym ? "#16C784" : "rgba(255,255,255,0.4)" }}>{pwdHasNumSym ? "✓" : "○"} numero o simbolo</span>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.5)", letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>PIN de 4 digitos</div>
            <input value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g,"").slice(0,4)); setErr(null); }} placeholder="● ● ● ●" inputMode="numeric" maxLength={4} style={{ ...fieldStyle, letterSpacing:8, textAlign:"center", fontFamily:"monospace" }}/>
          </div>
        </div>

        {err && (
          <div style={{ marginTop:14, background:"rgba(248,113,113,0.15)", border:"1px solid rgba(248,113,113,0.35)", borderRadius:10, padding:"10px 12px", color:"#FCA5A5", fontSize:12 }}>
            {err}
          </div>
        )}
      </div>

      <div style={{ marginTop:20 }}>
        <button onClick={submitForm} disabled={busy}
          style={{ width:"100%", background: allOk ? "#16C784" : "rgba(255,255,255,0.1)", color: allOk ? "#0D1117" : "rgba(255,255,255,0.4)", border:"none", borderRadius:14, padding:"14px", fontWeight:700, fontSize:14, cursor: allOk && !busy ? "pointer" : "not-allowed", fontFamily:"Sora,sans-serif", letterSpacing:1, transition:"background 0.2s" }}>
          {busy ? "Enviando codigo…" : "Continuar"}
        </button>
        <div style={{ marginTop:14, textAlign:"center" }}>
          <span style={{ color:"rgba(255,255,255,0.45)", fontSize:12 }}>Ya tenes cuenta? </span>
          <button onClick={onBack} style={{ background:"transparent", border:"none", color:"#16C784", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", padding:0 }}>Iniciar sesion</button>
        </div>
        <div style={{ marginTop:14, fontSize:10, color:"rgba(255,255,255,0.3)", textAlign:"center", lineHeight:1.5 }}>
          Al crear la cuenta aceptas los <span style={{ color:"rgba(255,255,255,0.5)", textDecoration:"underline" }}>Terminos</span> y la <span style={{ color:"rgba(255,255,255,0.5)", textDecoration:"underline" }}>Politica de privacidad</span>.
        </div>
      </div>
    </div>
  );

  // ----- CONFIRM STAGE -----
  return (
    <div style={{ position:"absolute", inset:0, zIndex:100, background:"linear-gradient(160deg,#0D1117 0%,#0D2B1C 55%,#000000 100%)", display:"flex", flexDirection:"column", padding:"32px 24px 24px" }}>
      <style>{"@keyframes fadeInUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}"}</style>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <button onClick={() => { setStage("form"); setErr(null); }} aria-label="Volver" style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <SamasMark size={34} markColor="#FFFFFF" dotColor="#16C784"/>
        <div style={{ color:"#fff", fontSize:16, fontWeight:600, letterSpacing:3, fontFamily:"Sora,sans-serif" }}>SAMAS</div>
      </div>

      <div style={{ animation:"fadeInUp 0.4s ease-out", flex:1, display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", paddingTop:20 }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"#16C78422", border:"2px solid #16C78466", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:18 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16C784" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </div>
        <div style={{ color:"#FFFFFF", fontSize:20, fontWeight:600, fontFamily:"Sora,sans-serif", marginBottom:8 }}>Revisa tu email</div>
        <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13, lineHeight:1.5, marginBottom:6, padding:"0 8px" }}>
          Te enviamos un codigo de 6 digitos a
        </div>
        <div style={{ color:"#16C784", fontSize:13, fontWeight:600, marginBottom:24, wordBreak:"break-all", padding:"0 8px" }}>{email}</div>

        <input
          value={emailCode}
          onChange={e => { setEmailCode(e.target.value.replace(/\D/g,"").slice(0,6)); setErr(null); }}
          placeholder="000000"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          style={{ ...fieldStyle, letterSpacing:10, textAlign:"center", fontSize:22, fontFamily:"monospace", fontWeight:600, width:220, padding:"14px 10px" }}
        />

        {err && (
          <div style={{ marginTop:14, background:"rgba(248,113,113,0.15)", border:"1px solid rgba(248,113,113,0.35)", borderRadius:10, padding:"10px 12px", color:"#FCA5A5", fontSize:12 }}>
            {err}
          </div>
        )}

        <div style={{ marginTop:20, fontSize:12, color:"rgba(255,255,255,0.5)" }}>
          No recibiste el email?{" "}
          <button onClick={resend} disabled={resendCooldown > 0}
            style={{ background:"transparent", border:"none", color: resendCooldown > 0 ? "rgba(255,255,255,0.3)" : "#16C784", fontSize:12, fontWeight:600, cursor: resendCooldown > 0 ? "default" : "pointer", fontFamily:"inherit", padding:0 }}>
            {resendCooldown > 0 ? `Reenviar (${resendCooldown}s)` : "Reenviar"}
          </button>
        </div>

        {/* Status / demo hint. If EmailJS succeeded, show a confirmation pill;
            otherwise fall back to the demo-code hint so the user can still
            complete signup without a real email backend. */}
        {sentVia === "emailjs" ? (
          <div style={{ marginTop:20, padding:"8px 12px", background:"rgba(22,199,132,0.12)", border:"1px solid rgba(22,199,132,0.35)", borderRadius:10, color:"#16C784", fontSize:11, display:"flex", alignItems:"center", gap:8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16C784" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Email enviado a tu casilla. Revisa spam si no llega.
          </div>
        ) : sentCode ? (
          <div style={{ marginTop:24, padding:"10px 14px", background:"rgba(201,168,76,0.15)", border:"1px dashed rgba(201,168,76,0.45)", borderRadius:10, color:"#E8C97A", fontSize:11 }}>
            <strong>Modo demo:</strong> el codigo es <span style={{ fontFamily:"monospace", fontSize:14, fontWeight:700, letterSpacing:2 }}>{sentCode}</span>
            <div style={{ fontSize:10, color:"rgba(232,201,122,0.7)", marginTop:4 }}>Configura EmailJS en el perfil para recibir emails reales.</div>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop:20 }}>
        <button onClick={submitCode} disabled={busy || emailCode.length !== 6}
          style={{ width:"100%", background: emailCode.length === 6 ? "#16C784" : "rgba(255,255,255,0.1)", color: emailCode.length === 6 ? "#0D1117" : "rgba(255,255,255,0.4)", border:"none", borderRadius:14, padding:"14px", fontWeight:700, fontSize:14, cursor: emailCode.length === 6 && !busy ? "pointer" : "not-allowed", fontFamily:"Sora,sans-serif", letterSpacing:1, transition:"background 0.2s" }}>
          {busy ? "Creando cuenta…" : "Confirmar y crear cuenta"}
        </button>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, onSignup, emailjsCfg, C, isWeb = false }) {
  const [view, setView]       = useState("login");  // "login" | "signup"
  const [phase, setPhase]     = useState("idle");
  const [pin, setPin]         = useState("");
  const [pinErr, setPinErr]   = useState(false);
  // On the Web build there's no reliable face recognition available — laptop
  // webcams don't expose any TrueDepth/Face-ID style auth — so we skip the
  // Face ID UX entirely and default straight to the PIN entry.
  const [showPin, setShowPin] = useState(isWeb);
  const doFaceID = () => { setPhase("scanning"); setTimeout(() => { setPhase("success"); setTimeout(onLogin, 800); }, 1800); };
  const doPin = () => { if (pin === DEMO_USER.pin) { setPhase("success"); setTimeout(onLogin, 600); } else { setPinErr(true); setPin(""); setTimeout(() => setPinErr(false), 1400); } };
  // Fresh signup → call onSignup (which resets state) rather than onLogin,
  // so the new account doesn't inherit the demo portfolio.
  if (view === "signup") return <SignupForm onBack={() => setView("login")} onComplete={() => { setPhase("success"); setTimeout(onSignup || onLogin, 400); }} emailjsCfg={emailjsCfg} C={C}/>;
  return (
    <div style={{ position:"absolute", inset:0, zIndex:100, background:"linear-gradient(160deg,#0D1117 0%,#0D2B1C 55%,#000000 100%)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"space-between", padding:"0 0 32px" }}>
      <style>{"@keyframes scanLine{0%{top:18%}100%{top:78%}} @keyframes glow{0%,100%{box-shadow:0 0 20px rgba(192,96,144,0.3)}50%{box-shadow:0 0 40px rgba(192,96,144,0.7)}} @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}"}</style>
      <div style={{ width:"100%", paddingTop:30, paddingLeft:20, paddingRight:20, paddingBottom:8, display:"flex", justifyContent:"space-between" }}>
        <span style={{ color:"rgba(255,255,255,0.5)", fontSize:12, fontWeight:600 }}>{new Date().toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" })}</span>
      </div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, animation:"fadeIn 0.6s ease-out" }}>
        <SAMASLogoLarge/>
        <div style={{ color:"rgba(255,255,255,0.3)", fontSize:11, letterSpacing:3, textTransform:"uppercase" }}>Inversiones</div>
      </div>
      {!showPin && !isWeb ? (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:20 }}>
          <div style={{ position:"relative", width:160, height:160 }}>
            <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:"2px solid "+(phase==="success"?"#4ADE80":phase==="scanning"?"#0D1117":"rgba(255,255,255,0.12)"), transition:"border-color 0.4s" }}/>
            <div style={{ position:"absolute", inset:10, borderRadius:"50%", background:"rgba(255,255,255,0.03)", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
              {phase === "scanning" && <div style={{ position:"absolute", left:0, right:0, height:2, background:"linear-gradient(90deg,transparent,#0D1117,transparent)", animation:"scanLine 0.9s ease-in-out infinite alternate", top:"50%" }}/>}
              {phase !== "success" ? (
                <svg width="70" height="70" viewBox="0 0 80 80" fill="none" style={{ opacity: phase==="scanning" ? 0.4 : 0.25 }}>
                  <ellipse cx="40" cy="36" rx="24" ry="28" stroke="rgba(255,255,255,0.6)" strokeWidth="2"/><ellipse cx="31" cy="30" rx="3.5" ry="4.5" stroke="rgba(255,255,255,0.6)" strokeWidth="2"/><ellipse cx="49" cy="30" rx="3.5" ry="4.5" stroke="rgba(255,255,255,0.6)" strokeWidth="2"/><path d="M40 35 L37 43 Q40 45 43 43 Z" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" fill="none"/><path d="M32 50 Q40 55 48 50" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" fill="none"/>
                  <path d="M8 20 L8 8 L20 8" stroke="#0D1117" strokeWidth="2" strokeLinecap="round"/><path d="M60 8 L72 8 L72 20" stroke="#0D1117" strokeWidth="2" strokeLinecap="round"/><path d="M8 55 L8 67 L20 67" stroke="#0D1117" strokeWidth="2" strokeLinecap="round"/><path d="M60 67 L72 67 L72 55" stroke="#0D1117" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="24" fill="rgba(74,222,128,0.15)" stroke="#4ADE80" strokeWidth="2"/><polyline points="17,28 24,36 39,20" stroke="#4ADE80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </div>
            {["tl","tr","bl","br"].map(p => <div key={p} style={{ position:"absolute", top:p.startsWith("t")?-2:"auto", bottom:p.startsWith("b")?-2:"auto", left:p.endsWith("l")?-2:"auto", right:p.endsWith("r")?-2:"auto", width:18, height:18, borderTop:p.startsWith("t")?"2px solid #0D1117":"none", borderBottom:p.startsWith("b")?"2px solid #0D1117":"none", borderLeft:p.endsWith("l")?"2px solid #0D1117":"none", borderRight:p.endsWith("r")?"2px solid #0D1117":"none" }}/>)}
          </div>
          <div style={{ color: phase==="success"?"#4ADE80":phase==="scanning"?"#0D1117":"rgba(255,255,255,0.45)", fontSize:14, fontWeight: phase!=="idle" ? 600 : 400, textAlign:"center" }}>
            {phase==="idle"?"Usar Face ID para ingresar":phase==="scanning"?"Escaneando rostro...":"Identidad verificada"}
          </div>
          {phase === "idle" && <button onClick={doFaceID} style={{ background:"linear-gradient(135deg,#0D1117,#E080B0)", border:"none", borderRadius:18, padding:"14px 40px", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", fontFamily:"inherit", animation:"glow 2s ease-in-out infinite" }}>Ingresar con Face ID</button>}
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:20, width:"100%", padding:"0 32px" }}>
          <div style={{ color:"rgba(255,255,255,0.5)", fontSize:13 }}>PIN de seguridad</div>
          <div style={{ display:"flex", gap:14 }}>
            {[0,1,2,3].map(i => <div key={i} style={{ width:13, height:13, borderRadius:"50%", background: i < pin.length ? (pinErr?"#F87171":"#0D1117") : "rgba(255,255,255,0.2)", border:"1.5px solid "+(i < pin.length ? (pinErr?"#F87171":"#0D1117") : "rgba(255,255,255,0.3)"), transition:"all 0.15s" }}/>)}
          </div>
          {pinErr && <div style={{ color:"#F87171", fontSize:12, fontWeight:600, marginTop:-10 }}>PIN incorrecto</div>}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, width:"100%" }}>
            {[1,2,3,4,5,6,7,8,9,"",0,"x"].map((k, i) => (
              <button key={i} onClick={() => { if (k==="x") { setPin(p => p.slice(0,-1)); return; } if (k==="") return; const next = pin + String(k); setPin(next); if (next.length === 4) setTimeout(doPin, 120); }}
                disabled={k===""}
                style={{ background:k===""?"transparent":"rgba(255,255,255,0.07)", border:k===""?"none":"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"16px 0", color:k==="x"?"rgba(255,255,255,0.4)":"#fff", fontSize:k==="x"?16:22, fontWeight:600, cursor:k===""?"default":"pointer", fontFamily:"inherit" }}>
                {k==="x"?"<-":k}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
        {!isWeb && !showPin && phase==="idle" && <button onClick={() => setShowPin(true)} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>Usar PIN</button>}
        {!isWeb && showPin && <button onClick={() => { setShowPin(false); setPin(""); }} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>Usar Face ID</button>}
        {phase==="idle" && (
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ color:"rgba(255,255,255,0.35)", fontSize:12 }}>Sos nuevo en SAMAS?</span>
            <button onClick={() => setView("signup")} style={{ background:"transparent", border:"none", color:"#16C784", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Crear cuenta</button>
          </div>
        )}
        <div style={{ color:"rgba(255,255,255,0.15)", fontSize:10, letterSpacing:1 }}>samas.com.ar v2.5.0</div>
      </div>
    </div>
  );
}

// ============================================================
// PROFILE SHEET
// ============================================================
function ProfileSheet({ displayUser, uiMode, onChangeUiMode, onResetAccount, onResetPin, onClose, onLogout, onToggleDark, isDark, lang, setLang, C }) {
  useEscapeKey(onClose);
  // U = the authenticated user (fallback to DEMO_USER shape if no real
  // one is passed; shouldn't happen once auth gates are wired).
  const U = displayUser || DEMO_USER;
  // In-app confirm for destructive actions like "reset demo data".
  const { confirm, ConfirmHost } = useConfirm(C);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  // Two-view panel: root (user card + dark mode + Settings row + logout)
  // vs. settings subpage (back arrow + all the expandable integrations).
  // Previously all 7 expandable items lived on the root, making the sheet
  // dense and burying the close affordance.
  const [showSettings, setShowSettings] = useState(false);
  const [show2FA, setShow2FA]       = useState(false);
  const [twoFAEnabled, set2FA]      = useState(false);
  const [totpCode, setTotpCode]     = useState("");
  const [totpVerified, setTotpVerified] = useState(false);
  const [showLang, setShowLang]     = useState(false);
  const t = useT(lang);
  // Note: finnhub / emailjs / anthropic BYOK panels + devices sub-page
  // were removed — those integrations now live on the backend. The state
  // variables and the DevicesPage sub-render block that previously sat
  // here are gone to keep ProfileSheet lean.

  return (
    <div style={{ position:"absolute", inset:0, zIndex:40, display:"flex", flexDirection:"column", background:"rgba(0,0,0,0.55)" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"14px 18px 28px", maxHeight:"90vh", overflowY:"auto" }}>
        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>
        {/* Header row: back arrow (in Settings view) / title / close X.
            The X button is always visible so the user never gets trapped. */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, minHeight:32 }}>
          {showSettings ? (
            <button
              onClick={() => setShowSettings(false)}
              aria-label="Atras"
              style={{ background:C.creamDk, border:"1px solid "+C.border, borderRadius:10, padding:"6px 10px", display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontFamily:"inherit", color:C.text }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              <span style={{ fontSize:12, fontWeight:600 }}>{t("back")}</span>
            </button>
          ) : <div/>}
          <div style={{ fontSize:14, fontWeight:700, color:C.text }}>
            {showSettings ? t("settings") : t("profile")}
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            style={{
              background: C.red + "18",
              border: "1.5px solid " + C.red + "55",
              borderRadius: 10,
              width: 40,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: C.red,
              padding: 0,
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20, padding:"14px 16px", background:C.card, borderRadius:16, border:"1px solid "+C.border }}>
          <div style={{ width:50, height:50, borderRadius:14, background:C.isDark?"#1F1F1F":"linear-gradient(135deg,#0D1117,#1F1F1F)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:800, color:C.goldLt, flexShrink:0 }}>{U.initials}</div>
          <div><div style={{ fontWeight:800, fontSize:16, color:C.text }}>{U.name}</div><div style={{ fontSize:12, color:C.textMd, marginTop:1 }}>{U.email}</div><div style={{ display:"flex", alignItems:"center", gap:4, marginTop:4 }}><div style={{ width:6, height:6, borderRadius:3, background:C.green }}/><span style={{ fontSize:10, color:C.green, fontWeight:600 }}>{t("active_session")}</span></div></div>
        </div>

        {/* ---- ROOT VIEW: Dark mode toggle + Settings row ---- */}
        {!showSettings && (
        <button onClick={onToggleDark} style={{ width:"100%", background:isDark?"#2A1A2A":"#F5E8F5", border:"1.5px solid #0D111744", borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"#0D111722", display:"flex", alignItems:"center", justifyContent:"center" }}>{isDark ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D1117" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D1117" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}</div>
            <div><div style={{ fontSize:13, fontWeight:600, color:C.text }}>{isDark ? t("light_mode") : t("dark_mode")}</div><div style={{ fontSize:11, color:C.textLt }}>{isDark ? t("light_mode_sub") : t("dark_mode_sub")}</div></div>
          </div>
          <div style={{ width:40, height:22, borderRadius:11, background:isDark?C.accent:C.creamDk, border:"1.5px solid "+C.border, position:"relative" }}><div style={{ position:"absolute", top:2, left:isDark?18:2, width:14, height:14, borderRadius:"50%", background:isDark?"#fff":C.textLt, transition:"left 0.2s" }}/></div>
        </button>
        )}

        {/* Settings entry row (root view only) */}
        {!showSettings && (
          <button onClick={() => setShowSettings(true)} style={{ width:"100%", background:C.creamDk, border:"1.5px solid "+C.border, borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:C.accent+"22", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{t("settings")}</div>
                <div style={{ fontSize:11, color:C.textLt }}>Idioma, dispositivos, integraciones, 2FA</div>
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        )}

        {/* ---- SETTINGS VIEW: all integrations ---- */}
        {showSettings && (<>
        {/* UI MODE: toggle between principiante / profesional. Saves to
            profiles.ui_mode and the rest of the app picks up the change
            on next render (sbProfile is refetched inside the handler). */}
        <div style={{ background:C.creamDk, border:"1.5px solid "+C.border, borderRadius:14, padding:"12px 14px", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:C.accent+"22", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.text }}>Modo de interfaz</div>
              <div style={{ fontSize:11, color:C.textLt }}>Principiante: más guiada · Profesional: más datos</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {[
              { v: "principiante", label: "Principiante" },
              { v: "profesional",  label: "Profesional" },
            ].map(o => {
              const active = uiMode === o.v;
              return (
                <button
                  key={o.v}
                  onClick={() => {
                    if (!active && onChangeUiMode) onChangeUiMode(o.v);
                  }}
                  style={{
                    background: active ? C.accent : C.card,
                    color: active ? "#fff" : C.textMd,
                    border: "1.5px solid " + (active ? C.accent : C.border),
                    borderRadius: 10,
                    padding: "10px",
                    fontSize: 12, fontWeight: 700,
                    cursor: active ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Devices panel removed — it was a UI stub with mock data and
            no real functionality. Will come back when we wire up proper
            session management from Supabase (needs an Edge Function to
            call auth.admin via service_role). */}

        <button onClick={() => setShowLang(v => !v)} style={{ width:"100%", background:showLang?C.accent+"18":C.creamDk, border:"1.5px solid "+(showLang?C.accent+"44":C.border), borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"#2563EB22", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
            <div><div style={{ fontSize:13, fontWeight:600, color:C.text }}>{t("language")}</div><div style={{ fontSize:11, color:C.textLt }}>{LANGUAGES.find(l => l.code === lang)?.label || "Español"}</div></div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showLang ? "rotate(90deg)" : "rotate(0deg)", transition:"transform 0.2s" }}><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        {showLang && (
          <div style={{ background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:6, marginBottom:8 }}>
            {LANGUAGES.map(l => (
              <button key={l.code} onClick={() => { setLang(l.code); setShowLang(false); }}
                style={{ width:"100%", background: l.code === lang ? C.accent+"22" : "transparent", border:"none", borderRadius:9, padding:"11px 12px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontFamily:"inherit", textAlign:"left", marginBottom:2 }}>
                <div style={{ width:28, height:28, borderRadius:6, background:C.creamDk, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:C.textMd, letterSpacing:0.5 }}>{l.flag}</div>
                <span style={{ fontSize:13, fontWeight: l.code === lang ? 700 : 500, color: l.code === lang ? C.accent : C.text, flex:1 }}>{l.label}</span>
                {l.code === lang && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 12 10 16 18 8"/></svg>}
              </button>
            ))}
          </div>
        )}

        <button onClick={() => { onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('show-tutorial')), 100); }} style={{ width:"100%", background:C.creamDk, border:"1.5px solid "+C.border, borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:C.gold+"22", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
            <div><div style={{ fontSize:13, fontWeight:600, color:C.text }}>{t("tutorial")}</div><div style={{ fontSize:11, color:C.textLt }}>{t("tutorial_sub")}</div></div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        {/* BYOK API sections (Finnhub, Anthropic, EmailJS) removed —
            moving those integrations to the backend so users don't
            have to bring their own keys. Will come back as a read-
            only status row when the server wrapper is in place. */}


        {/* Export data — dump all localStorage-backed SAMAS keys as JSON */}
        <button
          onClick={() => {
            try {
              const snapshot = {
                exportedAt: new Date().toISOString(),
                version: 1,
                keys: {},
              };
              const KEYS = [
                "samas_holdings", "samas_orders", "samas_balance",
                "samas_watchlists", "samas_stop_losses", "samas_price_alerts",
                "samas_ui_dark", "samas_lang", "samas_show_usd",
                "samas_view_mode", "samas_seen_tutorial", "samas_plan",
              ];
              KEYS.forEach(k => {
                try {
                  const v = localStorage.getItem(k);
                  if (v !== null) snapshot.keys[k] = JSON.parse(v);
                } catch { /* skip bad keys */ }
              });
              const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `samas-export-${new Date().toISOString().slice(0,10)}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              console.error("[SAMAS] export failed:", e);
              alert("No se pudo exportar: " + (e?.message || "error desconocido"));
            }
          }}
          style={{ width:"100%", background:C.creamDk, border:"1.5px solid "+C.border, borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"#2563EB22", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:C.text }}>Exportar mis datos</div>
              <div style={{ fontSize:11, color:C.textLt }}>Descarga holdings, ordenes y plan como JSON</div>
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        {/* Old "Resetear datos del simulador" button removed — was clearing
            localStorage only, but data lives in Supabase now. Replaced by
            the "Reiniciar cuenta" button at the bottom of Settings which
            properly wipes the user's rows in the DB. */}

        {/* Real 2FA via Supabase Auth MFA. The component manages
            enroll → QR → verify code → enable, and unenroll. Once
            verified, login flow asks for a TOTP code on next session. */}
        <MfaEnrollSection C={C} />
        </>)}

        {/* Reset account — destructive dev/testing button. Wipes all
            portfolio data (holdings, orders, balance, watchlists, plans,
            stop losses, price alerts). Keeps auth + PIN + ui_mode intact.
            Guarded behind in-app confirm so no accidental nukes. */}
        {/* Reset PIN — useful when the user forgot their PIN or has a
            stale hash from a previous test session. Clears profiles.pin_hash
            and forces the PIN gate back so they create a new one. */}
        {onResetPin && (
          <button
            onClick={async () => {
              const ok = await confirm({
                title: "¿Reiniciar PIN?",
                body: "Vas a borrar tu PIN actual. La próxima vez que abras la app vas a crear uno nuevo.",
                confirmLabel: "Reiniciar PIN",
                cancelLabel: "Cancelar",
                danger: true,
              });
              if (ok) await onResetPin();
            }}
            style={{ width:"100%", marginTop:8, background:C.gold+"14", border:"1.5px solid "+C.gold+"55", borderRadius:12, padding:"12px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontWeight:700, fontSize:13, cursor:"pointer", color:C.gold, fontFamily:"inherit" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M12 16h.01"/></svg>
            Reiniciar PIN
          </button>
        )}

        {onResetAccount && (
          <button
            onClick={async () => {
              const ok = await confirm({
                title: "¿Reiniciar cuenta?",
                body: "Vas a borrar todos tus holdings, órdenes, saldo, watchlists, plan y reglas de stop loss. El email, contraseña, PIN y modo de interfaz se mantienen.",
                confirmLabel: "Reiniciar",
                cancelLabel: "Cancelar",
                danger: true,
              });
              if (ok) {
              }
            }}
            style={{ width:"100%", marginTop:4, background: C.red+"14", border:"1.5px solid "+C.red+"55", borderRadius:12, padding:"12px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontWeight:700, fontSize:13, cursor:"pointer", color:C.red, fontFamily:"inherit" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            Reiniciar cuenta (borrar datos)
          </button>
        )}

        {!logoutConfirm ? (
          <button onClick={() => setLogoutConfirm(true)} style={{ width:"100%", marginTop:8, background:C.red+"18", border:"1.5px solid "+C.red+"33", borderRadius:14, padding:"13px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, cursor:"pointer", fontFamily:"inherit" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span style={{ color:C.red, fontWeight:700, fontSize:14 }}>{t("logout")}</span>
          </button>
        ) : (
          <div style={{ marginTop:8, background:C.red+"18", border:"1.5px solid "+C.red+"33", borderRadius:14, padding:"14px 16px" }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>Cerrar sesion?</div>
            <div style={{ fontSize:11, color:C.textMd, marginBottom:12 }}>Tendras que verificar tu identidad al volver.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setLogoutConfirm(false)} style={{ flex:1, background:C.creamDk, border:"none", borderRadius:10, padding:"11px", fontWeight:600, fontSize:13, cursor:"pointer", color:C.textMd, fontFamily:"inherit" }}>Cancelar</button>
              <button onClick={onLogout} style={{ flex:2, background:C.red, border:"none", borderRadius:10, padding:"11px", fontWeight:700, fontSize:13, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Si, cerrar sesion</button>
            </div>
          </div>
        )}
      </div>
      <ConfirmHost/>
    </div>
  );
}

// ============================================================
// MOBILE PHONE WRAPPER
// ============================================================
function MobileApp({ appState, handlers, C }) {
  const { loggedIn, needsAuth, needsMfa, mfaPassed, setMfaPassed, needsPinGate, needsWelcome, uiMode, displayUser, sbSession, sbProfile, refetchProfile, pinUnlocked, setPinUnlocked, showProfile, isDark, tab, showUSD, lang, orders, selectedAsset, pendingTrade, toast, holdings, stopLosses, priceAlerts, balance, showTutorial, watchlist, watchlists, finnhubKey, finnhub, emailjsCfg, anthropicKey, anthropicModel, savedPlan, portfolioHistory, recurringAporte, pickerTicker } = appState;
  const { handleLogin, handleSignup, handleDeposit, setShowProfile, setIsDark, setTab, setShowUSD, setLang, setSelected, handleTrade, executeTrade, setPending, handleSetSL, handleSetAlert, handleLogout, finishTutorial, setShowTutorial, toggleWatchlist, createWatchlist, renameWatchlist, removeWatchlist, addToWatchlist, removeFromWatchlist, setTickerInLists, setPickerTicker, setFinnhubKey, setEmailjsCfg, setAnthropicKey, setAnthropicModel, setSavedPlan, setRecurringAporte } = handlers;
  // Modal state hoisted out of PagePortfolio so the wizard's absolute
  // overlay covers the full phone frame (otherwise it was clipped by the
  // page's overflow:auto scroll container — the X button could fall out
  // of the visible region on some scroll offsets).
  const [showObjectives, setShowObjectives] = useState(false);
  // Asset-picker (add to watchlist) — same hoisting pattern.
  const [addingToListId, setAddingToListId] = useState(null);
  const t = useT(lang);
  const TABS = [{ id:"portfolio",label:t("portfolio") },{ id:"mercado",label:t("mercado") },{ id:"favoritos",label:"Watchlist" },{ id:"noticias",label:t("noticias") },{ id:"ordenes",label:t("ordenes") }];
  const totalARS = holdings.reduce((s, h) => { const a = ASSETS.find(x => x.ticker === h.ticker); return s + (a ? h.qty * a.price : 0); }, 0);
  const newsBadge = NEWS.filter(n => n.tickers.some(t => holdings.map(h => h.ticker).includes(t))).length;
  const getH = t => holdings.find(h => h.ticker === t);
  const getSL = t => stopLosses[t] || null;
  const getA  = t => priceAlerts[t] || null;
  const renderPage = () => {
    switch (tab) {
      case "portfolio": return <PagePortfolio holdings={holdings} stopLosses={stopLosses} balance={balance} watchlist={watchlist} onToggleWatchlist={toggleWatchlist} onSelectAsset={setSelected} onDeposit={handleDeposit} onOpenObjectives={() => setShowObjectives(true)} savedPlan={savedPlan} onClearPlan={() => setSavedPlan(null)} portfolioHistory={portfolioHistory} recurringAporte={recurringAporte} onSetRecurring={setRecurringAporte} uiMode={uiMode} C={C} showUSD={showUSD} lang={lang}/>;
      case "mercado":    return <PageMercado onSelectAsset={setSelected} C={C} showUSD={showUSD} lang={lang}/>;
      case "favoritos":  return <PageWatchlist watchlists={watchlists} onCreate={createWatchlist} onRename={renameWatchlist} onRemove={removeWatchlist} onRemoveTicker={removeFromWatchlist} onOpenAssetPicker={setAddingToListId} onSelectAsset={setSelected} C={C} showUSD={showUSD}/>;
      case "noticias":   return <PageNoticias holdings={holdings} watchlists={watchlists} onSelectAsset={setSelected} C={C} lang={lang}/>;
      case "ideas":      return <PageIdeas C={C} showUSD={showUSD} onSelectAsset={setSelected} lang={lang}/>;
      case "ordenes":    return <PageOrdenes orders={orders} C={C} lang={lang}/>;
      default:           return <PagePortfolio watchlist={watchlist} onToggleWatchlist={toggleWatchlist} holdings={holdings} stopLosses={stopLosses} balance={balance} onSelectAsset={setSelected} onDeposit={handleDeposit} onOpenObjectives={() => setShowObjectives(true)} savedPlan={savedPlan} onClearPlan={() => setSavedPlan(null)} portfolioHistory={portfolioHistory} recurringAporte={recurringAporte} onSetRecurring={setRecurringAporte} uiMode={uiMode} C={C} showUSD={showUSD} lang={lang}/>;
    }
  };
  // Native shells (Capacitor wrap) get a full-viewport canvas — the
  // OS provides the real device chrome (bezel, notch, home indicator)
  // so our fake-iPhone frame would just look weird inside an iPhone.
  // Browser preview keeps the 375x760 mock with bezel + faux notch.
  //
  // We use position:fixed + inset:0 to lock the frame to the device
  // edges. This dodges any height-collapse issue that 100vh / 100dvh
  // hit when nested inside other flex/scroll containers — fixed +
  // inset:0 always fills the viewport regardless of the parent chain.
  //
  // Each chrome bar (header + bottom nav) applies its own
  // safe-area-inset so the dark theme extends edge-to-edge under
  // the status bar and home indicator (the canonical iOS look).
  const frameStyle = isNativeApp
    ? {
        position: "fixed",
        inset: 0,
        background: C.bg,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        overflow: "hidden",
      }
    : {
        width: 375,
        height: 760,
        background: C.bg,
        borderRadius: 48,
        overflow: "hidden",
        boxShadow: "0 40px 80px rgba(0,0,0,0.7)",
        display: "flex",
        flexDirection: "column",
        border: "9px solid #0a0a0a",
        position: "relative",
        flexShrink: 0,
      };
  return (
    <div style={frameStyle}>
      {!isNativeApp && (
        <div style={{ position:"absolute", top:0, left:"50%", transform:"translateX(-50%)", width:110, height:26, background:"#0a0a0a", borderRadius:"0 0 16px 16px", zIndex:30 }}/>
      )}
      {needsAuth && <SupabaseAuthFlow C={C} session={sbSession} profile={sbProfile} onVerified={refetchProfile}/>}
      {needsMfa && <MfaChallengeView C={C} onSuccess={() => setMfaPassed(true)} onForgot={handlers.handleLogout}/>}
      {needsPinGate && (
        <PinLockScreen
          C={C}
          storedPinHash={sbProfile?.pin_hash || null}
          onSavePin={handlers.handleSavePin}
          userEmail={sbSession?.user?.email}
          onSuccess={() => setPinUnlocked(true)}
          onForgot={handlers.handleLogout}
        />
      )}
      {needsWelcome && (
        <WelcomeChooser
          C={C}
          userId={sbSession?.user?.id}
          onDone={() => refetchProfile()}
        />
      )}
      {showTutorial && <OnboardingTutorial onClose={finishTutorial} onComplete={finishTutorial} setTab={setTab} setShowUSD={setShowUSD} setShowProfile={setShowProfile} currentTab={tab} uiMode={uiMode} C={C}/>}
      {showProfile && <ProfileSheet displayUser={displayUser} uiMode={uiMode} onChangeUiMode={handlers.handleChangeUiMode} onResetAccount={handlers.handleResetAccount} onResetPin={handlers.handleResetPin} onClose={() => setShowProfile(false)} onLogout={handleLogout} onToggleDark={() => setIsDark(d => !d)} isDark={isDark} lang={lang} setLang={setLang} C={C}/>}
      {toast && <div className="samas-slide-up" style={{ position:"absolute", top:34, left:14, right:14, zIndex:50, background:toast.color, color:"#fff", borderRadius:14, padding:"10px 14px", fontSize:12, fontWeight:700, boxShadow:"0 10px 30px rgba(0,0,0,0.35)" }}>{toast.msg}</div>}
      {selectedAsset && <AssetDetail asset={selectedAsset} holding={getH(selectedAsset.ticker)} stopLoss={getSL(selectedAsset.ticker)} priceAlert={getA(selectedAsset.ticker)} balance={balance} isInWatchlist={watchlist.includes(selectedAsset.ticker)} onToggleWatchlist={toggleWatchlist} onClose={() => setSelected(null)} onTrade={handleTrade} onSetStopLoss={handleSetSL} onSetAlert={handleSetAlert} uiMode={uiMode} lang={lang} C={C}/>}
      {pendingTrade && <ConfirmTradeModal trade={pendingTrade} onConfirm={executeTrade} onCancel={() => setPending(null)} displayUser={displayUser} storedPinHash={sbProfile?.pin_hash || null} C={C}/>}
      {showObjectives && <ObjectivesWizard onClose={() => setShowObjectives(false)} onSave={setSavedPlan} savedPlan={savedPlan} C={C}/>}
      {pickerTicker && (
        <WatchlistPickerModal
          ticker={pickerTicker}
          watchlists={watchlists}
          onConfirm={(ids) => setTickerInLists(pickerTicker, ids)}
          onCreate={createWatchlist}
          onClose={() => setPickerTicker(null)}
          C={C}
        />
      )}
      {addingToListId && (() => {
        const l = (watchlists || []).find(x => x.id === addingToListId);
        const already = new Set(l?.tickers || []);
        return (
          <AssetPickerModal
            title={l ? `Agregar a "${l.name}"` : "Agregar activo"}
            alreadyIn={already}
            onPick={(ticker) => addToWatchlist && addToWatchlist(addingToListId, ticker)}
            onClose={() => setAddingToListId(null)}
            C={C}
          />
        );
      })()}
      <div style={{
        background:C.isDark?"#0F0F0F":"#0D1117",
        // overlaysWebView is true now (status bar floats over our
        // webview). Header paddingTop = safe-area-inset-top + a small
        // breathing-room offset, so SAMAS sits flush below the
        // status bar without a dead gap.
        paddingTop: isNativeApp ? "calc(env(safe-area-inset-top) + 6px)" : 30,
        paddingBottom: isNativeApp ? 6 : 8,
        paddingLeft: isNativeApp ? "max(20px, env(safe-area-inset-left))" : 20,
        paddingRight: isNativeApp ? "max(20px, env(safe-area-inset-right))" : 20,
        display:"flex", alignItems:"center", flexShrink:0, zIndex:10, gap:8,
      }}>
        {/* Three-column layout: left + center (SAMAS) + right. Each
            outer column is flex:1 with the same justify so the center
            stays optically centered regardless of how many badges
            live in the left/right slots (e.g. on native we hide the
            clock — the left slot becomes empty and without flex:1 the
            SAMAS logo would slide off-center to the left). */}
        <div style={{ flex:"1 1 0", display:"flex", alignItems:"center", gap:6, justifyContent:"flex-start", minWidth:0 }}>
          {/* Show app-rendered clock only in browser preview. On native
              the OS status bar already shows the time at the top, so a
              second clock here is redundant + steals horizontal space. */}
          {!isNativeApp && (
            <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:600 }}>{new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</span>
          )}
          {finnhub?.live && (
            <div title={`${finnhub.count} activos en vivo`} style={{ display:"flex", alignItems:"center", gap:3, background:C.accent+"22", border:"1px solid "+C.accent+"55", borderRadius:8, padding:"1px 5px" }}>
              <div style={{ width:5, height:5, borderRadius:3, background:C.accent }}/>
              <span style={{ fontSize:8, fontWeight:700, color:C.accent, letterSpacing:0.5 }}>LIVE</span>
            </div>
          )}
        </div>
        <div style={{ flex:"0 0 auto", display:"flex", justifyContent:"center" }}>
          <SAMASLogo textColor="#FFFFFF"/>
        </div>
        <div style={{ flex:"1 1 0", display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end", minWidth:0 }}>
          <CurrencyToggle showUSD={showUSD} onToggle={() => setShowUSD(v => !v)} C={C}/>
          <button onClick={() => setShowProfile(true)} style={{ background:"transparent", border:"none", cursor:"pointer", padding:0, flexShrink:0 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:"#0D111733", border:"1.5px solid #0D111766", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:C.goldLt }}>{displayUser.initials}</div>
          </button>
        </div>
      </div>
      {/* In beginner mode hide the live-ticker banner (too much info)
          and the USD CCL/Oficial triple-strip (we'll substitute a
          simpler "Dólar MEP" note inside each page where relevant). */}
      {uiMode !== "principiante" && <TickerBanner C={C}/>}
      {uiMode !== "principiante" && <FXStrip C={C} totalARS={totalARS}/>}
      {/* Scrollable page content. With the bottom nav now part of the
          flex flow (below) instead of absolute-positioned, this area
          is exactly the right size — no padding hack needed and no
          dead scroll area at the bottom when content is short.
          overscroll-behavior:contain stops the iOS rubber-band scroll
          from leaking up to the parent (which would visually shift
          the header / bottom nav along with the gesture). */}
      <div style={{ flex:1, overflowY:"auto", minHeight:0, overscrollBehavior:"contain", WebkitOverflowScrolling:"touch" }}>{renderPage()}</div>
      <div style={{
        flexShrink:0,
        background:C.isDark?"#0F0F0F":C.card,
        borderTop:"1px solid "+C.border,
        display:"flex",
        // Tighter on native: nav background ends right at the home
        // indicator with a small 2px gap so the labels don't kiss
        // the gesture bar. Previously had 4 + safe-area-inset = ~38pt
        // of empty space below the labels which read as dead room.
        height: isNativeApp ? "calc(64px + env(safe-area-inset-bottom))" : 78,
        zIndex:20,
        paddingTop: isNativeApp ? 4 : 6,
        paddingBottom: isNativeApp ? "calc(2px + env(safe-area-inset-bottom))" : 4,
      }}>
        {TABS.map(t => {
          const active = tab === t.id;
          const badge = t.id==="ordenes"&&orders.length>0 ? orders.length : t.id==="noticias"&&tab!=="noticias" ? newsBadge : 0;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex:1, minWidth:0, // minWidth:0 lets flex children actually shrink, otherwise
                                  // long labels like "Portafolio" overflow and get clipped by
                                  // the parent overflow:hidden on small screens.
              background:"transparent", border:"none", cursor:"pointer",
              display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center",
              gap:4, position:"relative",
              fontFamily:"inherit", padding:"4px 2px",
              overflow:"hidden",
            }}>
              {badge > 0 && <div style={{ position:"absolute", top:8, right:"24%", minWidth:18, height:18, borderRadius:9, background:t.id==="noticias"?C.gold:C.red, color:"#fff", fontSize:10, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 5px" }}>{badge}</div>}
              <div style={{ width:46, height:32, borderRadius:16, background: active ? C.accent + "22" : "transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"background 0.2s", flexShrink:0 }}>
                <TabIcon id={t.id} active={active} C={C} bigger/>
              </div>
              <span style={{
                fontSize:10, fontWeight:active?700:500,
                color:active?C.accent:C.textLt,
                letterSpacing:0.2,
                whiteSpace:"nowrap",
                maxWidth:"100%",
                overflow:"hidden",
                textOverflow:"ellipsis",
                textAlign:"center",
              }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// WEB DASHBOARD LAYOUT
// ============================================================
function WebDashboard({ appState, handlers, C }) {
  const { holdings, stopLosses, priceAlerts, balance, orders, selectedAsset, pendingTrade, toast, isDark, loggedIn, needsAuth, needsMfa, mfaPassed, setMfaPassed, needsPinGate, needsWelcome, uiMode, displayUser, sbSession, sbProfile, refetchProfile, pinUnlocked, setPinUnlocked, showProfile, showUSD, showTutorial, lang, watchlist, watchlists, finnhubKey, finnhub, emailjsCfg, anthropicKey, anthropicModel, savedPlan, portfolioHistory, recurringAporte, pickerTicker } = appState;
  const { setSelected, handleTrade, executeTrade, setPending, handleSetSL, handleSetAlert, handleLogout, setShowProfile, setIsDark, setShowUSD, setLang, finishTutorial, toggleWatchlist, createWatchlist, renameWatchlist, removeWatchlist, addToWatchlist, removeFromWatchlist, setTickerInLists, setPickerTicker, setFinnhubKey, setEmailjsCfg, handleDeposit, setAnthropicKey, setAnthropicModel, setSavedPlan, setRecurringAporte } = handlers;
  const [sideTab, setSideTab] = useState("portfolio");
  // Objectives modal lives at dashboard level for the same reason as in
  // MobileApp — keeps the overlay out of the page's scroll container.
  const [showObjectives, setShowObjectives] = useState(false);
  const [addingToListId, setAddingToListId] = useState(null);
  const t = useT(lang);
  const TABS2 = [{ id:"portfolio",label:t("portfolio"),icon:"portfolio" },{ id:"mercado",label:t("mercado"),icon:"mercado" },{ id:"favoritos",label:"Watchlist",icon:"favoritos" },{ id:"noticias",label:t("noticias"),icon:"noticias" },{ id:"ideas",label:t("inversiones"),icon:"ideas" },{ id:"bonos",label:t("bonos"),icon:"bonos" },{ id:"ordenes",label:t("ordenes"),icon:"ordenes" },{ id:"reportes",label:t("reportes"),icon:"reportes" }];
  const totalARS = holdings.reduce((s, h) => { const a = ASSETS.find(x => x.ticker === h.ticker); return s + (a ? h.qty * a.price : 0); }, 0);
  const getH = t => holdings.find(h => h.ticker === t);
  const getSL = t => stopLosses[t] || null;
  const getA  = t => priceAlerts[t] || null;
  const renderPage = () => {
    switch (sideTab) {
      case "portfolio": return <PagePortfolio holdings={holdings} stopLosses={stopLosses} balance={balance} watchlist={watchlist} onToggleWatchlist={toggleWatchlist} onSelectAsset={setSelected} onDeposit={handleDeposit} onOpenObjectives={() => setShowObjectives(true)} savedPlan={savedPlan} onClearPlan={() => setSavedPlan(null)} portfolioHistory={portfolioHistory} recurringAporte={recurringAporte} onSetRecurring={setRecurringAporte} uiMode={uiMode} C={C} showUSD={showUSD} lang={lang}/>;
      case "mercado":    return <PageMercado onSelectAsset={setSelected} C={C} showUSD={showUSD} lang={lang}/>;
      case "favoritos":  return <PageWatchlist watchlists={watchlists} onCreate={createWatchlist} onRename={renameWatchlist} onRemove={removeWatchlist} onRemoveTicker={removeFromWatchlist} onOpenAssetPicker={setAddingToListId} onSelectAsset={setSelected} C={C} showUSD={showUSD}/>;
      case "noticias":   return <PageNoticias holdings={holdings} watchlists={watchlists} onSelectAsset={setSelected} C={C} lang={lang}/>;
      case "ideas":      return <PageIdeas C={C} showUSD={showUSD} onSelectAsset={setSelected} lang={lang}/>;
      case "bonos":      return <PageBonos C={C} showUSD={showUSD} lang={lang}/>;
      case "ordenes":    return <PageOrdenes orders={orders} C={C} lang={lang}/>;
      case "reportes":   return <PageReportes C={C} lang={lang}/>;
      default:           return <PagePortfolio watchlist={watchlist} onToggleWatchlist={toggleWatchlist} holdings={holdings} stopLosses={stopLosses} balance={balance} onSelectAsset={setSelected} onDeposit={handleDeposit} onOpenObjectives={() => setShowObjectives(true)} savedPlan={savedPlan} onClearPlan={() => setSavedPlan(null)} portfolioHistory={portfolioHistory} recurringAporte={recurringAporte} onSetRecurring={setRecurringAporte} uiMode={uiMode} C={C} showUSD={showUSD} lang={lang}/>;
    }
  };
  return (
    <div style={{ width:"100%", minHeight:"100vh", background:C.isDark?"#0F0F0F":"#0D1117", display:"flex", flexDirection:"column" }}>
      {/* Header: keep the dark surface full-bleed, but constrain the
          INNER header content to the same max-width as the body so brand
          + dollar chips stay aligned with the sidebar/columns below. */}
      <div style={{ background:C.isDark?"#0F0F0F":"#0D1117", height:56, borderBottom:"1px solid rgba(255,255,255,0.08)", position:"sticky", top:0, zIndex:50, display:"flex", justifyContent:"center" }}>
      <div style={{ display:"flex", alignItems:"center", padding:"0 24px", gap:24, width:"100%", maxWidth:1480 }}>
        <SAMASLogo textColor="#FFFFFF"/>
        {finnhub?.live && (
          <div title={`${finnhub.count} activos en vivo (Finnhub)`} style={{ display:"flex", alignItems:"center", gap:4, background:C.accent+"22", border:"1px solid "+C.accent+"55", borderRadius:10, padding:"3px 8px" }}>
            <div style={{ width:6, height:6, borderRadius:3, background:C.accent }}/>
            <span style={{ fontSize:9, fontWeight:700, color:C.accent, letterSpacing:0.5 }}>LIVE · {finnhub.count}</span>
          </div>
        )}
        <div style={{ flex:1 }}/>
        <div style={{ display:"flex", gap:8 }}>
          {FX.map(fx => <div key={fx.label} style={{ background:"rgba(255,255,255,0.07)", borderRadius:8, padding:"4px 10px" }}><div style={{ color:"rgba(255,255,255,0.45)", fontSize:8, fontWeight:700 }}>USD {fx.label}</div><div style={{ color:"#fff", fontSize:11, fontFamily:"monospace", fontWeight:700 }}>${fN(fx.value)}</div><div style={{ color:fx.up?"#4ADE80":"#F87171", fontSize:9 }}>{fx.up?"+":"-"}{Math.abs(fx.change).toFixed(1)}%</div></div>)}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={() => setShowUSD(v => !v)} style={{ background:showUSD?"#16C78433":"rgba(255,255,255,0.07)", border:"1px solid "+(showUSD?"#16C78455":"transparent"), borderRadius:8, padding:"6px 10px", color:showUSD?"#E8C97A":"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:showUSD?700:400 }}>
            {showUSD ? "USD" : "ARS"}
          </button>
          <button onClick={() => setIsDark(d => !d)} style={{ background:"rgba(255,255,255,0.07)", border:"none", borderRadius:8, padding:"6px 10px", color:"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{isDark?"Modo claro":"Modo oscuro"}</button>
          <button onClick={() => setShowProfile(true)} style={{ background:"#0D111733", border:"1.5px solid #0D111766", borderRadius:8, padding:"6px 12px", color:C.goldLt, fontWeight:800, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{displayUser.initials}</button>
        </div>
      </div>
      </div>
      {/* Body: sidebar + center + rail. Constrained to 1480 and centered
          so ultra-wide monitors get symmetrical margins instead of a
          huge empty area on the right. */}
      <div style={{ display:"flex", flex:1, width:"100%", maxWidth:1480, margin:"0 auto" }}>
        <div style={{ width:220, background:C.isDark?"#0F0F0F":"#0D1117", borderRight:"1px solid rgba(255,255,255,0.06)", padding:"20px 12px", display:"flex", flexDirection:"column", gap:4, position:"sticky", top:56, height:"calc(100vh - 56px)", overflowY:"auto" }}>
          {TABS2.map(t => (
            <button key={t.id} onClick={() => setSideTab(t.id)} style={{ background: sideTab===t.id ? "#16C78433" : "transparent", border: sideTab===t.id ? "1px solid #16C78455" : "1px solid transparent", borderRadius:10, padding:"10px 14px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontFamily:"inherit", width:"100%", textAlign:"left" }}>
              <TabIcon id={t.icon} active={sideTab===t.id} C={C}/>
              <span style={{ fontSize:13, fontWeight: sideTab===t.id ? 700 : 500, color: sideTab===t.id ? "#fff" : "rgba(255,255,255,0.5)" }}>{t.label}</span>
            </button>
          ))}
          <div style={{ flex:1 }}/>
          <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:12, padding:"12px" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", fontWeight:700, letterSpacing:1, marginBottom:6 }}>CARTERA USD</div>
            {FX.map(fx => <div key={fx.label} style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}><span style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>{fx.label}</span><span style={{ fontSize:11, fontFamily:"monospace", fontWeight:700, color:"rgba(255,255,255,0.8)" }}>u$s{fN(Math.round(totalARS/fx.value))}</span></div>)}
          </div>
        </div>
        <div style={{ flex:1, position:"relative", minWidth:0 }}>
          {selectedAsset && <AssetDetail asset={selectedAsset} holding={getH(selectedAsset.ticker)} stopLoss={getSL(selectedAsset.ticker)} priceAlert={getA(selectedAsset.ticker)} balance={balance} isInWatchlist={watchlist.includes(selectedAsset.ticker)} onToggleWatchlist={toggleWatchlist} onClose={() => setSelected(null)} onTrade={handleTrade} onSetStopLoss={handleSetSL} onSetAlert={handleSetAlert} uiMode={uiMode} lang={lang} C={C}/>}
          {pendingTrade && <ConfirmTradeModal trade={pendingTrade} onConfirm={executeTrade} onCancel={() => setPending(null)} isWeb={true} displayUser={displayUser} storedPinHash={sbProfile?.pin_hash || null} C={C}/>}
          {showProfile && <ProfileSheet displayUser={displayUser} uiMode={uiMode} onChangeUiMode={handlers.handleChangeUiMode} onResetAccount={handlers.handleResetAccount} onResetPin={handlers.handleResetPin} onClose={() => setShowProfile(false)} onLogout={handleLogout} onToggleDark={() => setIsDark(d => !d)} isDark={isDark} lang={lang} setLang={setLang} C={C}/>}
          {toast && <div className="samas-slide-up" style={{ position:"fixed", top:70, left:"50%", transform:"translateX(-50%)", zIndex:99, background:toast.color, color:"#fff", borderRadius:14, padding:"10px 20px", fontSize:13, fontWeight:700, boxShadow:"0 8px 32px rgba(0,0,0,0.3)" }}>{toast.msg}</div>}
          <div style={{ overflowY:"auto", height:"calc(100vh - 56px)" }}>{renderPage()}</div>
          {showObjectives && <ObjectivesWizard onClose={() => setShowObjectives(false)} onSave={setSavedPlan} savedPlan={savedPlan} C={C}/>}
          {pickerTicker && (
            <WatchlistPickerModal
              ticker={pickerTicker}
              watchlists={watchlists}
              onConfirm={(ids) => setTickerInLists(pickerTicker, ids)}
              onCreate={createWatchlist}
              onClose={() => setPickerTicker(null)}
              C={C}
            />
          )}
          {addingToListId && (() => {
            const l = (watchlists || []).find(x => x.id === addingToListId);
            const already = new Set(l?.tickers || []);
            return (
              <AssetPickerModal
                title={l ? `Agregar a "${l.name}"` : "Agregar activo"}
                alreadyIn={already}
                onPick={(ticker) => addToWatchlist && addToWatchlist(addingToListId, ticker)}
                onClose={() => setAddingToListId(null)}
                C={C}
              />
            );
          })()}
        </div>
        <div style={{ width:320, background:C.card, borderLeft:"1px solid "+C.border, padding:"20px 16px", position:"sticky", top:56, height:"calc(100vh - 56px)", overflowY:"auto" }}>
          <div style={{ fontWeight:700, fontSize:14, color:C.text, marginBottom:16 }}>Mercado en vivo</div>
          {ASSETS.slice(0,8).map(a => (
            <button key={a.ticker} onClick={() => setSelected(a)} style={{ width:"100%", background:"transparent", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid "+C.border+"44", fontFamily:"inherit" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <AssetLogo asset={a} size={28} C={C}/>
                <div style={{ textAlign:"left" }}><div style={{ fontSize:12, fontWeight:700, color:C.text }}>{a.ticker}</div><div style={{ fontSize:10, color:C.textLt }}>{a.name.split(" ")[0]}</div></div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:12, fontFamily:"monospace", fontWeight:700, color:C.text }}>${fN(a.price)}</div>
                <div style={{ fontSize:11, fontWeight:700, color:a.up?C.green:C.red }}>{a.up?"+":"-"}{Math.abs(a.change).toFixed(2)}%</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function SAMASApp() {
  // Preferences + simulator state are persisted to localStorage. Only the
  // truly ephemeral state (modals, toasts, current tab, pending trade) lives
  // in memory — everything a user would expect to survive a reload is saved.
  const [isDark, setIsDark]           = usePersistedState("samas_ui_dark", true);
  // Real auth: Supabase session + phone-verified flag + local PIN gate.
  // The app is "logged in" only when all three are true:
  //   - valid Supabase session
  //   - profile.phone_verified = true (WhatsApp OTP completed)
  //   - user has passed the PIN gate this tab session
  const { session: sbSession, profile: sbProfile, loading: sbLoading, refetchProfile } = useSupabaseSession();
  // pinUnlocked is per-tab (useState, not persisted) — the user has to
  // enter the PIN every time they reopen the app.
  const [pinUnlocked, setPinUnlocked] = useState(false);
  // MFA gate: after password login, if the user has a verified TOTP
  // factor we require an additional code before showing the app. This
  // lifts the session from AAL1 to AAL2.
  const [mfaPassed, setMfaPassed] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  useEffect(() => {
    if (!sbSession?.user) {
      setMfaPassed(false);
      setMfaRequired(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!alive) return;
        if (error) {
          console.error("[mfa] aal check failed:", error);
          // Be permissive on error so the user isn't locked out.
          setMfaRequired(false);
          setMfaPassed(true);
          return;
        }
        const needs = data?.currentLevel === "aal1" && data?.nextLevel === "aal2";
        setMfaRequired(needs);
        setMfaPassed(!needs);
      } catch (e) {
        console.error("[mfa] aal exception:", e);
        if (alive) { setMfaRequired(false); setMfaPassed(true); }
      }
    })();
    return () => { alive = false; };
  }, [sbSession?.access_token]);

  const supabaseReady = !!sbSession && !!sbProfile?.phone_verified && (!mfaRequired || mfaPassed);
  const needsAuth   = !sbLoading && !supabaseReady && !mfaRequired;
  const needsMfa    = !sbLoading && !!sbSession && !!sbProfile?.phone_verified && mfaRequired && !mfaPassed;
  const needsPinGate = supabaseReady && !pinUnlocked;
  // ui_mode comes from profiles.ui_mode. null = never chosen → show the
  // WelcomeChooser once the session is fully unlocked. Changeable later
  // from the Settings submenu.
  const uiMode        = sbProfile?.ui_mode || null;
  const needsWelcome  = supabaseReady && pinUnlocked && !uiMode;
  const loggedIn    = supabaseReady && pinUnlocked && !!uiMode;
  // displayUser — name/email/initials derived from the real Supabase
  // session + profile. Replaces the old DEMO_USER hardcoded values in
  // every UI surface (ProfileSheet, header avatars, email receipts).
  // Falls back to "Usuario Demo" only if no session is present, which
  // shouldn't happen once the auth gates are passed.
  const displayUser = useMemo(() => {
    if (!sbSession?.user) return DEMO_USER;
    const first = (sbProfile?.nombre || "").trim();
    const last  = (sbProfile?.apellido || "").trim();
    const email = sbSession.user.email || "";
    const fullName = [first, last].filter(Boolean).join(" ") || email.split("@")[0] || "Usuario";
    const initials = (() => {
      if (first && last) return (first[0] + last[0]).toUpperCase();
      const parts = fullName.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
      return (email.slice(0, 2) || "U").toUpperCase();
    })();
    return { name: fullName, email, initials };
  }, [sbSession, sbProfile]);
  // Tutorial-seen flag lives on profiles.seen_tutorial in Supabase so it
  // follows the user across devices / browsers / incognito sessions. The
  // flag is read directly from sbProfile (see useEffect that gates the
  // popup), and written via raw fetch in finishTutorial (SDK builder
  // hangs intermittently — same workaround as handleChangeUiMode).
  const [showTutorial, setShowTutorial] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [tab, setTab]                 = useState("portfolio");
  const [showUSD, setShowUSD]         = usePersistedState("samas_show_usd", false);
  const [lang, setLang]               = usePersistedState("samas_lang", "es");
  const [selectedAsset, setSelected]  = useState(null);
  const [orders, setOrders]           = usePersistedState("samas_orders", []);
  // Default to empty holdings — real broker, not a demo sandbox. A new
  // user sees the OnboardingEmptyState prompting them to deposit + buy.
  // INIT_HOLDINGS remains as a constant in this file for future demo /
  // testing purposes (dev-only "seed my account" button) but is no
  // longer pushed to new accounts automatically.
  const [holdings, setHoldings]       = usePersistedState("samas_holdings", []);
  const [stopLosses, setStopLosses]   = usePersistedState("samas_stop_losses", {});
  const [priceAlerts, setPriceAlerts] = usePersistedState("samas_price_alerts", {});
  // Multi-watchlist model: an array of named lists, each with its own
  // tickers. The first list is treated as the default — the star-toggle
  // on assets adds/removes from "any" list, preferring the default when
  // adding. One-shot migration from the legacy flat array is handled
  // inline so returning users don't lose their tickers.
  const [watchlists, setWatchlists] = usePersistedState("samas_watchlists", (() => {
    try {
      const legacy = typeof localStorage !== "undefined" ? localStorage.getItem("samas_watchlist") : null;
      if (legacy) {
        const tickers = JSON.parse(legacy);
        if (Array.isArray(tickers) && tickers.length) {
          return [{ id: "default", name: "Mi Watchlist", tickers }];
        }
      }
    } catch {}
    return [{ id: "default", name: "Mi Watchlist", tickers: ["SPY","BTC","GGAL"] }];
  })());
  // Flattened set of tickers across ALL lists — consumed by AssetDetail
  // to decide whether to render a filled star. Derived, not stored.
  const watchlist = (() => {
    const seen = new Set();
    (watchlists || []).forEach(l => (l.tickers || []).forEach(t => seen.add(t)));
    return [...seen];
  })();
  const [balance, setBalance]         = usePersistedState("samas_balance", 0);
  // Saved plan from the Objetivos wizard (strategy + allocation + profile
  // used to generate it + timestamp). Persisted so users can return to
  // their plan, and the Portfolio page can render progress against it.
  const [savedPlan, setSavedPlan]     = usePersistedState("samas_plan", null);
  // Time-series snapshots of total portfolio value, one per day, so we can
  // render a sparkline on the hero card. Bootstrapped with a synthetic
  // 30-day backfill on first load so new accounts don't see a flat line.
  const [portfolioHistory, setPortfolioHistory] = usePersistedState("samas_portfolio_history", null);
  // Programmed monthly auto-contribution. Shape: { amount, lastApplied }
  // where lastApplied is an ISO date. Null = not configured.
  const [recurringAporte, setRecurringAporte] = usePersistedState("samas_recurring_aporte", null);
  const [pendingTrade, setPending]    = useState(null);
  const [toast, setToast]             = useState(null);
  const [viewMode, setViewMode]       = usePersistedState("samas_view_mode", "mobile");
  const [finnhubKey, setFinnhubKey]   = useState(() => loadKey());
  const [emailjsCfg, setEmailjsCfg]   = useState(() => loadEmailjsConfig());
  // Anthropic (Claude) — BYOK. Same pattern as Finnhub: localStorage-backed,
  // user pastes their own key in the Profile sheet.
  const [anthropicKey, setAnthropicKey] = useState(() => loadAnthropicKey());
  const [anthropicModel, setAnthropicModelState] = useState(() => loadAnthropicModel());

  const C = makeTheme(isDark);

  // MEP rate from the FX strip — converts USD quotes into peso-equivalent.
  const mepRate = (FX.find(f => f.label === "MEP") || FX[0]).value;
  const finnhub = useFinnhubQuotes(finnhubKey, mepRate);

  // Persist the key whenever it changes
  useEffect(() => { saveKey(finnhubKey); }, [finnhubKey]);
  useEffect(() => { saveEmailjsConfig(emailjsCfg); }, [emailjsCfg]);
  useEffect(() => { saveAnthropicKey(anthropicKey); }, [anthropicKey]);
  useEffect(() => { saveAnthropicModel(anthropicModel); }, [anthropicModel]);
  const setAnthropicModel = (m) => setAnthropicModelState(m || ANTHROPIC_DEFAULT_MODEL);

  const [showShortcuts, setShowShortcuts] = useState(false);
  useKeyboardShortcuts(setTab, () => setShowShortcuts(true));

  // RTL support — flip the document direction for Hebrew / Arabic so that
  // text, form fields, and mirrored icons read naturally. Everything else
  // is positioned with flexbox which adapts to dir="rtl" automatically.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dir = RTL_LANGS.includes(lang) ? "rtl" : "ltr";
      document.documentElement.lang = lang;
    }
  }, [lang]);

  // Current total holdings value in ARS (same number the hero card shows
  // as "CARTERA TOTAL"). Derived fresh every render so the sparkline +
  // snapshot logic stay in sync with trades.
  const totalARS = holdings.reduce((s, h) => {
    const a = ASSETS.find(x => x.ticker === h.ticker);
    return s + (a ? h.qty * a.price : 0);
  }, 0);

  // History seeding intentionally disabled. We used to backfill a
  // synthetic 30-day random walk on first mount so the hero sparkline
  // looked alive. Once we wired the real account flow:
  //   - new users have totalARS=0 at seed time, so the walk produced
  //     a flat history at 1 ARS,
  //   - then the user deposits and trades, snapshot effect appends
  //     today's real value (e.g. 50,000 ARS),
  //   - chart now renders +9,239,900% which is obviously broken.
  // Rather than fight the seeding logic, just don't seed. The
  // sparkline appears naturally once there are 2+ daily snapshots
  // recorded by the snapshot effect below.

  // Append a new snapshot for today whenever the total materially changes
  // and we're on a fresh day vs. the last snapshot. Dedupe: one per date.
  useEffect(() => {
    if (!portfolioHistory) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    setPortfolioHistory(prev => {
      if (!prev || !prev.length) return prev;
      const last = prev[prev.length - 1];
      if (last.date === todayIso) {
        // Update today's value in place (no duplicate rows).
        if (last.value === Math.round(totalARS)) return prev;
        return [...prev.slice(0, -1), { date: todayIso, value: Math.round(totalARS) }];
      }
      // New day, append.
      return [...prev, { date: todayIso, value: Math.round(totalARS) }].slice(-120);   // cap at 4 months
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalARS]);

  // Apply the recurring aporte if one is configured and a calendar month has
  // passed since lastApplied. Runs once on mount. Values are clamped so a
  // hand-edited localStorage key (negative amount, future date, wrong
  // types) can't silently drain or inflate the balance.
  useEffect(() => {
    if (!recurringAporte || !recurringAporte.lastApplied) return;
    const amount = Math.max(0, Number(recurringAporte.amount) || 0);
    if (amount <= 0) return;
    const now = new Date();
    const last = new Date(recurringAporte.lastApplied);
    if (isNaN(last.getTime())) return;   // malformed date
    const monthsElapsed = Math.max(
      0,
      (now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth())
    );
    if (monthsElapsed < 1) return;
    const toApply = Math.min(monthsElapsed, 6);
    const credit = amount * toApply;
    setBalance(b => b + credit);
    setRecurringAporte(prev => ({ ...prev, lastApplied: now.toISOString().slice(0, 10) }));
    showToast(`Aporte automático: $${fN(credit)} acreditado (${toApply} ${toApply === 1 ? "mes" : "meses"})`, C.green);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => setShowTutorial(true);
    window.addEventListener('show-tutorial', handler);
    return () => window.removeEventListener('show-tutorial', handler);
  }, []);

  const showToast = (msg, color) => { setToast({ msg, color: color || C.green }); setTimeout(() => setToast(null), 4000); };

  // ----- Supabase sync for portfolio data -----
  // On first mount (or when the user switches accounts), pull the
  // canonical state from Supabase and use it as the source of truth.
  // localStorage stays as a fast cache so renders are instant; the
  // DB load just overrides if it has data, or seeds the DB with the
  // local cache if it's empty (typical first-login case).
  const userId = sbSession?.user?.id;
  // Gate to avoid re-saving on the round-trip from the initial load.
  // Until syncedUserIdRef matches the current userId, the save effects
  // below skip — they only kick in once the loader has finished.
  const syncedUserIdRef = useRef(null);
  useEffect(() => {
    if (!userId || !uiMode) return; // wait until auth gates pass
    let alive = true;
    syncedUserIdRef.current = null; // block saves while we're loading
    (async () => {
      try {
        const snap = await loadUserPortfolio(userId);
        if (!alive) return;
        // Real broker, no demo seeding. If the DB is empty we keep local
        // state empty too — the user sees the OnboardingEmptyState and
        // has to fund their account + make their first trade like on
        // any real broker app.
        setHoldings(snap.holdings || []);
        setOrders(snap.orders || []);
        setBalance(snap.balance != null ? snap.balance : 0);
        setWatchlists(
          (snap.watchlists && snap.watchlists.length > 0)
            ? snap.watchlists
            : [{ id: "default", name: "Mi Watchlist", tickers: [] }],
        );
        setSavedPlan(snap.plan || null);
        setStopLosses(snap.stopLosses || {});
        setPriceAlerts(snap.priceAlerts || {});
        // Preferences + recurring + history. Each value can be null
        // when the DB has no opinion (or fetch errored). In that case
        // we keep whatever was in localStorage — that's fine because
        // localStorage is just an instant cache that the next change
        // will sync up to the DB anyway.
        if (snap.recurringAporte !== null && snap.recurringAporte !== undefined) {
          setRecurringAporte(snap.recurringAporte);
        }
        if (snap.portfolioHistory !== null && snap.portfolioHistory !== undefined) {
          setPortfolioHistory(snap.portfolioHistory);
        }
        if (snap.lang)              setLang(snap.lang);
        if (typeof snap.showUSD  === "boolean") setShowUSD(snap.showUSD);
        if (typeof snap.uiDark   === "boolean") setIsDark(snap.uiDark);
        if (snap.viewMode)          setViewMode(snap.viewMode);
        if (snap.errors.length > 0) {
          console.warn("[userData] partial load errors:", snap.errors);
        }
        if (alive) syncedUserIdRef.current = userId;
      } catch (e) {
        console.error("[userData] load failed:", e);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, uiMode]);

  // Save effects — write to DB whenever the state changes, after the
  // initial load has completed (gated on syncedUserIdRef).
  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    saveWatchlists(userId, watchlists)
      .then((newLists) => {
        // saveWatchlists returns rows with new DB-generated UUIDs.
        // If we got new ids, swap them into local state so subsequent
        // edits hit the same DB rows. Skip if length differs (race).
        if (Array.isArray(newLists) && newLists.length === watchlists.length) {
          // Only swap when ids actually changed (avoid unnecessary re-renders)
          const idsChanged = newLists.some((w, i) => w.id !== watchlists[i].id);
          if (idsChanged) setWatchlists(newLists);
        }
      })
      .catch((e) => console.error("[watchlists] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlists, userId]);

  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    if (savedPlan) {
      savePlan(userId, savedPlan).catch((e) => console.error("[plan] save:", e));
    } else {
      clearPlans(userId).catch((e) => console.error("[plan] clear:", e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPlan, userId]);

  // Risk rules — JSONB columns on profiles, so each change is a small
  // whole-value update. Cheap, no need for debouncing at this volume.
  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    saveStopLosses(userId, stopLosses).catch((e) => console.error("[stopLosses] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopLosses, userId]);

  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    savePriceAlerts(userId, priceAlerts).catch((e) => console.error("[priceAlerts] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceAlerts, userId]);

  // ----- Preferences + recurring aporte + portfolio history -----
  // Each save effect mirrors the local state to its corresponding
  // profile column. Gated on syncedUserIdRef so we never echo back
  // whatever we just hydrated from the DB. Failures are logged but
  // not surfaced — the localStorage cache still has the change so
  // the user's UI stays consistent on this device.
  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    saveRecurringAporte(userId, recurringAporte).catch((e) => console.error("[recurringAporte] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringAporte, userId]);

  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    savePortfolioHistory(userId, portfolioHistory).catch((e) => console.error("[portfolioHistory] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioHistory, userId]);

  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    saveLang(userId, lang).catch((e) => console.error("[lang] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, userId]);

  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    saveShowUSD(userId, showUSD).catch((e) => console.error("[showUSD] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUSD, userId]);

  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    saveUiDark(userId, isDark).catch((e) => console.error("[uiDark] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, userId]);

  useEffect(() => {
    if (syncedUserIdRef.current !== userId || !userId) return;
    saveViewMode(userId, viewMode).catch((e) => console.error("[viewMode] save:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, userId]);

  const handleTrade = trade => { setSelected(null); setPending(trade); };

  const executeTrade = () => {
    const { ticker, side, qty, price } = pendingTrade;
    const total = qty * price;
    // Compute next state synchronously, persist locally, then push to DB.
    setOrders(prev => {
      const next = [{ ticker, side, qty, price }, ...prev];
      if (userId) appendOrder(userId, { ticker, side, qty, price }).catch((e) => console.error("[orders] append:", e));
      return next;
    });
    if (side === "Compra") {
      setBalance(prev => {
        const next = prev - total;
        if (userId) saveBalance(userId, next).catch((e) => console.error("[balance] save:", e));
        return next;
      });
      setHoldings(prev => {
        const ex = prev.find(h => h.ticker === ticker);
        const next = ex
          ? prev.map(h => h.ticker === ticker ? { ...h, qty:h.qty+qty, avg:Math.round((h.avg*h.qty+price*qty)/(h.qty+qty)) } : h)
          : [...prev, { ticker, qty, avg:price }];
        if (userId) saveHoldings(userId, next).catch((e) => console.error("[holdings] save:", e));
        return next;
      });
    } else {
      setBalance(prev => {
        const next = prev + total;
        if (userId) saveBalance(userId, next).catch((e) => console.error("[balance] save:", e));
        return next;
      });
      setHoldings(prev => {
        const next = prev.map(h => h.ticker === ticker ? { ...h, qty:Math.max(0, h.qty-qty) } : h).filter(h => h.qty > 0);
        if (userId) saveHoldings(userId, next).catch((e) => console.error("[holdings] save:", e));
        return next;
      });
    }
    sendEmailNotification({ to:displayUser.email, subject:"Operacion ejecutada - " + side + " " + ticker, body:side + " " + qty + " " + ticker + " a $" + fN(price) + ". Total: $" + fN(total) + ". Fecha: " + new Date().toLocaleString("es-AR") + ". Si no reconoces esta operacion, contacta a SAMAS inmediatamente." });
    setPending(null);
    haptic("success");
    showToast(side + " " + qty + " " + ticker + " ejecutada. Email enviado a " + displayUser.email, side === "Compra" ? C.green : C.red);
  };

  const handleSetSL = (ticker, price) => {
    if (price === null) { setStopLosses(prev => { const n={...prev}; delete n[ticker]; return n; }); showToast("Stop Loss eliminado para " + ticker, C.textMd); }
    else {
      setStopLosses(prev => ({...prev,[ticker]:price}));
      showToast("Stop Loss activado: " + ticker + " a $" + fN(price), C.red);
      samasNotify(`Stop Loss activado · ${ticker}`, `Te avisamos si baja de $${fN(price)}.`);
    }
  };
    // Star toggle — operates across lists. If the ticker is in ANY list, we
  // remove it from all. Otherwise we add it to the first (default) list.
  // Users who want per-list control can manage from the Favoritos tab.
  // When to show the picker vs. toggle immediately:
  //   - Zero lists: create default + add (same as before).
  //   - One list: star behaves as a simple toggle — no picker overhead.
  //   - Multiple lists + star currently FILLED: remove from all lists
  //     (the classic "un-star it everywhere" gesture).
  //   - Multiple lists + star currently EMPTY: open the picker so the
  //     user can choose which list to add to.
  const [pickerTicker, setPickerTicker] = useState(null);
  const toggleWatchlist = (ticker) => {
    setWatchlists(prev => {
      if (!prev || !prev.length) {
        haptic("tap"); showToast("Agregado a watchlist:" + ticker, C.gold);
        return [{ id: "default", name: "Mi Watchlist", tickers: [ticker] }];
      }
      const has = prev.some(l => (l.tickers || []).includes(ticker));
      // 1 list — classic toggle.
      if (prev.length === 1) {
        if (has) {
          haptic("tap"); showToast("Removido de watchlist:" + ticker, C.textMd);
          return prev.map(l => ({ ...l, tickers: (l.tickers || []).filter(t => t !== ticker) }));
        }
        haptic("tap"); showToast("Agregado a watchlist:" + ticker, C.gold);
        return prev.map((l, i) => i === 0 ? { ...l, tickers: [...(l.tickers || []), ticker] } : l);
      }
      // Multiple lists + already starred → remove everywhere.
      if (has) {
        haptic("tap"); showToast("Removido de watchlist:" + ticker, C.textMd);
        return prev.map(l => ({ ...l, tickers: (l.tickers || []).filter(t => t !== ticker) }));
      }
      // Multiple lists + not starred → open picker. Schedule the state
      // update outside of this setter so React doesn't complain about
      // side-effects during reducer.
      setTimeout(() => setPickerTicker(ticker), 0);
      return prev;
    });
  };
  // Apply picker selection: replace the ticker's membership across lists
  // to match the given set of list ids.
  const setTickerInLists = (ticker, selectedIds) => {
    setWatchlists(prev => (prev || []).map(l => {
      const should = selectedIds.includes(l.id);
      const has    = (l.tickers || []).includes(ticker);
      if (should && !has) return { ...l, tickers: [...l.tickers, ticker] };
      if (!should && has) return { ...l, tickers: l.tickers.filter(t => t !== ticker) };
      return l;
    }));
    haptic("tap");
    const n = selectedIds.length;
    if (n === 0) showToast("Removido de watchlist:" + ticker, C.textMd);
    else         showToast(`${ticker} guardado en ${n} ${n === 1 ? "lista" : "listas"}`, C.gold);
  };
  // Handlers for managing the list set itself — create, rename, delete.
  const createWatchlist = (name) => {
    const trimmed = (name || "").trim() || "Nueva lista";
    const id = "wl_" + Math.random().toString(36).slice(2, 10);
    setWatchlists(prev => [...(prev || []), { id, name: trimmed, tickers: [] }]);
    haptic("tap");
    showToast("Lista creada: " + trimmed, C.accent);
  };
  const renameWatchlist = (id, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    setWatchlists(prev => (prev || []).map(l => l.id === id ? { ...l, name: trimmed } : l));
  };
  const removeWatchlist = (id) => {
    setWatchlists(prev => {
      if (!prev || prev.length <= 1) return prev;   // always keep at least one
      return prev.filter(l => l.id !== id);
    });
  };
  const addToWatchlist = (listId, ticker) => {
    setWatchlists(prev => (prev || []).map(l => l.id === listId && !l.tickers.includes(ticker)
      ? { ...l, tickers: [...l.tickers, ticker] }
      : l));
  };
  const removeFromWatchlist = (listId, ticker) => {
    setWatchlists(prev => (prev || []).map(l => l.id === listId
      ? { ...l, tickers: (l.tickers || []).filter(t => t !== ticker) }
      : l));
  };
  const handleSetAlert = (ticker, alert) => {
    if (alert === null) { setPriceAlerts(prev => { const n={...prev}; delete n[ticker]; return n; }); showToast("Alerta eliminada para " + ticker, C.textMd); }
    else {
      setPriceAlerts(prev => ({...prev,[ticker]:alert}));
      const dir = alert.direction === "above" ? "sube a" : "baja a";
      showToast("Alerta: " + ticker + " " + dir + " $" + fN(alert.price), C.gold);
      samasNotify(`Alerta programada · ${ticker}`, `Te avisamos cuando ${dir} $${fN(alert.price)}.`);
    }
  };
  // handleLogin / handleSignup are no-ops now — the Supabase auth flow in
  // SupabaseAuthFlow handles signup + login directly with the SDK, and the
  // useSupabaseSession hook updates our session state automatically. We keep
  // stubs here so any stale call sites (e.g. the old LoginScreen renders,
  // now unreachable) don't crash.
  const handleLogin = () => {};
  const handleSignup = () => {};
  // Tutorial kickoff: show it once, after login, for users who haven't seen
  // it yet. Reads from profiles.seen_tutorial so the flag persists across
  // devices and browsers (was previously localStorage, which meant every
  // new login / new device / incognito tab triggered the tutorial again).
  // Wait until sbProfile has loaded before deciding — otherwise we'd flash
  // the tutorial briefly for users who have already seen it.
  useEffect(() => {
    if (!loggedIn) return;
    if (!sbProfile) return; // profile still loading
    if (sbProfile.seen_tutorial) return;
    const id = setTimeout(() => setShowTutorial(true), 400);
    return () => clearTimeout(id);
  }, [loggedIn, sbProfile]);
  // Write a new PIN hash to profiles and refetch. Called from the PIN
  // "create" flow. Throws on network/DB errors so the PinLockScreen can
  // show an inline error and let the user retry.
  const handleSavePin = async (plainPin) => {
    if (!sbSession?.user) throw new Error("No session");
    const hash = await hashPin(plainPin);
    const { error } = await supabase
      .from("profiles")
      .update({ pin_hash: hash, updated_at: new Date().toISOString() })
      .eq("id", sbSession.user.id);
    if (error) throw error;
    await refetchProfile();
  };
  // Change UI mode from Settings. Writes profiles.ui_mode and refetches
  // so the change propagates through the whole app in one render.
  // Clear the stored PIN hash on the user's profile and force the PIN
  // gate back. Useful if the user forgot their PIN (or stored a wrong
  // hash from a previous test session) and trade confirmations stop
  // working. Pin gate is per-tab (pinUnlocked state) so we also flip
  // that to false to immediately show the PinLockScreen in create mode.
  const handleResetPin = async () => {
    if (!sbSession?.user) return;
    try {
      await supabase
        .from("profiles")
        .update({ pin_hash: null, updated_at: new Date().toISOString() })
        .eq("id", sbSession.user.id);
      await refetchProfile();
      setPinUnlocked(false);
      setShowProfile(false);
      showToast("PIN reiniciado. Creá uno nuevo.", C.gold);
    } catch (e) {
      console.error("[reset PIN] failed:", e);
      showToast("No pudimos reiniciar el PIN.", C.red);
    }
  };

  // Wipe all portfolio data for the current user in one shot. Used by
  // the "Reset account" button in Settings. Deletes holdings, orders,
  // the accounts row, watchlists (cascades tickers), plans, and zeroes
  // the JSONB risk rules. Does NOT touch profile basics (email, phone,
  // pin, ui_mode).
  const handleResetAccount = async () => {
    if (!sbSession?.user) return;
    const uid = sbSession.user.id;
    const token = sbSession.access_token;
    if (!token) return;
    // Helper: raw DELETE/PATCH to PostgREST. The SDK builder
    // (`supabase.from(...).delete().eq(...)` / `.update(...)`) hangs
    // intermittently on this build — same root cause as ui_mode +
    // 2FA + profile fetch. Using raw fetch here guarantees the reset
    // actually persists. Without this, portfolio_history would never
    // get nulled in DB and stale data resurfaces on next login.
    const headers = {
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };
    const rawDelete = async (table, col) => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${uid}`,
        { method: "DELETE", headers },
      );
      if (!r.ok && r.status !== 404) {
        const txt = await r.text().catch(() => "");
        console.error(`[reset] DELETE ${table} ${r.status}:`, txt);
      }
    };
    const rawPatchProfile = async (patch) => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}`,
        {
          method: "PATCH", headers,
          body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
        },
      );
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        console.error(`[reset] PATCH profiles ${r.status}:`, txt);
      }
    };
    try {
      await Promise.all([
        rawDelete("holdings", "user_id"),
        rawDelete("orders", "user_id"),
        rawDelete("accounts", "user_id"),
        rawDelete("watchlists", "user_id"),
        rawDelete("plans", "user_id"),
        // Reset risk rules + recurring aporte + portfolio history. We
        // intentionally do NOT reset display preferences (lang, dark,
        // show_usd, view_mode) — those are workspace settings, not
        // account data, and the user expects them to survive a reset.
        rawPatchProfile({
          stop_losses: {},
          price_alerts: {},
          recurring_aporte: null,
          portfolio_history: null,
        }),
      ]);
      // Reset local state to fresh-account defaults.
      setHoldings([]);
      setOrders([]);
      setBalance(0);
      setWatchlists([{ id: "default", name: "Mi Watchlist", tickers: [] }]);
      setSavedPlan(null);
      setStopLosses({});
      setPriceAlerts({});
      setRecurringAporte(null);
      setPortfolioHistory(null);
      showToast("Cuenta reiniciada — sin holdings, sin órdenes, saldo $0.", C.gold);
    } catch (e) {
      console.error("[reset] failed:", e);
      showToast("No pudimos reiniciar la cuenta. Revisá la consola.", C.red);
    }
  };

  // Use raw fetch instead of supabase.from(...).update(...) because the
  // SDK builder occasionally hangs without resolving (observed in
  // production: rapid repeat toggles → many awaits piling up forever,
  // never settle, UI stuck on the previous mode). Raw fetch always
  // resolves so the handler never gets stuck waiting on the SDK.
  const handleChangeUiMode = async (nextMode) => {
    if (nextMode !== "principiante" && nextMode !== "profesional") return;
    const uid = sbSession?.user?.id;
    const token = sbSession?.access_token;
    if (!uid || !token) return;
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({
            ui_mode: nextMode,
            updated_at: new Date().toISOString(),
          }),
        },
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("[ui_mode] update failed:", resp.status, text);
        return;
      }
      await refetchProfile();
    } catch (e) {
      console.error("[ui_mode] handler threw:", e);
    }
  };
  // Logout → Supabase sign-out triggers onAuthStateChange, which clears
  // sbSession and therefore flips `loggedIn` false. We keep the PIN
  // hash so the same user can re-login without setting a new PIN (the
  // PIN is keyed by user id, so other users on this device don't
  // inherit it). Reset local ephemeral state (modals, selected asset,
  // pending trade).
  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch (e) { console.error("[auth] signOut", e); }
    setPinUnlocked(false);
    setShowProfile(false);
    setTab("portfolio");
    setSelected(null);
    setPending(null);
  };
  // Mark the tutorial as seen for this user. Persists to profiles.seen_tutorial
  // via raw fetch (SDK .from().update() hangs occasionally on this build —
  // same workaround as handleChangeUiMode). The popup hides immediately;
  // refetchProfile() syncs sbProfile so future renders / reloads see the
  // flag and don't re-trigger the kickoff effect.
  const finishTutorial = async () => {
    setShowTutorial(false);
    const uid = sbSession?.user?.id;
    const token = sbSession?.access_token;
    if (!uid || !token) return;
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({
            seen_tutorial: true,
            updated_at: new Date().toISOString(),
          }),
        },
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("[seen_tutorial] update failed:", resp.status, text);
        return;
      }
      await refetchProfile();
    } catch (e) {
      console.error("[seen_tutorial] handler threw:", e);
    }
  };

  // Demo deposit — no payment gateway. Adds to balance and shows confirmation.
  const handleDeposit = (amount, method) => {
    setBalance(prev => {
      const next = prev + amount;
      if (userId) saveBalance(userId, next).catch((e) => console.error("[balance] deposit save:", e));
      return next;
    });
    const methodLabel = method === "transfer" ? "transferencia" : method === "mp" ? "MercadoPago" : "crypto";
    haptic("success");
    showToast(`$${fN(amount)} acreditados via ${methodLabel}`, C.green);
  };

  const appState = { isDark, loggedIn, needsAuth, needsMfa, mfaPassed, setMfaPassed, needsPinGate, needsWelcome, uiMode, displayUser, sbSession, sbProfile, refetchProfile, pinUnlocked, setPinUnlocked, showProfile, tab, showUSD, orders, selectedAsset, pendingTrade, toast, holdings, stopLosses, priceAlerts, balance, showTutorial, lang, watchlist, watchlists, finnhubKey, finnhub, emailjsCfg, anthropicKey, anthropicModel, savedPlan, portfolioHistory, recurringAporte, pickerTicker };
  const handlers = { handleLogin, handleSignup, handleDeposit, setShowProfile, setIsDark, setTab, setShowUSD, setLang, setSelected, handleTrade, executeTrade, setPending, handleSetSL, handleSetAlert, handleLogout, handleSavePin, handleChangeUiMode, handleResetAccount, handleResetPin, finishTutorial, setShowTutorial, toggleWatchlist, createWatchlist, renameWatchlist, removeWatchlist, addToWatchlist, removeFromWatchlist, setTickerInLists, setPickerTicker, setFinnhubKey, setEmailjsCfg, setAnthropicKey, setAnthropicModel, setSavedPlan, setRecurringAporte };

  const outerBg = isDark ? "#080808" : "#050505";

  return (
    <div style={{ minHeight:"100vh", background:outerBg, fontFamily:"Sora,sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        /* Hide scrollbars across the whole app. Scroll still works via touch
           and wheel; we just don't render the track or thumb. */
        *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
        *::-webkit-scrollbar-track { background: transparent !important; }
        *::-webkit-scrollbar-thumb { background: transparent !important; }
        * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
        html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }

        /* Interaction polish: every interactive control gets a subtle press
           response, and keyboard focus is always visible. "Active" scale is
           suppressed on :disabled so greyed-out buttons don't flinch. */
        button, [role="button"], a, input, select, textarea {
          transition: transform .1s ease, background-color .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease;
        }
        button:not(:disabled):active, [role="button"]:not([aria-disabled="true"]):active {
          transform: scale(0.975);
        }
        button:focus, input:focus, select:focus, textarea:focus, a:focus {
          outline: none;
        }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible {
          outline: 2px solid #16C784;
          outline-offset: 2px;
        }
        input[type="checkbox"], input[type="radio"] { accent-color: #16C784; }

        /* Fade-in for modal overlays — apply via className="samas-modal". */
        @keyframes samasFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes samasSlideUp { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .samas-fade { animation: samasFadeIn 0.18s ease both; }
        .samas-slide-up { animation: samasSlideUp 0.22s cubic-bezier(0.22, 1, 0.36, 1) both; }

        /* Skeleton pulse used for loading placeholders */
        @keyframes samasShimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
        .samas-skeleton {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%);
          background-size: 200% 100%;
          animation: samasShimmer 1.6s linear infinite;
          border-radius: 6px;
        }
      `}</style>

      {/* Movil/Web preview toggle — only useful while previewing in a
          desktop browser. On native iOS/Android the device IS the
          mobile context, so we hide it entirely. */}
      {!isNativeApp && (
        <div style={{ display:"flex", justifyContent:"center", gap:12, padding:"16px 0 8px", position:"sticky", top:0, zIndex:200, background:outerBg, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
          {[["mobile","Movil"],["web","Web"]].map(([v, l]) => (
            <button key={v} onClick={() => setViewMode(v)} style={{ background: v===viewMode ? "#16C784" : "rgba(255,255,255,0.07)", color: v===viewMode ? "#fff" : "rgba(255,255,255,0.5)", border:"none", borderRadius:10, padding:"6px 20px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>{l}</button>
          ))}
        </div>
      )}

      {showShortcuts && <ShortcutsHelpModal onClose={() => setShowShortcuts(false)} C={C}/>}

      {/* On native, force the mobile shell — desktop layout never makes
          sense inside an iOS app. Also drop the desktop-style outer
          padding so the app fills the device edge-to-edge. */}
      {(isNativeApp || viewMode === "mobile") ? (
        <div style={{ display:"flex", justifyContent:"center", padding: isNativeApp ? 0 : "20px" }}>
          <ErrorBoundary><MobileApp appState={appState} handlers={handlers} C={C}/></ErrorBoundary>
        </div>
      ) : (
        loggedIn ? (
          <ErrorBoundary><WebDashboard appState={appState} handlers={handlers} C={C}/></ErrorBoundary>
        ) : (
          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", minHeight:"calc(100vh - 60px)" }}>
            <div style={{ width:420, height:620, position:"relative", borderRadius:20, overflow:"hidden" }}>
              {needsAuth && <SupabaseAuthFlow C={C} session={sbSession} profile={sbProfile} onVerified={refetchProfile}/>}
              {needsMfa && <MfaChallengeView C={C} onSuccess={() => setMfaPassed(true)} onForgot={handleLogout}/>}
              {needsPinGate && (
                <PinLockScreen
                  C={C}
                  storedPinHash={sbProfile?.pin_hash || null}
                  onSavePin={handleSavePin}
                  userEmail={sbSession?.user?.email}
                  onSuccess={() => setPinUnlocked(true)}
                  onForgot={handleLogout}
                />
              )}
              {needsWelcome && (
                <WelcomeChooser
                  C={C}
                  userId={sbSession?.user?.id}
                  onDone={() => refetchProfile()}
                />
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
