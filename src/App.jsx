import { useState, useEffect, useRef } from "react";

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
  { id:8,  tickers:["TSLA"],        cat:"CEDEAR",    src:"Bloomberg",   time:"Hace 4h",     title:"Tesla recorta precios en Europa y Asia por cuarto mes consecutivo",             body:"La compania enfrenta creciente competencia de BYD en los mercados globales." },
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

const DEMO_USER = { name:"Manuel Goldsztein", email:"manuel@samas.com.ar", initials:"MG", pin:"4821", totpSecret:"COHENABC123" };

// ============================================================
// LANGUAGES / i18n
// ============================================================
const LANGUAGES = [
  { code:"es", label:"Espanol", flag:"ES" },
  { code:"en", label:"English", flag:"EN" },
  { code:"pt", label:"Portugues", flag:"PT" },
];

const TRANSLATIONS = {
  es: {
    portfolio:"Portafolio", mercado:"Mercado", noticias:"Noticias", inversiones:"Inversiones", ordenes:"Ordenes", bonos:"Bonos", reportes:"Reportes",
    search:"Buscar activo...", buy:"Comprar", sell:"Vender", cancel:"Cancelar", confirm:"Confirmar", close:"Cerrar", edit:"Editar", save:"Guardar", activate:"Activar", delete:"Eliminar", back:"Atras", next:"Siguiente", skip:"Saltar", finish:"Terminar",
    total_portfolio:"Cartera Total", invested:"Invertido", gain:"Ganancia", available:"Disponible", distribution:"Distribucion", positions:"Posiciones",
    categories:"Categorias", all:"Todos", stocks:"Acciones",
    profile:"Perfil", dark_mode:"Modo oscuro", light_mode:"Modo claro", dark_mode_sub:"Cambiar a tema oscuro", light_mode_sub:"Cambiar a tema claro", devices:"Dispositivos", devices_sub:"4 sesiones activas", tutorial:"Ver tutorial", tutorial_sub:"Recorrido por la app", twofa:"Autenticacion 2FA", twofa_sub:"Recomendado - Aumenta la seguridad", twofa_active:"Activada - Authenticator App", logout:"Cerrar sesion", active_session:"Sesion activa", language:"Idioma",
    settings:"Configuracion",
    ideas_title:"Investment Ideas", ideas_sub:"Carteras recomendadas por el equipo SAMAS", inv_title:"Inversiones", inv_sub:"Ideas, productos y fondos",
    trend_title:"Tendencias del dia", trend_sub:"Los activos que mas se movieron hoy", trend_gainers:"Mayores subas", trend_losers:"Mayores bajas",
    news_title:"Noticias", news_live:"CNBC en vivo", news_demo:"Datos demo", news_loading:"Cargando...", news_refresh:"Actualizar", news_empty:"No hay noticias para este filtro",
    on_title:"Obligaciones Negociables", on_sub:"Deuda corporativa argentina de alta calidad",
    fondos_title:"Fondos Comunes", fondos_sub:"Fondos de inversion profesional",
    bonos_title:"Bonos Soberanos", bonos_sub:"Deuda publica argentina",
    reports_title:"Reportes de Research", reports_sub:"Analisis e informes exclusivos del equipo SAMAS", featured:"DESTACADO", download_pdf:"Descargar PDF", download:"Descargar", pages:"paginas",
    market_no_results:"Sin resultados",
    order_history:"Historial", no_orders:"Aun no operaste nada", executed:"Ejecutada",
    open_devices:"Dispositivos conectados", remote_logout:"Cerrar todas las demas sesiones", device_active:"ACTIVO", device_active_now:"dispositivo activo ahora mismo",
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
    portfolio:"Portfolio", mercado:"Mercado", noticias:"Noticias", inversiones:"Investimentos", ordenes:"Ordens", bonos:"Titulos", reportes:"Relatorios",
    search:"Buscar ativo...", buy:"Comprar", sell:"Vender", cancel:"Cancelar", confirm:"Confirmar", close:"Fechar", edit:"Editar", save:"Salvar", activate:"Ativar", delete:"Excluir", back:"Voltar", next:"Proximo", skip:"Pular", finish:"Concluir",
    total_portfolio:"Carteira Total", invested:"Investido", gain:"Ganho", available:"Disponivel", distribution:"Distribuicao", positions:"Posicoes",
    categories:"Categorias", all:"Todos", stocks:"Acoes",
    profile:"Perfil", dark_mode:"Modo escuro", light_mode:"Modo claro", dark_mode_sub:"Mudar para tema escuro", light_mode_sub:"Mudar para tema claro", devices:"Dispositivos", devices_sub:"4 sessoes ativas", tutorial:"Ver tutorial", tutorial_sub:"Tour pelo app", twofa:"Autenticacao 2FA", twofa_sub:"Recomendado - Aumenta a seguranca", twofa_active:"Ativado - Authenticator App", logout:"Sair", active_session:"Sessao ativa", language:"Idioma",
    settings:"Configuracoes",
    ideas_title:"Investment Ideas", ideas_sub:"Carteiras recomendadas pela equipe SAMAS", inv_title:"Investimentos", inv_sub:"Ideias, produtos e fundos",
    trend_title:"Tendencias de hoje", trend_sub:"Os ativos que mais se moveram hoje", trend_gainers:"Maiores altas", trend_losers:"Maiores baixas",
    news_title:"Noticias", news_live:"CNBC ao vivo", news_demo:"Dados demo", news_loading:"Carregando...", news_refresh:"Atualizar", news_empty:"Sem noticias para este filtro",
    on_title:"Debentures", on_sub:"Divida corporativa argentina de alta qualidade",
    fondos_title:"Fundos de Investimento", fondos_sub:"Fundos de investimento profissional",
    bonos_title:"Titulos Soberanos", bonos_sub:"Divida publica argentina",
    reports_title:"Relatorios de Pesquisa", reports_sub:"Analises e relatorios exclusivos da equipe SAMAS", featured:"DESTAQUE", download_pdf:"Baixar PDF", download:"Baixar", pages:"paginas",
    market_no_results:"Sem resultados",
    order_history:"Historico", no_orders:"Voce ainda nao operou nada", executed:"Executada",
    open_devices:"Dispositivos conectados", remote_logout:"Encerrar todas as outras sessoes", device_active:"ATIVO", device_active_now:"dispositivo ativo agora mesmo",
  },
};

