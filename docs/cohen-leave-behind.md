# SAMAS

**App iOS de inversiones para Cohen**

Lista para TestFlight hoy. La construimos para que Cohen ofrezca a su
clientela retail una app con UX moderna, 19 features de IA, y cinco
diferenciadores que ningún broker AR tiene nativos.

---

## Cinco features que nadie en AR tiene nativas

| # | Feature | Por qué importa |
|---|---|---|
| 1 | **Valores en términos reales (UVA)** | Toggle ARS / USD / **UVA** en el balance. Muestra "real, vs últimos 6 meses" para que el usuario vea cuánta plata real perdió a la inflación. CNV ha pedido esto hace años — somos los primeros en exponerlo nativamente. |
| 2 | **Stress test histórico de un tap** | "¿Cómo aguantó tu cartera el corralito 2001 / GFC 2008 / COVID 2020?" Lenguaje de asesor financiero senior, tradicionalmente hecho a mano en Excel — SAMAS lo hace en 1 segundo. |
| 3 | **Detector de patrones tóxicos** | Cuando el usuario está en overtrading, revenge trading, FOMO o pánico, la app le sugiere una pausa con un mensaje empático escrito por IA. Robinhood gana cuando el usuario opera más; nosotros ganamos cuando opera mejor. |
| 4 | **Trade journal automático** | Cada compra captura tesis al entrar; cada venta cierra el trade con outcome (gain / loss / flat) y AI-reflection. Win rate, P/L 90d, lecciones — instrumental para que el usuario aprenda de sus propios errores. |
| 5 | **Portafolio hipotético (backtest)** | "¿Cuánto tendrías si hubieras invertido US$10k hace 5 años en una estrategia moderada?" Calibrado con retornos reales por categoría (4 / 7 / 10% anuales según perfil), bands low/high, gráfico inline. |

Y 14 funciones de IA más: análisis de cartera, brief diario, rotación
sectorial, sugerencia de tamaño de posición, validación de tesis,
resumen de noticias, comparación contra benchmarks. Todas tienen un
fallback determinístico, así que si el proveedor de IA está caído,
la app sigue funcionando con respuestas pre-calculadas.

---

## Stack y madurez

- **Frontend**: React 18 + Capacitor 8, single-codebase iOS, native UX (haptics, biometrics, push notifications, Dynamic Type del slider de iOS).
- **Backend**: Supabase (Postgres + RLS audited + 30 Edge Functions + Realtime). Security pass completo: rate limiting, input validation, security headers, secret scan limpio. Documento auditable: `docs/security-audit.md`.
- **AI**: proveedor de IA externo vía Edge Functions con quota tier (5/día gratis, ilimitado en SAMAS Plus US$5/mes). Toda key vive del lado servidor; la app cliente nunca la ve.
- **Cumplimiento Apple**: account deletion + data export funcionando, Privacy Manifest completo (Guideline 5.1.1(v)).
- **Cripto exposure**: vía CEDEARs Cohen-coverable (IBIT / COIN / MSTR / MARA / RIOT). Sin custodia crypto, cero PSAV registration.

---

## Lo que necesitamos de Cohen

1. **Rail ALyC** para settle de trades reales (depósito / withdraw / orders).
2. **Listing de CEDEARs** que ya operan, con énfasis en spot crypto ETFs (IBIT / FBTC) si están disponibles en BYMA.
3. **Compliance review** del producto post-deal (CNV / UIF / KYC pipeline).
4. **Test merchant account de Mercado Pago** (o equivalente) para deposit rails — spec ya documentado en `docs/mercado-pago-integration.md`, ~1 día de trabajo nuestro.

---

## Lo que ofrecemos

- **App iOS terminada**, distribuible vía TestFlight desde hoy.
- **19 features de IA** que la app actual de Cohen no tiene.
- **100+ commits en 6 meses, hechos por una persona**. Si arrancamos mañana, las features que pidan se priorizan en horas, no en sprints.
- **Estructura de IP flexible**: nosotros mantenemos el código, Cohen mantiene el rail. White-label es posible si lo negociamos.
- **Suscripción Plus (US$5/mes)** ya implementada — un segundo flujo de ingresos en paralelo a la comisión de trading que cobra Cohen.

---

## Donde estamos honestos sobre limitaciones

- No tenemos rails de plata reales todavía — todos los flujos de depósito / withdraw / orders son mock. Spec de integración con MP listo. Real money requires Cohen.
- KYC / CNV registration es necesario antes de launch público. Ese proceso es de Cohen, no nuestro.
- Privacy Policy / Terms son grade prototipo (App Store compliant pero requieren legal review pre-launch real).
- Crypto custody no lo hacemos — referenciamos a partners externos o exposure vía CEDEARs.

---

## Contacto

**Manuel Goldsztein**
manugoldsztein@gmail.com
Solo founder · 6 meses de dev · 100+ patches

TestFlight invite: [pegar link cuando esté]
GitHub repo: privado, acceso para technical due diligence on request.

---

*Documento generado por SAMAS pre-pitch. Stack y features actualizados a la fecha de impresión.*
