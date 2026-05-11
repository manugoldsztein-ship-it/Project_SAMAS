// ============================================================
// SAMAS Tutorials (samas-0.4.1)
// ============================================================
// Curated set of in-app guides for AR retail users — financial
// literacy + product walkthroughs. Each tutorial is a small
// markdown blob (## h2 headings + paragraphs, the same shape the
// in-house parser in Tutorials.jsx renders).
//
// Translation strategy: bodies are stored in this file (not i18n.js)
// because they're longer than the typical translatable string and
// re-using the i18n machinery for paragraph-length text gets messy.
// Spanish-only for the prototype; English mirror lands when there's
// a reason to ship to non-AR users.
//
// Adding a tutorial: append a new object to TUTORIALS. id should be
// stable (used in localStorage for "read" state). glyph is one
// emoji that survives WKWebView's font fallback. body is a
// multi-line template literal — the parser splits on \n and reads
// `## ` as h2, `**bold**` inline, blank lines as paragraph breaks.
// ============================================================

export const TUTORIALS = [
  {
    id: "first_trade",
    module: "fundamentals",
    xp: 10,
    glyph: "🛒",
    title: "Cómo hacer tu primera operación",
    subtitle: "Comprar un activo en SAMAS, paso a paso.",
    body: `
## El flujo en 30 segundos

Andá a la pestaña **Invertir** abajo y tocá **Mercado**. Buscá un activo (probá **AAPL** o **GGAL** si recién empezás). Tocá la fila para abrir el panel del activo.

## Tocá Comprar

Vas a ver un selector de tipo de orden (**Mercado** o **Límite**) y un campo para la cantidad. Si dudás cuánto comprar, mirá la tarjeta de **Sugerencia de tamaño · IA** abajo del input — te tira tres tamaños (Conservador / Estándar / Agresivo) calculados a partir de tu cartera actual. Tocá uno y la cantidad se llena sola.

## Revisá

Tocá **Revisar** y vas a ver el resumen: cantidad, precio, comisión, IVA y total. La IA del **Trade Coach** corre automáticamente y te da un veredicto del orden contra el resto de tu cartera. Si querés, escribí tu **tesis** en el campo opcional — esa frase queda guardada y SAMAS la valida más adelante.

## Confirmar

Tocá **Confirmar compra**. Si la operación es a mercado, queda ejecutada al toque. Si es a límite, queda pendiente hasta que el precio toque tu objetivo. Vas a ver la pantalla **¡Listo!** y la posición aparece en tu **Portafolio**.
`.trim(),
    questions: [
      {
        prompt: "¿Dónde encontrás el botón Comprar de un activo?",
        options: [
          "En la pestaña Inicio, abajo del balance",
          "En Invertir → Mercado → tocás un activo y se abre su panel",
          "En la pestaña Noticias, al lado del titular",
          "Solo desde Configuración",
        ],
        correctIdx: 1,
        explanation: "Tocás Invertir, después Mercado, después un activo. Eso abre el panel con Comprar / Vender.",
      },
      {
        prompt: "Si dudás cuánta cantidad comprar, ¿qué te muestra SAMAS?",
        options: [
          "Te conecta con un asesor humano por chat",
          "Una tarjeta Sugerencia de tamaño · IA con 3 opciones (Conservador / Estándar / Agresivo)",
          "Te obliga a una orden a mercado por el mínimo",
          "Te bloquea hasta que decidas",
        ],
        correctIdx: 1,
        explanation: "La sugerencia se calcula con tu cartera actual y te da 3 tamaños — tocás uno y la cantidad se llena sola.",
      },
    ],
  },
  {
    id: "samas_plus",
    module: "strategy",
    xp: 10,
    glyph: "✦",
    title: "Qué es SAMAS Plus",
    subtitle: "El plan pago de SAMAS — qué incluye y cuándo conviene.",
    body: `
## La diferencia entre Pro y Plus

**Pro** es la vista densa de la app — gratis para todos. Tocás el toggle en Configuración y SAMAS muestra más métricas, gráficos y datos en cada pantalla. Sin costo.

**Plus** es la suscripción paga (US$5 por mes). Lo que activa:

## IA ilimitada

En la tier gratuita tenés **5 consultas IA por día** sobre cosas tappeables: chat con SAMAS, análisis profundo de cartera, análisis profundo de un activo, rebalanceo, sugerir watchlist, explicar noticias, redactar posts, generar insights proactivos.

Las IA que se cargan solas (Brief Diario, Earnings, Comparativa con Benchmark, Riesgo, Review trimestral, Trade Coach, Sugerencia de tamaño, Digest de noticias) son **gratis siempre**. Plus te saca el límite de las primeras 8.

## El indicador 5/5

En las pantallas que consumen IA vas a ver una pildorita "3/5 IA hoy". Cuando se pone amarilla estás cerca del tope; cuando se pone roja, la próxima consulta abre el modal de Plus.

## Cómo activar

Configuración → fila **SAMAS Plus** arriba → tocá **Activar**. Por ahora la suscripción es de demo (no pasa por App Store IAP todavía). En producción se conecta a la facturación de Apple.

## Cancelás cuando quieras

Mismo lugar: Configuración → fila **SAMAS Plus** → **Cancelar**. Volvés a la tier gratuita inmediatamente.
`.trim(),
    questions: [
      {
        prompt: "¿Cuál es la diferencia entre Pro y Plus?",
        options: [
          "Pro es paga, Plus es gratis",
          "Pro es la vista densa gratis; Plus es la suscripción paga que saca el límite de IA",
          "Son lo mismo con otro nombre",
          "Plus desactiva las IAs gratuitas",
        ],
        correctIdx: 1,
        explanation: "Pro = vista densa, sin costo. Plus = US$5/mes, saca el límite de 5 IA por día.",
      },
      {
        prompt: "En la tier gratuita, ¿cuántas consultas IA por día tenés sobre features tappeables?",
        options: ["1", "3", "5", "Ilimitadas"],
        correctIdx: 2,
        explanation: "5 al día. Las IAs que se cargan solas (Brief Diario, Trade Coach, etc.) son gratis siempre.",
      },
    ],
  },
  {
    id: "risk_score",
    module: "fundamentals",
    xp: 10,
    glyph: "📈",
    title: "Cómo leer el Riesgo por activo",
    subtitle: "Score 1-10, qué significan los colores y de dónde sale.",
    body: `
## Dónde aparece

En **Invertir → Portafolio**, justo arriba del dashboard Pro, vas a ver la tarjeta **Riesgo por activo · IA**. Cada posición tiene un score del **1 al 10**.

## Los tres colores

- **Verde (1-3)** — riesgo bajo. Bonos, ETFs amplios, posiciones diversificadas chicas.
- **Amarillo (4-6)** — riesgo medio. CEDEARs grandes, commodities, posiciones medianas en acciones.
- **Rojo (7-10)** — riesgo alto. Cripto, acciones individuales con alta volatilidad, posiciones que ocupan mucho de tu cartera.

## Qué arma el score

El número se calcula del lado del servidor a partir de:

1. **Categoría base**: BONO=2, ETF=4, CEDEAR=6, COMMOD=6, ACCION=7, CRYPTO=9.
2. **Volatilidad histórica** del ticker — multiplica el baseline.
3. **Penalty de concentración**: si la posición es más del 25% de tu cartera, suma 1; más del 40%, suma 2.
4. **Drawdown**: si el activo está más de -15% desde tu compra, suma 1.

## Por qué aparece tu posición más alta primero

La lista está ordenada de mayor a menor riesgo. La idea es que la primera fila sea la cosa que probablemente quieras revisar antes que el resto.

## Tap para ver el porqué

Cada fila se expande con una explicación en castellano de por qué tiene ese score. La IA refina la frase; los números los pone el servidor (la IA no puede inventarlos).
`.trim(),
    questions: [
      {
        prompt: "Un score de Riesgo entre 1-3 indica:",
        options: [
          "Riesgo alto — cripto y volatilidad",
          "Riesgo bajo — bonos, ETFs amplios, posiciones diversificadas chicas",
          "Riesgo medio — CEDEARs grandes",
          "Sin datos suficientes",
        ],
        correctIdx: 1,
        explanation: "Verde (1-3) es bajo riesgo. Amarillo (4-6) es medio. Rojo (7-10) es alto.",
      },
      {
        prompt: "Una posición que ocupa más del 40% de tu cartera, ¿cómo afecta su score de riesgo?",
        options: [
          "Lo baja (más concentración = menos riesgo)",
          "No tiene efecto",
          "Le suma 2 al score como penalty de concentración",
          "Lo divide por 2",
        ],
        correctIdx: 2,
        explanation: "Penalty de concentración: >25% suma 1, >40% suma 2. Una posición gigante es más vulnerable a un movimiento adverso.",
      },
    ],
  },
  {
    id: "cedear_basics",
    module: "fundamentals",
    xp: 10,
    glyph: "🌎",
    title: "Qué es un CEDEAR",
    subtitle: "El instrumento más usado por retail argentino para invertir en acciones del exterior.",
    body: `
## Definición rápida

Un **CEDEAR** (Certificado de Depósito Argentino) es un certificado que cotiza en la Bolsa de Buenos Aires y que representa una acción de una empresa extranjera que cotiza en otro mercado (típicamente Estados Unidos).

Cuando comprás un CEDEAR de Apple, estás comprando un certificado argentino que te da exposición económica al precio de la acción de Apple en Wall Street.

## Para qué sirve

- **Invertir en USD desde una cuenta en pesos** — sin tener que abrir cuenta en EE.UU.
- **Acceso al exterior** — Apple, Tesla, Amazon, etc. comprables desde tu broker argentino.
- **Cobertura cambiaria implícita** — el CEDEAR cotiza en pesos pero su valor sigue al dólar + al precio de la acción.

## Ratio: la trampa para el que recién empieza

Cada CEDEAR tiene un **ratio** — cuántos certificados equivalen a una acción real. Por ejemplo, **AAPL tiene ratio 20:1**: necesitás 20 CEDEARs de Apple para tener "una" acción de Apple equivalente.

El ratio NO te perjudica — el precio del CEDEAR ya está ajustado. Pero te puede confundir si comparás "el precio del CEDEAR de Apple" contra "el precio de Apple en NYSE" sin tener en cuenta el ratio.

## Comisión + impuesto

- **Comisión del broker**: típicamente 0,5%-0,7% por operación.
- **Derechos de mercado**: pequeños, los cobra Caja de Valores.
- **Impuesto cedular**: 15% sobre ganancias en moneda extranjera para personas físicas residentes (regla simplificada). El broker (ALyC) maneja la retención.

## Riesgos a tener en cuenta

- **Liquidez**: algunos CEDEARs operan poco. Antes de comprar, mirá el volumen.
- **Spread**: la diferencia entre punta compradora y vendedora puede ser amplia en CEDEARs no líquidos.
- **Brecha cambiaria**: el "dólar implícito" del CEDEAR puede divergir del MEP — a veces sube, a veces baja.
`.trim(),
    questions: [
      {
        prompt: "Si AAPL tiene ratio 20:1, ¿qué significa?",
        options: [
          "Que cada CEDEAR vale 20 dólares",
          "Que necesitás 20 CEDEARs para tener exposición a 1 acción de Apple",
          "Que pagás 20% extra de comisión",
          "Que el precio sube 20% por día",
        ],
        correctIdx: 1,
        explanation: "El ratio es cuántos CEDEARs equivalen a una acción real. El precio ya está ajustado — no te perjudica, solo confunde si comparás precios sin tenerlo en cuenta.",
      },
      {
        prompt: "Impuesto cedular sobre ganancias en CEDEARs para persona física residente (regla simplificada):",
        options: ["5%", "15%", "25%", "35%"],
        correctIdx: 1,
        explanation: "15% sobre ganancias en moneda extranjera. La retención la maneja el broker (ALyC).",
      },
    ],
  },
  {
    id: "thesis_tracker",
    module: "strategy",
    xp: 15,
    glyph: "📋",
    title: "Cómo escribir una tesis de inversión",
    subtitle: "El campo opcional al confirmar una compra que SAMAS puede validar más adelante.",
    body: `
## El concepto

Cuando confirmás una compra en SAMAS, tenés un campo opcional que dice "Tu tesis (opcional)". Ahí escribís en una o dos oraciones por qué estás comprando ese activo.

La idea es simple: **el momento de claridad sobre por qué comprás algo es ANTES de comprarlo.** Después, cuando el precio se mueve y empezás a dudar, esa frase es el único registro de tu pensamiento original.

## Una buena tesis

Una buena tesis es **específica, falsable y temporal**:

- ❌ Mala: "Apple es una buena empresa."
- ✅ Buena: "AAPL reporta el viernes y los servicios crecen 14% YoY. Si confirma, puede empujar 5%+."

La buena tesis dice **qué te haría darte cuenta de que estabas equivocado**. Si la empresa reporta y los servicios crecen 8% en lugar de 14%, tu tesis se rompió.

## Cómo SAMAS la valida

Después de comprar, abrí ese activo desde tu Portafolio. Vas a ver una tarjeta **Tu tesis · IA** con tu texto en cursiva. Tocá **Validar con IA** y SAMAS Haiku lee:

1. Tu tesis original.
2. El precio actual y el movimiento desde tu compra.
3. Las noticias recientes en cache para ese ticker.
4. Cuántos días pasaron.

Devuelve un veredicto en uno de tres niveles:

- **Sigue en pie** — el mercado no contradice tu tesis (todavía).
- **Debilitada** — drawdown moderado o señales mixtas, vale revisar.
- **Rota** — los datos contradicen tu tesis. Hora de releer y decidir.

## Por qué es valioso

Reduce **el sesgo de confirmación**: en vez de inventar una historia retrospectiva ("siempre supe que iba a bajar"), tenés tu pensamiento original escrito y SAMAS te dice si los datos lo respaldan.

Es journaling-meets-validación, y según nuestro relevamiento ningún broker argentino lo ofrece.
`.trim(),
    questions: [
      {
        prompt: "¿Cuándo es el mejor momento para escribir tu tesis sobre una compra?",
        options: [
          "Después de que el precio se haya movido",
          "ANTES de comprar, cuando todavía pensás con claridad",
          "Solo si la operación pierde",
          "Una vez al mes en el journal general",
        ],
        correctIdx: 1,
        explanation: "El momento de claridad sobre por qué comprás algo es antes. Después, la duda contamina el pensamiento.",
      },
      {
        prompt: "¿Cuál de estas es una buena tesis?",
        options: [
          "Apple es una buena empresa",
          "AAPL reporta el viernes y los servicios crecen 14% YoY; si confirma, puede empujar 5%+",
          "Voy a comprar porque sí",
          "Lo dijo un YouTuber",
        ],
        correctIdx: 1,
        explanation: "Una buena tesis es específica, falsable y temporal. Si los servicios crecen 8% en lugar de 14%, tu tesis se rompió — eso es claridad.",
      },
    ],
  },
  {
    id: "share_privacy",
    module: "strategy",
    xp: 10,
    glyph: "🔒",
    title: "Privacidad cuando compartís tu cartera",
    subtitle: "Qué se ve y qué NO se ve cuando publicás un trade o tu portafolio en el feed social.",
    body: `
## Qué compartís cuando posteás tu cartera

Cuando tocás **Compartir cartera** en el compositor de Social, SAMAS arma una tarjeta con:

- **Composición**: una barra horizontal con la proporción de cada ticker (% del book).
- **Performance**: el % de ganancia o pérdida ponderada de tu cartera.
- **Lista de tickers**: cada fila muestra el símbolo, su % de asignación, y el % de cambio del día.

## Qué NO se comparte

- **El monto total en dólares** de tu cartera.
- **La cantidad de unidades** que tenés de cada activo.
- **Tu cost basis** o el precio al que compraste.

Esos datos los dejamos del lado del cliente — nunca llegan al feed público.

## Cuando compartís un trade

Cuando publicás "Acabo de comprar X" desde la pantalla de orden ejecutada, la tarjeta solo muestra:

- **Lado** (COMPRA / VENTA).
- **Ticker** ($GGAL, $AAPL, etc.).
- **Stamp** "Ejecutado en SAMAS".

Sin cantidad, sin precio de fill. La idea es que vos puedas sumarte a la conversación pública sobre un activo sin revelar el tamaño de tu posición.

## Por qué nos importa

En redes sociales financieras, el tamaño de tu cartera es información sensible. Que la conozca un follower aleatorio puede:

- Convertirte en target de phishing personalizado.
- Inflar tu burbuja social ("publican porque tienen plata").
- Crear FOMO o ansiedad en personas con menos capital.

SAMAS es **privacy-by-default**: tu actividad social se enfoca en **decisiones**, no en **montos**.

## Y los DMs

Los mensajes directos están **cifrados en reposo** por Supabase (ver el ícono 🔒 en el header de la conversación). Eso significa que están protegidos contra acceso a la base de datos sin autorización.

NO son end-to-end todavía — administradores de SAMAS con acceso al service role podrían leerlos. Si querés borrar una conversación, tocá el ícono de basura en el header. La conversación se elimina de tu lado; el destinatario sigue viendo su copia hasta que él también la borre.
`.trim(),
    questions: [
      {
        prompt: "Cuando compartís tu cartera en Social, ¿qué info se publica?",
        options: [
          "El monto total en dólares y la cantidad de unidades por activo",
          "Solo composición porcentual, performance ponderada y lista de tickers — SIN monto ni cost basis",
          "Todo, incluyendo tu CBU",
          "Solo el ticker más grande",
        ],
        correctIdx: 1,
        explanation: "SAMAS es privacy-by-default. Compartís decisiones, no montos. Tu cost basis y unidades nunca salen del cliente.",
      },
      {
        prompt: "¿Los DMs en SAMAS son end-to-end encrypted?",
        options: [
          "Sí, ni los admins pueden leerlos",
          "No — cifrados en reposo (icono 🔒), pero admins con service role podrían leerlos",
          "No están cifrados de ninguna forma",
          "Solo si pagás Plus",
        ],
        correctIdx: 1,
        explanation: "Cifrado en reposo ≠ E2E. Mejor que plaintext, pero no invisible al equipo SAMAS. Real E2E queda para post-launch.",
      },
    ],
  },
];