function useT(lang) {
  return (key) => (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.es[key] || key;
}


// ============================================================
// UTILS
// ============================================================
const fN   = n => new Intl.NumberFormat("es-AR", { maximumFractionDigits:0 }).format(n);
const fARS = n => n >= 1e6 ? "$" + (n/1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n/1e3).toFixed(1) + "k" : "$" + n;

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

  // Generate realistic price series based on asset data
  const generateSeries = (p) => {
    const counts = { "1d":78, "5d":130, "1mo":22, "3mo":66, "6mo":130, "1y":252, "2y":504 };
    const n = counts[p] || 22;
    const base = asset.price;
    const vol = base * (p === "1d" ? 0.003 : p === "5d" ? 0.008 : p === "1mo" ? 0.04 : p === "3mo" ? 0.08 : p === "6mo" ? 0.14 : 0.25);
    const trend = asset.chgYTD / 100 / (p === "1d" ? 252 : p === "5d" ? 52 : p === "1mo" ? 12 : p === "3mo" ? 4 : p === "6mo" ? 2 : 1) * n;
    // deterministic seed from ticker
    const seed = asset.ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const rng = (i) => { const x = Math.sin(seed + i * 127.1) * 43758.5453; return x - Math.floor(x); };
    let v = base / (1 + trend / n * n * 0.5);
    return Array.from({ length: n }, (_, i) => {
      v = v * (1 + (rng(i) - 0.48) * (vol / base) + trend / n / n);
      return Math.max(v, base * 0.3);
    });
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
function sendEmailNotification({ to, subject, body }) {
  console.log("EMAIL to " + to + " | Subject: " + subject + " | Body: " + body);
  fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      service_id:  "samas_service",
      template_id: "samas_trade",
      user_id:     "public_key_placeholder",
      template_params: { to_email:to, subject, message: body }
    })
  }).catch(() => {});
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
                <div style={{ fontSize:9, color:C.textLt, fontWeight:600, marginBottom:3 }}>USD {fx.label}</div>
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
  const pctVal = price && parseInt(price) > 0 ? (((parseInt(price) - asset.price) / asset.price) * 100).toFixed(1) : null;
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
          <input type="number" value={price} onChange={e => setPrice(e.target.value)}
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
function ConfirmTradeModal({ trade, onConfirm, onCancel, C }) {
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
          to: DEMO_USER.email,
          subject: "Operacion ejecutada: " + trade.side + " " + trade.ticker,
          body: trade.side + " " + trade.qty + " " + trade.ticker + " a $" + fN(trade.price) + ". Total: $" + fN(total) + ". Fecha: " + new Date().toLocaleString("es-AR") + ". Si no reconoces esta operacion contacta a SAMAS inmediatamente."
        });
        onConfirm();
      }, 700);
    }, 1800);
  };

  const doPin = () => {
    if (pin === DEMO_USER.pin) {
      sendEmailNotification({
        to: DEMO_USER.email,
        subject: "Operacion ejecutada: " + trade.side + " " + trade.ticker,
        body: trade.side + " " + trade.qty + " " + trade.ticker + " a $" + fN(trade.price) + ". Total: $" + fN(total) + ". Fecha: " + new Date().toLocaleString("es-AR") + ". Si no reconoces esta operacion contacta a SAMAS inmediatamente."
      });
      onConfirm();
    } else {
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
            Confirmacion por email a {DEMO_USER.email}
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
            <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:12, textAlign:"center" }}>ELIGE COMO VERIFICAR ESTA OPERACION</div>
            <div style={{ display:"flex", gap:10, marginBottom:16 }}>
              <button onClick={() => setStep("faceid")} style={{ flex:1, background:C.isDark?"#1A0A18":"#FFF0F8", border:"2px solid #0D1117", borderRadius:14, padding:"16px 10px", cursor:"pointer", fontFamily:"inherit", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                <svg width="28" height="28" viewBox="0 0 80 80" fill="none">
                  <ellipse cx="40" cy="36" rx="24" ry="28" stroke="#0D1117" strokeWidth="3"/>
                  <ellipse cx="31" cy="30" rx="3.5" ry="4.5" stroke="#0D1117" strokeWidth="2.5"/>
                  <ellipse cx="49" cy="30" rx="3.5" ry="4.5" stroke="#0D1117" strokeWidth="2.5"/>
                  <path d="M32 50 Q40 55 48 50" stroke="#0D1117" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
                  <path d="M8 18 L8 8 L18 8" stroke="#0D1117" strokeWidth="2.5" strokeLinecap="round"/>
                  <path d="M62 8 L72 8 L72 18" stroke="#0D1117" strokeWidth="2.5" strokeLinecap="round"/>
                  <path d="M8 55 L8 65 L18 65" stroke="#0D1117" strokeWidth="2.5" strokeLinecap="round"/>
                  <path d="M62 65 L72 65 L72 55" stroke="#0D1117" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Face ID</div>
                <div style={{ fontSize:10, color:C.textLt }}>Rapido y seguro</div>
              </button>
              <button onClick={() => setStep("pin")} style={{ flex:1, background:C.isDark?"#0A1A0A":"#F0FFF4", border:"2px solid "+C.green, borderRadius:14, padding:"16px 10px", cursor:"pointer", fontFamily:"inherit", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>PIN</div>
                <div style={{ fontSize:10, color:C.textLt }}>Codigo de 4 digitos</div>
              </button>
            </div>
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
                  if (next.length === 4) setTimeout(() => {
                    if (next === DEMO_USER.pin) {
                      sendEmailNotification({ to:DEMO_USER.email, subject:"Operacion ejecutada: "+trade.side+" "+trade.ticker, body:trade.side+" "+trade.qty+" "+trade.ticker+" a $"+fN(trade.price)+". Total: $"+fN(total)+". Fecha: "+new Date().toLocaleString("es-AR")+"." });
                      onConfirm();
                    } else { setPinErr(true); setPin(""); setTimeout(() => setPinErr(false), 1400); }
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
function AssetDetail({ asset, holding, stopLoss, priceAlert, balance, isInWatchlist, onToggleWatchlist, onClose, onTrade, onSetStopLoss, onSetAlert, C }) {
  const [mode, setMode]           = useState(null);
  const [qty, setQty]             = useState("");
  const [done, setDone]           = useState(false);
  const [showSL, setShowSL]       = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const up        = asset.change >= 0;
  const color     = up ? C.green : C.red;
  const qtyNum    = parseInt(qty) || 0;
  const maxSell   = holding ? holding.qty : 0;
  const totalCost = qtyNum * asset.price;
  const maxBuy    = Math.floor(balance / asset.price);
  const sellErr   = mode === "sell" && qtyNum > maxSell && qtyNum > 0 ? "Solo tienes " + maxSell + " unidades" : null;
  const buyErr    = mode === "buy"  && qtyNum > 0 && totalCost > balance ? "Saldo insuficiente. Max: " + maxBuy + " u" : null;
  const canGo     = qtyNum > 0 && !sellErr && !buyErr;

  const doConfirm = () => {
    if (!canGo) return;
    onTrade({ ticker:asset.ticker, side: mode === "buy" ? "Compra" : "Venta", qty:qtyNum, price:asset.price });
    setDone(true);
    setTimeout(() => { setDone(false); setMode(null); setQty(""); onClose(); }, 1200);
  };

  return (
    <div style={{ position:"absolute", inset:0, zIndex:40, display:"flex", flexDirection:"column" }}>
      {showSL && <StopLossModal asset={asset} current={stopLoss} onSave={v => { onSetStopLoss(asset.ticker, v); setShowSL(false); }} onClose={() => setShowSL(false)} C={C}/>}
      {showAlert && <PriceAlertModal asset={asset} current={priceAlert} onSave={v => { onSetAlert(asset.ticker, v); setShowAlert(false); }} onClose={() => setShowAlert(false)} C={C}/>}
      <div onClick={onClose} style={{ flex:"0 0 55px", background:"rgba(0,0,0,0.5)" }}/>
      <div style={{ flex:1, background:C.bg, borderRadius:"20px 20px 0 0", overflow:"hidden", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 0" }}><div style={{ width:36, height:4, borderRadius:2, background:C.border }}/></div>
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
              <button onClick={() => onToggleWatchlist(asset.ticker)} title={isInWatchlist ? "Quitar de favoritos" : "Agregar a favoritos"}
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
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0"
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
              <button onClick={() => setSelected(null)} style={{ background:"transparent", border:"none", fontSize:20, color:C.textLt, cursor:"pointer" }}>x</button>
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
              <button onClick={() => setSelected(null)} style={{ background:"transparent", border:"none", fontSize:20, color:C.textLt, cursor:"pointer" }}>x</button>
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
              <button onClick={() => setSelected(null)} style={{ background:"transparent", border:"none", fontSize:20, color:C.textLt, cursor:"pointer" }}>x</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
              {[
                ["Precio", selected.currency==="USD" ? "u$s"+selected.price : "$"+fN(Math.round(selected.price*(showUSD?1:1247.5)))],
                ["TIR", selected.ytm ? selected.ytm+"%" : "N/A"],
                ["Duration", selected.duration+" anos"],
                ["Vencimiento", selected.maturity.slice(0,7)],
                ["Rating", selected.rating],
                ["Paridad", selected.paridad ? selected.paridad+"%" : "N/A"],
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
                <div style={{ fontSize:15, fontWeight:800, color:C.text, fontFamily:"monospace" }}>{b.currency==="USD" ? "u$s"+b.price : "$"+fN(Math.round(b.price*1247.5))}</div>
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
  { id:7, cat:"Estrategia",  date:"Ene 2025", title:"Informe anual 2024 y outlook 2025", summary:"Resumen del anio 2024 y proyecciones estrategicas para el 2025. El informe mas completo del equipo.", pages:48, download:"samas_anual_2024.pdf", highlight:false },
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

function PagePortfolio({ holdings, stopLosses, balance, watchlist, onToggleWatchlist, onSelectAsset, C, showUSD, lang }) {
  const t = useT(lang);
  const enriched = holdings.map(h => {
    const a = ASSETS.find(x => x.ticker === h.ticker);
    if (!a) return null;
    const val = h.qty * a.price, cost = h.qty * h.avg;
    return { ...h, a, val, cost, gAbs:val-cost, gPct:((a.price-h.avg)/h.avg)*100 };
  }).filter(Boolean);
  const tv = enriched.reduce((s, h) => s + h.val, 0);
  const tc = enriched.reduce((s, h) => s + h.cost, 0);
  const gA = tv - tc;
  const pal = [C.accent,"#7C3AED",C.green,C.gold,"#2563EB","#F7931A"];
  return (
    <div style={{ paddingBottom:16 }}>
      <div style={{ background:C.isDark ? "linear-gradient(150deg,#0D1117 0%,#1F1F1F 100%)" : "linear-gradient(150deg,#0D1117 0%,#1F1F1F 100%)", margin:"14px 14px 0", borderRadius:20, padding:"20px 18px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", right:-20, top:-20, width:120, height:120, borderRadius:"50%", background:C.accent, opacity:0.08 }}/>
        <div style={{ color:C.goldLt, fontSize:9, fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>{t("total_portfolio")}</div>
        <div style={{ color:"#fff", fontSize:30, fontWeight:700, letterSpacing:-1, marginBottom:6 }}>{showUSD ? "u$s" + fN(Math.round(tv/1247.5)) : "$" + fN(tv)}</div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          <div><div style={{ color:"rgba(255,255,255,0.5)", fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>{t("invested")}</div><div style={{ color:"#fff", fontWeight:600, fontSize:13, fontFamily:"monospace" }}>{showUSD ? "u$s" + fN(Math.round(tc/1247.5)) : "$" + fN(tc)}</div></div>
          <div><div style={{ color:"rgba(255,255,255,0.5)", fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>{t("gain")}</div><div style={{ color: gA >= 0 ? C.green : C.red, fontWeight:700, fontSize:14 }}>{gA >= 0 ? "+" : "-"}{showUSD ? "u$s" + fN(Math.round(Math.abs(gA)/1247.5)) : "$" + fN(Math.abs(gA))} ({gA >= 0 ? "+" : ""}{((gA/tc)*100).toFixed(1)}%)</div></div>
          <div><div style={{ color:"rgba(255,255,255,0.5)", fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>{t("available")}</div><div style={{ color: balance > 0 ? "#4ADE80" : "#F87171", fontWeight:700, fontSize:14, fontFamily:"monospace" }}>{showUSD ? "u$s" + fN(Math.round(balance/1247.5)) : "$" + fN(balance)}</div></div>
        </div>
        <div style={{ marginTop:10, display:"flex", gap:8 }}>
          {FX.map(fx => <div key={fx.label} style={{ background:"rgba(255,255,255,0.1)", borderRadius:8, padding:"4px 10px" }}><div style={{ color:"rgba(255,255,255,0.5)", fontSize:8, fontWeight:700 }}>USD {fx.label}</div><div style={{ color:"#fff", fontSize:12, fontFamily:"monospace", fontWeight:700 }}>u$s{fN(Math.round(tv/fx.value))}</div></div>)}
        </div>
      </div>
      <div style={{ margin:"12px 14px 0", background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"12px 14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.textMd, marginBottom:8 }}>{t("distribution")}</div>
        <div style={{ display:"flex", height:10, borderRadius:5, overflow:"hidden", gap:2 }}>{enriched.map((h, i) => <div key={h.ticker} style={{ width:((h.val/tv)*100).toFixed(1)+"%", background:pal[i%pal.length], borderRadius:2 }}/>)}</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 14px", marginTop:8 }}>{enriched.map((h, i) => <div key={h.ticker} style={{ display:"flex", alignItems:"center", gap:4 }}><div style={{ width:8, height:8, borderRadius:2, background:pal[i%pal.length] }}/><span style={{ fontSize:10, color:C.textMd }}>{h.ticker} {((h.val/tv)*100).toFixed(0)}%</span></div>)}</div>
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

      {/* WATCHLIST */}
      <div style={{ padding:"16px 14px 0" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill={C.gold} stroke={C.gold} strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <div style={{ fontSize:11, fontWeight:700, color:C.textMd }}>Mis Favoritos</div>
          </div>
          <div style={{ fontSize:10, color:C.textLt }}>{(watchlist||[]).length} activos</div>
        </div>
        {(!watchlist || watchlist.length === 0) ? (
          <div style={{ background:C.card, borderRadius:14, border:"1.5px dashed "+C.border, padding:"20px 16px", textAlign:"center" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:6 }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <div style={{ fontSize:12, fontWeight:600, color:C.text, marginBottom:3 }}>Aun no tenes favoritos</div>
            <div style={{ fontSize:10, color:C.textLt, lineHeight:1.5 }}>Toca la estrella en cualquier activo para seguirlo desde aca</div>
          </div>
        ) : (
          <div style={{ background:C.card, borderRadius:14, border:"1px solid "+C.border, overflow:"hidden" }}>
            {watchlist.map((tick, idx) => {
              const a = ASSETS.find(x => x.ticker === tick);
              if (!a) return null;
              return (
                <div key={tick} onClick={() => onSelectAsset(a)} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", borderBottom: idx < watchlist.length-1 ? "1px solid "+C.border+"44" : "none", cursor:"pointer" }}>
                  <AssetLogo asset={a} size={30} C={C}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <div style={{ fontWeight:700, fontSize:13, color:C.text }}>{a.ticker}</div>
                      <div style={{ fontSize:8, fontWeight:700, color:C.textLt, background:C.creamDk, borderRadius:3, padding:"1px 4px" }}>{a.cat}</div>
                    </div>
                    <div style={{ fontSize:10, color:C.textLt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</div>
                  </div>
                  <Spark up={a.up} color={a.up?C.green:C.red} w={36} h={18}/>
                  <div style={{ textAlign:"right", minWidth:62 }}>
                    <div style={{ fontSize:12, fontWeight:700, fontFamily:"monospace", color:C.text }}>{showUSD ? "u$s"+(a.price/1247.5).toFixed(2) : "$"+fN(a.price)}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:a.up?C.green:C.red }}>{a.up?"+":"-"}{Math.abs(a.change).toFixed(2)}%</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); onToggleWatchlist(tick); }} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4 }} title="Quitar de favoritos">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={C.gold} stroke={C.gold} strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
    price:     b.currency === "USD" ? Math.round(b.price * 1247.5) : Math.round(b.price * 1247.5),
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
function PageNoticias({ holdings, onSelectAsset, C, lang }) {
  const t = useT(lang);
  const [filter, setFilter] = useState("Portafolio");
  const [news, setNews]     = useState(NEWS);
  const [status, setStatus] = useState("idle");
  const portT = holdings.map(h => h.ticker);
  const fetchN = () => {
    setStatus("loading");
    fetch("http://localhost:5001/api/news/all", { signal: AbortSignal.timeout(6000) })
      .then(r => r.json()).then(d => {
        const items = (d.items||[]).map((it,i) => { const title = it.headline||it.title||""; const tickers = ASSETS.filter(a=>title.toLowerCase().includes(a.ticker.toLowerCase())).map(a=>a.ticker); return { id:i, tickers, cat:"Mercado", src:"CNBC", time:"Reciente", title, body:it.description||it.summary||"", url:it.url||"#" }; }).filter(x=>x.title);
        setNews(items.length > 0 ? items : NEWS); setStatus("ok");
      }).catch(() => { setNews(NEWS); setStatus("error"); });
  };
  const shown = filter === "Portafolio" ? news.filter(n => n.tickers.some(t => portT.includes(t))) : filter === "Todos" ? news : news.filter(n => n.cat === filter);
  return (
    <div style={{ padding:"14px 14px 20px" }}>
      <div style={{ marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div><div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:2 }}>{t("news_title")}</div><div style={{ fontSize:10, color: status==="ok" ? C.green : status==="error" ? C.red : C.textLt }}>{status==="loading" ? "Cargando..." : status==="ok" ? "CNBC en vivo" : status==="error" ? "Datos demo" : ""}</div></div>
        <button onClick={fetchN} style={{ background:C.creamDk, border:"1px solid "+C.border, borderRadius:8, padding:"5px 10px", fontSize:11, cursor:"pointer", color:C.textMd, fontFamily:"inherit" }}>Refresh</button>
      </div>
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:10, marginBottom:4 }}>
        {["Portafolio","Todos","Acciones","CEDEAR","ETF","Commodity","Crypto"].map(f => <button key={f} onClick={() => setFilter(f)} style={{ background: f===filter ? C.accent : C.card, color: f===filter ? "#fff" : C.textMd, border:"1.5px solid "+(f===filter?C.accent:C.border), borderRadius:20, padding:"5px 13px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}>{f==="Portafolio" ? "* Portafolio" : f}</button>)}
      </div>
      {shown.length === 0 && <div style={{ textAlign:"center", padding:"40px 0", color:C.textLt }}>No hay noticias para este filtro</div>}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {shown.slice(0,30).map((n, idx) => {
          const related = ASSETS.filter(a => n.tickers.includes(a.ticker));
          const inPort  = n.tickers.some(t => portT.includes(t));
          return (
            <div key={n.id !== undefined ? n.id : idx} style={{ background:C.card, borderRadius:14, border:"1px solid "+(inPort?C.gold+"55":C.border), padding:"13px 14px", position:"relative", overflow:"hidden" }}>
              {inPort && <div style={{ position:"absolute", top:0, left:0, bottom:0, width:3, background:C.gold, borderRadius:"14px 0 0 14px" }}/>}
              <div style={{ paddingLeft: inPort ? 6 : 0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7, flexWrap:"wrap" }}>
                  <span style={{ background:C.accent+"22", color:C.accent, fontSize:9, fontWeight:700, borderRadius:5, padding:"2px 7px" }}>{n.cat}</span>
                  {n.tickers.map(t => <span key={t} style={{ background:portT.includes(t)?C.gold+"22":C.creamDk, color:portT.includes(t)?C.gold:C.textLt, fontSize:9, fontWeight:700, borderRadius:5, padding:"2px 7px", fontFamily:"monospace" }}>{t}</span>)}
                  <span style={{ marginLeft:"auto", fontSize:10, color:C.textLt }}>{n.src} - {n.time}</span>
                </div>
                <div style={{ fontWeight:700, fontSize:13, color:C.text, lineHeight:1.4, marginBottom:5 }}>{n.title}</div>
                {n.body && <div style={{ fontSize:11, color:C.textMd, lineHeight:1.6, marginBottom:related.length>0?10:0 }}>{n.body.slice(0,180)}{n.body.length>180?"...":""}</div>}
                {related.length > 0 && <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>{related.map(a => <button key={a.ticker} onClick={() => onSelectAsset(a)} style={{ background:C.bg, border:"1px solid "+C.border, borderRadius:9, padding:"5px 10px", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6 }}><span style={{ fontWeight:700, fontSize:11, color:C.text }}>{a.ticker}</span><span style={{ fontSize:11, fontWeight:700, color:a.up?C.green:C.red }}>{a.up?"+":"-"}{Math.abs(a.change).toFixed(1)}%</span></button>)}</div>}
              </div>
            </div>
          );
        })}
      </div>
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
        {[["30d","+3.2%",C.green],["90d","+11.8%",C.green],["1 anio","+41.7%",C.gold]].map(([l,v,col]) => (
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
  const h = size * 1.2;
  // Each half is a horizontal bar → 180° end-cap → shorter return bar (horseshoe-on-its-side).
  // Top tail extends right, bottom tail extends left — the asymmetry creates the S diagonal.
  return (
    <svg width={w} height={h} viewBox="0 0 100 120" fill="none" aria-label="SAMAS">
      {/* Upper stroke — long top tail, 180° curve on the left, short middle return */}
      <path
        d="M 75 17 L 28 17 A 16 16 0 0 0 28 49 L 60 49"
        stroke={markColor}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Lower stroke — short middle start, 180° curve on the right, long bottom tail */}
      <path
        d="M 40 65 L 72 65 A 16 16 0 0 1 72 97 L 25 97"
        stroke={markColor}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Green accent dot — dead center, overlapping both halves in the S waist */}
      <circle cx="50" cy="57" r="9" fill={dotColor} />
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
function OnboardingTutorial({ onClose, onComplete, setTab, setShowUSD, setShowProfile, currentTab, C }) {
  const [step, setStep] = useState(0);

  // Each step points to a specific UI element in the mobile phone frame (375x760)
  // target: the bounding box (top, left, width, height) of the element being highlighted
  // tooltipPos: where to place the tooltip relative to phone (top|bottom)
  const steps = [
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

  // When step changes, navigate to the corresponding tab automatically
  useEffect(() => {
    if (steps[step].tabTo && setTab) {
      setTab(steps[step].tabTo);
    }
  }, [step]);

  const s = steps[step];
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
    <div style={{ position:"absolute", inset:0, zIndex:150, pointerEvents:"none" }}>
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

function LoginScreen({ onLogin, C }) {
  const [phase, setPhase]     = useState("idle");
  const [pin, setPin]         = useState("");
  const [pinErr, setPinErr]   = useState(false);
  const [showPin, setShowPin] = useState(false);
  const doFaceID = () => { setPhase("scanning"); setTimeout(() => { setPhase("success"); setTimeout(onLogin, 800); }, 1800); };
  const doPin = () => { if (pin === DEMO_USER.pin) { setPhase("success"); setTimeout(onLogin, 600); } else { setPinErr(true); setPin(""); setTimeout(() => setPinErr(false), 1400); } };
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
      {!showPin ? (
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
        {!showPin && phase==="idle" && <button onClick={() => setShowPin(true)} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>Usar PIN</button>}
        {showPin && <button onClick={() => { setShowPin(false); setPin(""); }} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>Usar Face ID</button>}
        <div style={{ color:"rgba(255,255,255,0.15)", fontSize:10, letterSpacing:1 }}>samas.com.ar v2.5.0</div>
      </div>
    </div>
  );
}

// ============================================================
// PROFILE SHEET
// ============================================================
// ============================================================
// DEVICES PAGE (profile sub-page)
// ============================================================
function DevicesPage({ onBack, C }) {
  const DEVICES = [
    { id:1, name:"iPhone 15 Pro",         type:"mobile",  browser:"Safari 17",    ip:"186.12.XX.XX", location:"Buenos Aires, AR", lastSeen:"Ahora mismo",    current:true  },
    { id:2, name:"MacBook Pro 14in",       type:"desktop", browser:"Chrome 122",   ip:"186.12.XX.XX", location:"Buenos Aires, AR", lastSeen:"Hace 2 horas",   current:false },
    { id:3, name:"iPad Air",              type:"tablet",  browser:"Safari 16",    ip:"200.55.XX.XX", location:"Montevideo, UY",   lastSeen:"Hace 3 dias",    current:false },
    { id:4, name:"Chrome - Windows 11",   type:"desktop", browser:"Chrome 121",   ip:"181.30.XX.XX", location:"Buenos Aires, AR", lastSeen:"Hace 1 semana",  current:false },
  ];
  const [removingId, setRemovingId] = useState(null);

  const DeviceIcon = ({ type, current }) => {
    const col = current ? C.green : C.textMd;
    const s = { width:20, height:20, viewBox:"0 0 24 24", fill:"none", stroke:col, strokeWidth:2, strokeLinecap:"round", strokeLinejoin:"round" };
    if (type === "mobile")  return <svg {...s}><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1"/></svg>;
    if (type === "tablet")  return <svg {...s}><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>;
    return <svg {...s}><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/></svg>;
  };

  return (
    <div style={{ padding:"0 18px 28px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.textMd }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ fontSize:16, fontWeight:800, color:C.text }}>Dispositivos conectados</div>
      </div>
      <div style={{ background:C.green+"18", border:"1px solid "+C.green+"44", borderRadius:12, padding:"10px 13px", marginBottom:16, fontSize:11, color:C.green, display:"flex", alignItems:"center", gap:8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="6 12 10 16 18 8"/></svg>
        {DEVICES.filter(d => d.current).length} dispositivo activo ahora mismo
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {DEVICES.map(d => (
          <div key={d.id} style={{ background:C.card, borderRadius:14, border:"1px solid "+(d.current?C.green+"44":C.border), padding:"13px 14px" }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
              <div style={{ width:40, height:40, borderRadius:10, background:d.current?C.green+"18":C.creamDk, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <DeviceIcon type={d.type} current={d.current}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{d.name}</span>
                  {d.current && <span style={{ background:C.green+"22", color:C.green, fontSize:9, fontWeight:700, borderRadius:5, padding:"2px 7px" }}>ACTIVO</span>}
                </div>
                <div style={{ fontSize:10, color:C.textMd, marginBottom:2 }}>{d.browser}</div>
                <div style={{ fontSize:10, color:C.textLt }}>{d.location} - {d.ip}</div>
                <div style={{ fontSize:10, color:d.current?C.green:C.textLt, fontWeight: d.current?700:400, marginTop:3 }}>{d.lastSeen}</div>
              </div>
              {!d.current && (
                <button onClick={() => setRemovingId(d.id === removingId ? null : d.id)}
                  style={{ background:"transparent", border:"1px solid "+C.border, borderRadius:8, padding:"5px 10px", fontSize:10, color:C.red, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
                  Cerrar
                </button>
              )}
            </div>
            {removingId === d.id && (
              <div style={{ marginTop:10, background:C.red+"18", borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:11, color:C.text, marginBottom:8 }}>Cerrar sesion en {d.name}?</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setRemovingId(null)} style={{ flex:1, background:C.creamDk, border:"none", borderRadius:8, padding:"8px", fontSize:11, cursor:"pointer", color:C.textMd, fontFamily:"inherit" }}>Cancelar</button>
                  <button onClick={() => setRemovingId(null)} style={{ flex:1, background:C.red, border:"none", borderRadius:8, padding:"8px", fontSize:11, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Cerrar sesion</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <button style={{ width:"100%", marginTop:16, background:C.red+"18", border:"1.5px solid "+C.red+"33", borderRadius:12, padding:"12px", fontSize:13, fontWeight:700, color:C.red, cursor:"pointer", fontFamily:"inherit" }}>
        Cerrar todas las demas sesiones
      </button>
    </div>
  );
}

function ProfileSheet({ onClose, onLogout, onToggleDark, isDark, lang, setLang, C }) {
  const [confirm, setConfirm]       = useState(false);
  const [show2FA, setShow2FA]       = useState(false);
  const [twoFAEnabled, set2FA]      = useState(false);
  const [totpCode, setTotpCode]     = useState("");
  const [totpVerified, setTotpVerified] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [showLang, setShowLang]     = useState(false);
  const t = useT(lang);

  if (showDevices) {
    return (
      <div style={{ position:"absolute", inset:0, zIndex:40, display:"flex", flexDirection:"column", background:"rgba(0,0,0,0.55)" }}>
        <div onClick={onClose} style={{ flex:1 }}/>
        <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", maxHeight:"90vh", overflowY:"auto" }}>
          <div style={{ display:"flex", justifyContent:"center", padding:"14px 0 6px" }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>
          <DevicesPage onBack={() => setShowDevices(false)} C={C}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:"absolute", inset:0, zIndex:40, display:"flex", flexDirection:"column", background:"rgba(0,0,0,0.55)" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"20px 20px 0 0", padding:"20px 18px 28px", maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}><div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/></div>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20, padding:"14px 16px", background:C.card, borderRadius:16, border:"1px solid "+C.border }}>
          <div style={{ width:50, height:50, borderRadius:14, background:C.isDark?"#1F1F1F":"linear-gradient(135deg,#0D1117,#1F1F1F)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:800, color:C.goldLt, flexShrink:0 }}>{DEMO_USER.initials}</div>
          <div><div style={{ fontWeight:800, fontSize:16, color:C.text }}>{DEMO_USER.name}</div><div style={{ fontSize:12, color:C.textMd, marginTop:1 }}>{DEMO_USER.email}</div><div style={{ display:"flex", alignItems:"center", gap:4, marginTop:4 }}><div style={{ width:6, height:6, borderRadius:3, background:C.green }}/><span style={{ fontSize:10, color:C.green, fontWeight:600 }}>{t("active_session")}</span></div></div>
        </div>

        <button onClick={onToggleDark} style={{ width:"100%", background:isDark?"#2A1A2A":"#F5E8F5", border:"1.5px solid #0D111744", borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"#0D111722", display:"flex", alignItems:"center", justifyContent:"center" }}>{isDark ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D1117" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D1117" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}</div>
            <div><div style={{ fontSize:13, fontWeight:600, color:C.text }}>{isDark ? t("light_mode") : t("dark_mode")}</div><div style={{ fontSize:11, color:C.textLt }}>{isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}</div></div>
          </div>
          <div style={{ width:40, height:22, borderRadius:11, background:isDark?C.accent:C.creamDk, border:"1.5px solid "+C.border, position:"relative" }}><div style={{ position:"absolute", top:2, left:isDark?18:2, width:14, height:14, borderRadius:"50%", background:isDark?"#fff":C.textLt, transition:"left 0.2s" }}/></div>
        </button>

        <button onClick={() => setShowDevices(true)} style={{ width:"100%", background:C.creamDk, border:"1.5px solid "+C.border, borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:C.accent+"22", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><polyline points="16 3 12 7 8 3"/></svg></div>
            <div><div style={{ fontSize:13, fontWeight:600, color:C.text }}>{t("devices")}</div><div style={{ fontSize:11, color:C.textLt }}>4 sesiones activas</div></div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textLt} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        <button onClick={() => setShowLang(v => !v)} style={{ width:"100%", background:showLang?C.accent+"18":C.creamDk, border:"1.5px solid "+(showLang?C.accent+"44":C.border), borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"#2563EB22", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
            <div><div style={{ fontSize:13, fontWeight:600, color:C.text }}>{t("language")}</div><div style={{ fontSize:11, color:C.textLt }}>{LANGUAGES.find(l => l.code === lang)?.label || "Espanol"}</div></div>
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

        <button onClick={() => setShow2FA(v => !v)} style={{ width:"100%", background: twoFAEnabled ? C.green+"18" : C.creamDk, border:"1.5px solid "+(twoFAEnabled?C.green+"44":C.border), borderRadius:14, padding:"13px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", fontFamily:"inherit", marginBottom:8, textAlign:"left" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:(twoFAEnabled?C.green:C.accent)+"22", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={twoFAEnabled?C.green:C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
            <div><div style={{ fontSize:13, fontWeight:600, color:C.text }}>{t("twofa")}</div><div style={{ fontSize:11, color: twoFAEnabled ? C.green : C.textLt }}>{twoFAEnabled ? "Activada - Authenticator App" : "Recomendado - Aumenta la seguridad"}</div></div>
          </div>
          <div style={{ width:40, height:22, borderRadius:11, background:twoFAEnabled?C.green:C.creamDk, border:"1.5px solid "+C.border, position:"relative" }}><div style={{ position:"absolute", top:2, left:twoFAEnabled?18:2, width:14, height:14, borderRadius:"50%", background:twoFAEnabled?"#fff":C.textLt, transition:"left 0.2s" }}/></div>
        </button>

        {show2FA && (
          <div style={{ background:C.card, borderRadius:12, border:"1px solid "+C.border, padding:"14px", marginBottom:8 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:8 }}>Configurar Authenticator App</div>
            <div style={{ background:C.creamDk, borderRadius:10, padding:"12px", marginBottom:10, textAlign:"center" }}>
              <div style={{ fontSize:10, color:C.textMd, marginBottom:6 }}>Escanea con Google Authenticator / Authy</div>
              <div style={{ background:"#fff", borderRadius:8, padding:8, display:"inline-block" }}>
                <svg width="80" height="80" viewBox="0 0 10 10" fill="none">
                  {[[0,0],[0,1],[0,2],[1,0],[2,0],[2,1],[2,2],[0,4],[1,4],[2,4],[0,5],[0,6],[1,6],[2,6],[4,0],[5,0],[6,0],[4,1],[6,1],[4,2],[5,2],[6,2],[4,4],[5,4],[6,4],[4,5],[5,5],[4,6],[5,6],[6,6],[3,3],[7,3],[3,7],[7,7],[8,0],[9,0],[8,1],[9,2],[8,3],[9,3],[8,4],[9,5],[8,6],[9,6]].map(([x,y],i) => <rect key={i} x={x} y={y} width="1" height="1" fill="#000"/>)}
                </svg>
              </div>
              <div style={{ fontSize:9, color:C.textLt, marginTop:6, fontFamily:"monospace" }}>COHEN-ABCDEF123456</div>
            </div>
            <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:6 }}>CONFIRMA CON TU APP (demo: 4821)</div>
            <input value={totpCode} onChange={e => setTotpCode(e.target.value.slice(0,6))} placeholder="000000" maxLength={6}
              style={{ background:C.bg, border:"1.5px solid "+(totpVerified?C.green:C.border), borderRadius:10, padding:"10px", fontSize:18, fontFamily:"monospace", fontWeight:700, color:C.text, outline:"none", width:"100%", boxSizing:"border-box", textAlign:"center", letterSpacing:8, marginBottom:8 }}/>
            <button onClick={() => { if (totpCode === DEMO_USER.pin || totpCode === "123456") { set2FA(true); setTotpVerified(true); setShow2FA(false); } }}
              style={{ width:"100%", background: totpCode.length >= 4 ? C.green : C.creamDk, color: totpCode.length >= 4 ? "#fff" : C.textLt, border:"none", borderRadius:10, padding:"11px", fontWeight:700, fontSize:13, cursor: totpCode.length >= 4 ? "pointer" : "not-allowed", fontFamily:"inherit" }}>
              Activar 2FA
            </button>
          </div>
        )}

        {!confirm ? (
          <button onClick={() => setConfirm(true)} style={{ width:"100%", marginTop:8, background:C.red+"18", border:"1.5px solid "+C.red+"33", borderRadius:14, padding:"13px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, cursor:"pointer", fontFamily:"inherit" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span style={{ color:C.red, fontWeight:700, fontSize:14 }}>{t("logout")}</span>
          </button>
        ) : (
          <div style={{ marginTop:8, background:C.red+"18", border:"1.5px solid "+C.red+"33", borderRadius:14, padding:"14px 16px" }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>Cerrar sesion?</div>
            <div style={{ fontSize:11, color:C.textMd, marginBottom:12 }}>Tendras que verificar tu identidad al volver.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setConfirm(false)} style={{ flex:1, background:C.creamDk, border:"none", borderRadius:10, padding:"11px", fontWeight:600, fontSize:13, cursor:"pointer", color:C.textMd, fontFamily:"inherit" }}>Cancelar</button>
              <button onClick={onLogout} style={{ flex:2, background:C.red, border:"none", borderRadius:10, padding:"11px", fontWeight:700, fontSize:13, cursor:"pointer", color:"#fff", fontFamily:"inherit" }}>Si, cerrar sesion</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MOBILE PHONE WRAPPER
// ============================================================
function MobileApp({ appState, handlers, C }) {
  const { loggedIn, showProfile, isDark, tab, showUSD, lang, orders, selectedAsset, pendingTrade, toast, holdings, stopLosses, priceAlerts, balance, showTutorial, watchlist } = appState;
  const { setLoggedIn, handleLogin, setShowProfile, setIsDark, setTab, setShowUSD, setLang, setSelected, handleTrade, executeTrade, setPending, handleSetSL, handleSetAlert, handleLogout, finishTutorial, setShowTutorial, toggleWatchlist } = handlers;
  const t = useT(lang);
  const TABS = [{ id:"portfolio",label:t("portfolio") },{ id:"mercado",label:t("mercado") },{ id:"noticias",label:t("noticias") },{ id:"ideas",label:t("inversiones") },{ id:"ordenes",label:t("ordenes") }];
  const totalARS = holdings.reduce((s, h) => { const a = ASSETS.find(x => x.ticker === h.ticker); return s + (a ? h.qty * a.price : 0); }, 0);
  const newsBadge = NEWS.filter(n => n.tickers.some(t => holdings.map(h => h.ticker).includes(t))).length;
  const getH = t => holdings.find(h => h.ticker === t);
  const getSL = t => stopLosses[t] || null;
  const getA  = t => priceAlerts[t] || null;
  const renderPage = () => {
    switch (tab) {
      case "portfolio": return <PagePortfolio holdings={holdings} stopLosses={stopLosses} balance={balance} watchlist={watchlist} onToggleWatchlist={toggleWatchlist} onSelectAsset={setSelected} C={C} showUSD={showUSD} lang={lang}/>;
      case "mercado":    return <PageMercado onSelectAsset={setSelected} C={C} showUSD={showUSD} lang={lang}/>;
      case "noticias":   return <PageNoticias holdings={holdings} onSelectAsset={setSelected} C={C} lang={lang}/>;
      case "ideas":      return <PageIdeas C={C} showUSD={showUSD} onSelectAsset={setSelected} lang={lang}/>;
      case "ordenes":    return <PageOrdenes orders={orders} C={C} lang={lang}/>;
      default:           return <PagePortfolio watchlist={watchlist} onToggleWatchlist={toggleWatchlist} holdings={holdings} stopLosses={stopLosses} balance={balance} onSelectAsset={setSelected} C={C}/>;
    }
  };
  return (
    <div style={{ width:375, height:760, background:C.bg, borderRadius:48, overflow:"hidden", boxShadow:"0 40px 80px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", border:"9px solid #0a0a0a", position:"relative", flexShrink:0 }}>
      <div style={{ position:"absolute", top:0, left:"50%", transform:"translateX(-50%)", width:110, height:26, background:"#0a0a0a", borderRadius:"0 0 16px 16px", zIndex:30 }}/>
      {!loggedIn && <LoginScreen onLogin={handleLogin} C={C}/>}
      {showTutorial && <OnboardingTutorial onClose={finishTutorial} onComplete={finishTutorial} setTab={setTab} setShowUSD={setShowUSD} setShowProfile={setShowProfile} currentTab={tab} C={C}/>}
      {showProfile && <ProfileSheet onClose={() => setShowProfile(false)} onLogout={handleLogout} onToggleDark={() => setIsDark(d => !d)} isDark={isDark} lang={lang} setLang={setLang} C={C}/>}
      {toast && <div style={{ position:"absolute", top:34, left:14, right:14, zIndex:50, background:toast.color, color:"#fff", borderRadius:14, padding:"10px 14px", fontSize:12, fontWeight:700 }}>{toast.msg}</div>}
      {selectedAsset && <AssetDetail asset={selectedAsset} holding={getH(selectedAsset.ticker)} stopLoss={getSL(selectedAsset.ticker)} priceAlert={getA(selectedAsset.ticker)} balance={balance} isInWatchlist={watchlist.includes(selectedAsset.ticker)} onToggleWatchlist={toggleWatchlist} onClose={() => setSelected(null)} onTrade={handleTrade} onSetStopLoss={handleSetSL} onSetAlert={handleSetAlert} C={C}/>}
      {pendingTrade && <ConfirmTradeModal trade={pendingTrade} onConfirm={executeTrade} onCancel={() => setPending(null)} C={C}/>}
      <div style={{ background:C.isDark?"#0F0F0F":"#0D1117", paddingTop:30, paddingBottom:8, paddingLeft:20, paddingRight:20, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0, zIndex:10 }}>
        <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:600 }}>{new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</span>
        <SAMASLogo textColor="#FFFFFF"/>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <CurrencyToggle showUSD={showUSD} onToggle={() => setShowUSD(v => !v)} C={C}/>
          <button onClick={() => setShowProfile(true)} style={{ background:"transparent", border:"none", cursor:"pointer", padding:0 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:"#0D111733", border:"1.5px solid #0D111766", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:C.goldLt }}>{DEMO_USER.initials}</div>
          </button>
        </div>
      </div>
      <TickerBanner C={C}/>
      <FXStrip C={C} totalARS={totalARS}/>
      <div style={{ flex:1, overflowY:"auto", paddingBottom:84 }}>{renderPage()}</div>
      <div style={{ position:"absolute", bottom:0, left:0, right:0, background:C.isDark?"#0F0F0F":C.card, borderTop:"1px solid "+C.border, display:"flex", height:78, zIndex:20, paddingTop:6, paddingBottom:4 }}>
        {TABS.map(t => {
          const active = tab === t.id;
          const badge = t.id==="ordenes"&&orders.length>0 ? orders.length : t.id==="noticias"&&tab!=="noticias" ? newsBadge : 0;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex:1, background:"transparent", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, position:"relative", fontFamily:"inherit", padding:"4px 0" }}>
              {badge > 0 && <div style={{ position:"absolute", top:8, right:"24%", minWidth:18, height:18, borderRadius:9, background:t.id==="noticias"?C.gold:C.red, color:"#fff", fontSize:10, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 5px" }}>{badge}</div>}
              <div style={{ width:46, height:32, borderRadius:16, background: active ? C.accent + "22" : "transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"background 0.2s" }}>
                <TabIcon id={t.id} active={active} C={C} bigger/>
              </div>
              <span style={{ fontSize:11, fontWeight:active?700:500, color:active?C.accent:C.textLt, letterSpacing:0.2 }}>{t.label}</span>
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
  const { holdings, stopLosses, priceAlerts, balance, orders, selectedAsset, pendingTrade, toast, isDark, loggedIn, showProfile, showUSD, showTutorial, lang, watchlist } = appState;
  const { setSelected, handleTrade, executeTrade, setPending, handleSetSL, handleSetAlert, handleLogout, setShowProfile, setIsDark, setShowUSD, setLang, finishTutorial, toggleWatchlist } = handlers;
  const [sideTab, setSideTab] = useState("portfolio");
  const t = useT(lang);
  const TABS2 = [{ id:"portfolio",label:t("portfolio"),icon:"portfolio" },{ id:"mercado",label:t("mercado"),icon:"mercado" },{ id:"noticias",label:t("noticias"),icon:"noticias" },{ id:"ideas",label:t("inversiones"),icon:"ideas" },{ id:"bonos",label:t("bonos"),icon:"bonos" },{ id:"ordenes",label:t("ordenes"),icon:"ordenes" },{ id:"reportes",label:t("reportes"),icon:"reportes" }];
  const totalARS = holdings.reduce((s, h) => { const a = ASSETS.find(x => x.ticker === h.ticker); return s + (a ? h.qty * a.price : 0); }, 0);
  const getH = t => holdings.find(h => h.ticker === t);
  const getSL = t => stopLosses[t] || null;
  const getA  = t => priceAlerts[t] || null;
  const renderPage = () => {
    switch (sideTab) {
      case "portfolio": return <PagePortfolio holdings={holdings} stopLosses={stopLosses} balance={balance} watchlist={watchlist} onToggleWatchlist={toggleWatchlist} onSelectAsset={setSelected} C={C} showUSD={showUSD} lang={lang}/>;
      case "mercado":    return <PageMercado onSelectAsset={setSelected} C={C} showUSD={showUSD} lang={lang}/>;
      case "noticias":   return <PageNoticias holdings={holdings} onSelectAsset={setSelected} C={C} lang={lang}/>;
      case "ideas":      return <PageIdeas C={C} showUSD={showUSD} onSelectAsset={setSelected} lang={lang}/>;
      case "bonos":      return <PageBonos C={C} showUSD={showUSD} lang={lang}/>;
      case "trending":   return <PageTrending onSelectAsset={setSelected} C={C} lang={lang}/>;
      case "ordenes":    return <PageOrdenes orders={orders} C={C} lang={lang}/>;
      case "reportes":   return <PageReportes C={C} lang={lang}/>;
      default:           return <PagePortfolio watchlist={watchlist} onToggleWatchlist={toggleWatchlist} holdings={holdings} stopLosses={stopLosses} balance={balance} onSelectAsset={setSelected} C={C}/>;
    }
  };
  return (
    <div style={{ width:"100%", minHeight:"100vh", background:C.isDark?"#080808":"#F0E0E0", display:"flex", flexDirection:"column" }}>
      <div style={{ background:C.isDark?"#0F0F0F":"#0D1117", height:56, display:"flex", alignItems:"center", padding:"0 24px", gap:24, borderBottom:"1px solid rgba(255,255,255,0.08)", position:"sticky", top:0, zIndex:50 }}>
        <SAMASLogo textColor="#FFFFFF"/>
        <div style={{ flex:1 }}/>
        <div style={{ display:"flex", gap:8 }}>
          {FX.map(fx => <div key={fx.label} style={{ background:"rgba(255,255,255,0.07)", borderRadius:8, padding:"4px 10px" }}><div style={{ color:"rgba(255,255,255,0.45)", fontSize:8, fontWeight:700 }}>USD {fx.label}</div><div style={{ color:"#fff", fontSize:11, fontFamily:"monospace", fontWeight:700 }}>${fN(fx.value)}</div><div style={{ color:fx.up?"#4ADE80":"#F87171", fontSize:9 }}>{fx.up?"+":"-"}{Math.abs(fx.change).toFixed(1)}%</div></div>)}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={() => setShowUSD(v => !v)} style={{ background:showUSD?"#16C78433":"rgba(255,255,255,0.07)", border:"1px solid "+(showUSD?"#16C78455":"transparent"), borderRadius:8, padding:"6px 10px", color:showUSD?"#E8C97A":"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:showUSD?700:400 }}>
            {showUSD ? "USD" : "ARS"}
          </button>
          <button onClick={() => setIsDark(d => !d)} style={{ background:"rgba(255,255,255,0.07)", border:"none", borderRadius:8, padding:"6px 10px", color:"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{isDark?"Modo claro":"Modo oscuro"}</button>
          <button onClick={() => setShowProfile(true)} style={{ background:"#0D111733", border:"1.5px solid #0D111766", borderRadius:8, padding:"6px 12px", color:C.goldLt, fontWeight:800, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{DEMO_USER.initials}</button>
        </div>
      </div>
      <div style={{ display:"flex", flex:1 }}>
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
        <div style={{ flex:1, position:"relative", maxWidth:600 }}>
          {selectedAsset && <AssetDetail asset={selectedAsset} holding={getH(selectedAsset.ticker)} stopLoss={getSL(selectedAsset.ticker)} priceAlert={getA(selectedAsset.ticker)} balance={balance} isInWatchlist={watchlist.includes(selectedAsset.ticker)} onToggleWatchlist={toggleWatchlist} onClose={() => setSelected(null)} onTrade={handleTrade} onSetStopLoss={handleSetSL} onSetAlert={handleSetAlert} C={C}/>}
          {pendingTrade && <ConfirmTradeModal trade={pendingTrade} onConfirm={executeTrade} onCancel={() => setPending(null)} C={C}/>}
          {showProfile && <ProfileSheet onClose={() => setShowProfile(false)} onLogout={handleLogout} onToggleDark={() => setIsDark(d => !d)} isDark={isDark} lang={lang} setLang={setLang} C={C}/>}
          {toast && <div style={{ position:"fixed", top:70, left:"50%", transform:"translateX(-50%)", zIndex:99, background:toast.color, color:"#fff", borderRadius:14, padding:"10px 20px", fontSize:13, fontWeight:700, boxShadow:"0 8px 32px rgba(0,0,0,0.3)" }}>{toast.msg}</div>}
          <div style={{ overflowY:"auto", height:"calc(100vh - 56px)" }}>{renderPage()}</div>
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
  const [isDark, setIsDark]           = useState(true);
  const [loggedIn, setLoggedIn]       = useState(false);
  const [hasSeenTutorial, setHasSeen] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [tab, setTab]                 = useState("portfolio");
  const [showUSD, setShowUSD]         = useState(false);
  const [lang, setLang]               = useState("es");
  const [selectedAsset, setSelected] = useState(null);
  const [orders, setOrders]           = useState([]);
  const [holdings, setHoldings]       = useState(INIT_HOLDINGS);
  const [stopLosses, setStopLosses]   = useState({});
  const [priceAlerts, setPriceAlerts] = useState({});
  const [watchlist, setWatchlist]     = useState(["SPY","BTC","GGAL"]);
  const [balance, setBalance]         = useState(50000);
  const [pendingTrade, setPending]    = useState(null);
  const [toast, setToast]             = useState(null);
  const [viewMode, setViewMode]       = useState("mobile");

  const C = makeTheme(isDark);

  useEffect(() => {
    const handler = () => setShowTutorial(true);
    window.addEventListener('show-tutorial', handler);
    return () => window.removeEventListener('show-tutorial', handler);
  }, []);

  const showToast = (msg, color) => { setToast({ msg, color: color || C.green }); setTimeout(() => setToast(null), 4000); };

  const handleTrade = trade => { setSelected(null); setPending(trade); };

  const executeTrade = () => {
    const { ticker, side, qty, price } = pendingTrade;
    const total = qty * price;
    setOrders(prev => [{ ticker, side, qty, price }, ...prev]);
    if (side === "Compra") {
      setBalance(prev => prev - total);
      setHoldings(prev => { const ex = prev.find(h => h.ticker === ticker); if (ex) return prev.map(h => h.ticker === ticker ? { ...h, qty:h.qty+qty, avg:Math.round((h.avg*h.qty+price*qty)/(h.qty+qty)) } : h); return [...prev, { ticker, qty, avg:price }]; });
    } else {
      setBalance(prev => prev + total);
      setHoldings(prev => prev.map(h => h.ticker === ticker ? { ...h, qty:Math.max(0, h.qty-qty) } : h).filter(h => h.qty > 0));
    }
    sendEmailNotification({ to:DEMO_USER.email, subject:"Operacion ejecutada - " + side + " " + ticker, body:side + " " + qty + " " + ticker + " a $" + fN(price) + ". Total: $" + fN(total) + ". Fecha: " + new Date().toLocaleString("es-AR") + ". Si no reconoces esta operacion, contacta a SAMAS inmediatamente." });
    setPending(null);
    showToast(side + " " + qty + " " + ticker + " ejecutada. Email enviado a " + DEMO_USER.email, side === "Compra" ? C.green : C.red);
  };

  const handleSetSL = (ticker, price) => {
    if (price === null) { setStopLosses(prev => { const n={...prev}; delete n[ticker]; return n; }); showToast("Stop Loss eliminado para " + ticker, C.textMd); }
    else { setStopLosses(prev => ({...prev,[ticker]:price})); showToast("Stop Loss activado: " + ticker + " a $" + fN(price), C.red); }
  };
  const toggleWatchlist = (ticker) => {
    setWatchlist(prev => {
      const has = prev.includes(ticker);
      if (has) { showToast("Removido de favoritos: " + ticker, C.textMd); return prev.filter(t => t !== ticker); }
      showToast("Agregado a favoritos: " + ticker, C.gold);
      return [...prev, ticker];
    });
  };
  const handleSetAlert = (ticker, alert) => {
    if (alert === null) { setPriceAlerts(prev => { const n={...prev}; delete n[ticker]; return n; }); showToast("Alerta eliminada para " + ticker, C.textMd); }
    else { setPriceAlerts(prev => ({...prev,[ticker]:alert})); showToast("Alerta: " + ticker + " " + (alert.direction==="above"?"sube a":"baja a") + " $" + fN(alert.price), C.gold); }
  };
  const handleLogin = () => {
    setLoggedIn(true);
    if (!hasSeenTutorial) {
      // Delay so the login success animation finishes first
      setTimeout(() => setShowTutorial(true), 400);
    }
  };
  const handleLogout = () => { setLoggedIn(false); setShowProfile(false); setTab("portfolio"); setSelected(null); setPending(null); };
  const finishTutorial = () => { setHasSeen(true); setShowTutorial(false); };

  const appState = { isDark, loggedIn, showProfile, tab, showUSD, orders, selectedAsset, pendingTrade, toast, holdings, stopLosses, priceAlerts, balance, showTutorial, lang, watchlist };
  const handlers = { setLoggedIn, handleLogin, setShowProfile, setIsDark, setTab, setShowUSD, setLang, setSelected, handleTrade, executeTrade, setPending, handleSetSL, handleSetAlert, handleLogout, finishTutorial, setShowTutorial, toggleWatchlist };

  const outerBg = isDark ? "#080808" : "#050505";

  return (
    <div style={{ minHeight:"100vh", background:outerBg, fontFamily:"Sora,sans-serif" }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap'); *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}"}</style>

      <div style={{ display:"flex", justifyContent:"center", gap:12, padding:"16px 0 8px", position:"sticky", top:0, zIndex:200, background:outerBg, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        {[["mobile","Movil"],["web","Web"]].map(([v, l]) => (
          <button key={v} onClick={() => setViewMode(v)} style={{ background: v===viewMode ? "#16C784" : "rgba(255,255,255,0.07)", color: v===viewMode ? "#fff" : "rgba(255,255,255,0.5)", border:"none", borderRadius:10, padding:"6px 20px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>{l}</button>
        ))}
      </div>

      {viewMode === "mobile" ? (
        <div style={{ display:"flex", justifyContent:"center", padding:"20px" }}>
          <MobileApp appState={appState} handlers={handlers} C={C}/>
          <div style={{ position:"fixed", bottom:16, left:"50%", transform:"translateX(-50%)", background:"rgba(255,255,255,0.05)", backdropFilter:"blur(10px)", borderRadius:20, padding:"7px 18px", color:"rgba(255,255,255,0.35)", fontSize:11, border:"1px solid rgba(255,255,255,0.07)", whiteSpace:"nowrap" }}>
            Face ID / PIN demo: <strong style={{ color:"rgba(255,255,255,0.6)" }}>4821</strong>
          </div>
        </div>
      ) : (
        loggedIn ? (
          <WebDashboard appState={appState} handlers={handlers} C={C}/>
        ) : (
          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", minHeight:"calc(100vh - 60px)" }}>
            <div style={{ width:375, height:760, position:"relative", borderRadius:20, overflow:"hidden" }}>
              <LoginScreen onLogin={handleLogin} C={C}/>
            </div>
          </div>
        )
      )}
    </div>
  );
}
