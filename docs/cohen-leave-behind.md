# SAMAS

**Front-end retail-tech para Cohen**

Una app iOS de inversiones para retail argentino. Lista para TestFlight hoy.
La construimos para que Cohen tenga lo que su app actual no tiene: un canal
retail con UX moderna, 19+ features de IA, y diferenciadores que ningún
broker AR ofrece nativamente.

---

## Cinco features que nadie en AR tiene nativas

| # | Feature | Por qué importa |
|---|---|---|
| 1 | **Valores en términos reales (UVA)** | Toggle ARS / USD / **UVA** en el balance. Muestra "real, vs últimos 6 meses" para que el usuario vea cuánta plata real perdió a la inflación. CNV ha pedido esto hace años — somos los primeros en exponerlo nativamente. |
| 2 | **Stress test histórico de un tap** | "¿Cómo aguantó tu cartera el corralito 2001 / GFC 2008 / COVID 2020?" Lenguaje de asesor financiero senior, tradicionalmente hecho a mano en Excel — SAMAS lo hace en 1 segundo. |
| 3 | **Mood-aware AI (anti-overtrading)** | Detecta patterns tóxicos: overtrading, revenge trading, FOMO, panic selling. Cuando dispara, propone una pausa con copy empático generado por IA. **Robinhood profita de operaciones; SAMAS profita de disciplina.** |
| 4 | **Trade journal automático** | Cada compra captura tesis al entrar; cada venta cierra el trade con outcome (gain / loss / flat) y AI-reflection. Win rate, P/L 90d, lecciones — instrumental para que el usuario aprenda de sus propios errores. |
| 5 | **Portafolio hipotético (backtest)** | "¿Cuánto tendrías si hubieras invertido US$10k hace 5 años en una estrategia moderada?" Calibrado con retornos reales por categoría (4 / 7 / 10% anuales según perfil), bands low/high, gráfico inline. |

Más 14 superficies de IA adicionales: portfolio analysis, daily brief,
sector rotation, position sizing, validación de tesis, news digest,
benchmark compare, etc. Todas con templated fallbacks deterministicos
para que la app funcione incluso si Anthropic está caído.

---

## Stack y madurez

- **Frontend**: React 18 + Capacitor 8, single-codebase iOS, native UX (haptics, biometrics, push notifications, Dynamic Type del slider de iOS).
- **Backend**: Supabase (Postgres + RLS audited + 30 Edge Functions + Realtime). Security pass completo: rate limiting, input validation, security headers, secret scan limpio. Documento auditable: `docs/security-audit.md`.
- **AI**: Anthropic Claude Haiku 4.5 vía Edge Functions con quota tier (5/día gratis, ilimitado en SAMAS Plus US$5/mes).
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

- **Frontend iOS production-ready**, distribuido vía TestFlight hoy.
- **Pipeline de 19 AI surfaces** que la app actual de Cohen no tiene.
- **Velocidad**: 100+ patches shipped en 6 meses solo. Cohen no tiene que esperar features — las priorizamos juntos.
- **IP estructura flexible**: SAMAS mantiene el código, Cohen mantiene el rail. White-label posible si la negociación lo requiere.
- **Plus subscription model** (US$5/mes) ya implementado — revenue stream paralelo al commission de trading que da Cohen.

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
