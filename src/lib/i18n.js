// ============================================================
// I18N — translation helper for the v2 shell
// ============================================================
// Separate from the much larger TRANSLATIONS table in App.jsx,
// which serves the legacy UI. This module only covers strings
// that the v2 shell renders, which keeps the bundle small and
// keeps additions to the v2 surface from forcing edits to the
// legacy table.
//
// Pattern:
//   import { t } from "../lib/i18n.js";
//   <div>{t("settings.title", lang)}</div>
//   <div>{t("greeting", lang, { name: "Manuel" })}</div>
//
// Lookup falls back es → key (so a missing key shows the dot-
// separated identifier rather than rendering nothing). New
// languages inherit Spanish for any keys they haven't defined,
// so partial translations are safe — the app never goes blank.
// ============================================================

const V2 = {
  es: {
    // tab bar
    "tab.wallet":   "Wallet",
    "tab.invest":   "Invertir",
    "tab.social":   "Social",
    "tab.news":     "Noticias",

    // greeting / header
    "greeting":         "Hola, {name}",
    "greeting_prefix":  "Hola",

    // settings — header + rows
    "settings.profile_subtitle":  "Cuenta y preferencias",
    "settings.section.appearance": "Apariencia",
    "settings.section.security":   "Seguridad",
    "settings.section.account":    "Cuenta",

    "settings.pro_mode":          "Modo Pro",
    "settings.pro_mode_sub":      "Banner en vivo, distribución y top movers",

    "settings.light_mode":        "Modo claro",
    "settings.dark_mode":         "Modo oscuro",
    "settings.theme_to_light":    "Pasar a tema claro",
    "settings.theme_to_dark":     "Pasar a tema oscuro",

    "settings.language":          "Idioma",

    "settings.faceid":            "Face ID",
    "settings.touchid":           "Touch ID",
    "settings.biometry":          "Biometría",
    "settings.bio_unlock":        "Desbloqueá SAMAS sin tipear el PIN",
    "settings.bio_detecting":     "Detectando…",

    "settings.push":              "Notificaciones push",
    "settings.push.busy":         "Procesando…",
    "settings.push.denied":       "Bloqueadas · Activá desde Ajustes de iOS",
    "settings.push.unsupported":  "No disponibles en este dispositivo",
    "settings.push.on_sub":       "Alertas de precio y noticias",
    "settings.push.off_sub":      "Recibí avisos cuando un activo toca tu objetivo",

    "settings.mfa":               "Autenticación 2FA",
    "settings.mfa_sub":           "Recomendado · Authenticator App",

    "settings.logout":            "Cerrar sesión",
    "settings.logout_confirm":    "¿Cerrar sesión?",
    "settings.logout_confirm_sub":"Vas a tener que volver a entrar con tu PIN.",
    "settings.logout_cancel":     "Cancelar",
    "settings.logout_yes":        "Sí, salir",

    "settings.done":              "Listo",
  },

  en: {
    "tab.wallet":   "Wallet",
    "tab.invest":   "Invest",
    "tab.social":   "Social",
    "tab.news":     "News",

    "greeting":         "Hi, {name}",
    "greeting_prefix":  "Hi",

    "settings.profile_subtitle":  "Account & preferences",
    "settings.section.appearance": "Appearance",
    "settings.section.security":   "Security",
    "settings.section.account":    "Account",

    "settings.pro_mode":          "Pro mode",
    "settings.pro_mode_sub":      "Live banner, allocation and top movers",

    "settings.light_mode":        "Light mode",
    "settings.dark_mode":         "Dark mode",
    "settings.theme_to_light":    "Switch to light theme",
    "settings.theme_to_dark":     "Switch to dark theme",

    "settings.language":          "Language",

    "settings.faceid":            "Face ID",
    "settings.touchid":           "Touch ID",
    "settings.biometry":          "Biometrics",
    "settings.bio_unlock":        "Unlock SAMAS without typing your PIN",
    "settings.bio_detecting":     "Detecting…",

    "settings.push":              "Push notifications",
    "settings.push.busy":         "Working…",
    "settings.push.denied":       "Blocked · Enable in iOS Settings",
    "settings.push.unsupported":  "Not available on this device",
    "settings.push.on_sub":       "Price alerts and news",
    "settings.push.off_sub":      "Get pinged when an asset hits your target",

    "settings.mfa":               "Two-factor auth",
    "settings.mfa_sub":           "Recommended · Authenticator app",

    "settings.logout":            "Sign out",
    "settings.logout_confirm":    "Sign out?",
    "settings.logout_confirm_sub":"You'll need to enter your PIN again to come back in.",
    "settings.logout_cancel":     "Cancel",
    "settings.logout_yes":        "Yes, sign out",

    "settings.done":              "Done",
  },

  pt: {
    "tab.wallet":   "Carteira",
    "tab.invest":   "Investir",
    "tab.social":   "Social",
    "tab.news":     "Notícias",

    "greeting":         "Olá, {name}",
    "greeting_prefix":  "Olá",

    "settings.profile_subtitle":  "Conta e preferências",
    "settings.section.appearance": "Aparência",
    "settings.section.security":   "Segurança",
    "settings.section.account":    "Conta",

    "settings.pro_mode":          "Modo Pro",
    "settings.pro_mode_sub":      "Banner ao vivo, distribuição e top movers",

    "settings.light_mode":        "Modo claro",
    "settings.dark_mode":         "Modo escuro",
    "settings.theme_to_light":    "Mudar para tema claro",
    "settings.theme_to_dark":     "Mudar para tema escuro",

    "settings.language":          "Idioma",

    "settings.faceid":            "Face ID",
    "settings.touchid":           "Touch ID",
    "settings.biometry":          "Biometria",
    "settings.bio_unlock":        "Desbloqueie SAMAS sem digitar o PIN",
    "settings.bio_detecting":     "Detectando…",

    "settings.push":              "Notificações push",
    "settings.push.busy":         "Processando…",
    "settings.push.denied":       "Bloqueadas · Ative nos Ajustes do iOS",
    "settings.push.unsupported":  "Não disponíveis neste dispositivo",
    "settings.push.on_sub":       "Alertas de preço e notícias",
    "settings.push.off_sub":      "Receba avisos quando um ativo atingir seu objetivo",

    "settings.mfa":               "Autenticação 2FA",
    "settings.mfa_sub":           "Recomendado · App de autenticação",

    "settings.logout":            "Sair",
    "settings.logout_confirm":    "Sair?",
    "settings.logout_confirm_sub":"Você precisará entrar com o PIN novamente.",
    "settings.logout_cancel":     "Cancelar",
    "settings.logout_yes":        "Sim, sair",

    "settings.done":              "Pronto",
  },

  it: {
    "tab.wallet":   "Wallet",
    "tab.invest":   "Investi",
    "tab.social":   "Social",
    "tab.news":     "Notizie",
    "greeting":         "Ciao, {name}",
    "greeting_prefix":  "Ciao",
    "settings.profile_subtitle": "Account e preferenze",
    "settings.pro_mode":         "Modalità Pro",
    "settings.pro_mode_sub":     "Banner live, distribuzione e top movers",
    "settings.light_mode":       "Tema chiaro",
    "settings.dark_mode":        "Tema scuro",
    "settings.theme_to_light":   "Passa al tema chiaro",
    "settings.theme_to_dark":    "Passa al tema scuro",
    "settings.language":         "Lingua",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "Biometria",
    "settings.bio_unlock":       "Sblocca SAMAS senza digitare il PIN",
    "settings.bio_detecting":    "Rilevamento…",
    "settings.push":             "Notifiche push",
    "settings.push.on_sub":      "Avvisi di prezzo e notizie",
    "settings.push.off_sub":     "Ricevi avvisi quando un asset tocca il tuo obiettivo",
    "settings.mfa":              "Autenticazione 2FA",
    "settings.mfa_sub":          "Consigliato · App Authenticator",
    "settings.logout":           "Esci",
    "settings.done":             "Fatto",
  },

  fr: {
    "tab.wallet":   "Portefeuille",
    "tab.invest":   "Investir",
    "tab.social":   "Social",
    "tab.news":     "Actualités",
    "greeting":         "Bonjour, {name}",
    "greeting_prefix":  "Bonjour",
    "settings.profile_subtitle": "Compte et préférences",
    "settings.pro_mode":         "Mode Pro",
    "settings.pro_mode_sub":     "Bannière en direct, répartition et top movers",
    "settings.light_mode":       "Mode clair",
    "settings.dark_mode":        "Mode sombre",
    "settings.theme_to_light":   "Passer au thème clair",
    "settings.theme_to_dark":    "Passer au thème sombre",
    "settings.language":         "Langue",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "Biométrie",
    "settings.bio_unlock":       "Déverrouille SAMAS sans saisir le PIN",
    "settings.bio_detecting":    "Détection…",
    "settings.push":             "Notifications push",
    "settings.push.on_sub":      "Alertes de prix et actualités",
    "settings.push.off_sub":     "Recevez un avis quand un actif atteint votre cible",
    "settings.mfa":              "Authentification 2FA",
    "settings.mfa_sub":          "Recommandé · App Authenticator",
    "settings.logout":           "Déconnexion",
    "settings.done":             "Terminé",
  },

  de: {
    "tab.wallet":   "Wallet",
    "tab.invest":   "Investieren",
    "tab.social":   "Social",
    "tab.news":     "News",
    "greeting":         "Hallo, {name}",
    "greeting_prefix":  "Hallo",
    "settings.profile_subtitle": "Konto und Einstellungen",
    "settings.pro_mode":         "Pro-Modus",
    "settings.pro_mode_sub":     "Live-Banner, Verteilung und Top Movers",
    "settings.light_mode":       "Heller Modus",
    "settings.dark_mode":        "Dunkler Modus",
    "settings.theme_to_light":   "Zu hellem Theme wechseln",
    "settings.theme_to_dark":    "Zu dunklem Theme wechseln",
    "settings.language":         "Sprache",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "Biometrie",
    "settings.bio_unlock":       "Entsperre SAMAS ohne PIN-Eingabe",
    "settings.bio_detecting":    "Erkennung…",
    "settings.push":             "Push-Benachrichtigungen",
    "settings.push.on_sub":      "Kursalarme und Nachrichten",
    "settings.push.off_sub":     "Wirst benachrichtigt, wenn ein Asset dein Ziel trifft",
    "settings.mfa":              "Zwei-Faktor-Auth",
    "settings.mfa_sub":          "Empfohlen · Authenticator-App",
    "settings.logout":           "Abmelden",
    "settings.done":             "Fertig",
  },

  zh: {
    "tab.wallet":   "钱包",
    "tab.invest":   "投资",
    "tab.social":   "社区",
    "tab.news":     "新闻",
    "greeting":         "你好，{name}",
    "greeting_prefix":  "你好",
    "settings.profile_subtitle": "账户与偏好",
    "settings.pro_mode":         "专业模式",
    "settings.pro_mode_sub":     "实时横幅、分布和涨跌榜",
    "settings.light_mode":       "浅色模式",
    "settings.dark_mode":        "深色模式",
    "settings.theme_to_light":   "切换到浅色主题",
    "settings.theme_to_dark":    "切换到深色主题",
    "settings.language":         "语言",
    "settings.faceid":           "面容 ID",
    "settings.touchid":          "触控 ID",
    "settings.biometry":         "生物识别",
    "settings.bio_unlock":       "无需输入 PIN 即可解锁 SAMAS",
    "settings.bio_detecting":    "检测中…",
    "settings.push":             "推送通知",
    "settings.push.on_sub":      "价格预警和新闻",
    "settings.push.off_sub":     "资产到达目标时收到提醒",
    "settings.mfa":              "双重认证",
    "settings.mfa_sub":          "推荐 · 身份验证器应用",
    "settings.logout":           "退出登录",
    "settings.done":             "完成",
  },

  ru: {
    "tab.wallet":   "Кошелёк",
    "tab.invest":   "Инвестиции",
    "tab.social":   "Соцсеть",
    "tab.news":     "Новости",
    "greeting":         "Привет, {name}",
    "greeting_prefix":  "Привет",
    "settings.profile_subtitle": "Аккаунт и настройки",
    "settings.pro_mode":         "Pro-режим",
    "settings.pro_mode_sub":     "Лайв-баннер, распределение и лидеры",
    "settings.light_mode":       "Светлая тема",
    "settings.dark_mode":        "Тёмная тема",
    "settings.theme_to_light":   "Переключить на светлую тему",
    "settings.theme_to_dark":    "Переключить на тёмную тему",
    "settings.language":         "Язык",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "Биометрия",
    "settings.bio_unlock":       "Разблокируй SAMAS без ввода PIN",
    "settings.bio_detecting":    "Поиск…",
    "settings.push":             "Push-уведомления",
    "settings.push.on_sub":      "Алерты по цене и новости",
    "settings.push.off_sub":     "Получай уведомления, когда актив достигнет цели",
    "settings.mfa":              "Двухфакторная авторизация",
    "settings.mfa_sub":          "Рекомендуется · Приложение Authenticator",
    "settings.logout":           "Выйти",
    "settings.done":             "Готово",
  },

  ja: {
    "tab.wallet":   "ウォレット",
    "tab.invest":   "投資",
    "tab.social":   "ソーシャル",
    "tab.news":     "ニュース",
    "greeting":         "こんにちは、{name}",
    "greeting_prefix":  "こんにちは",
    "settings.profile_subtitle": "アカウントと設定",
    "settings.pro_mode":         "Proモード",
    "settings.pro_mode_sub":     "ライブバナー、構成、トップムーバー",
    "settings.light_mode":       "ライトモード",
    "settings.dark_mode":        "ダークモード",
    "settings.theme_to_light":   "ライトテーマに切り替え",
    "settings.theme_to_dark":    "ダークテーマに切り替え",
    "settings.language":         "言語",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "生体認証",
    "settings.bio_unlock":       "PINなしでSAMASを解除",
    "settings.bio_detecting":    "検出中…",
    "settings.push":             "プッシュ通知",
    "settings.push.on_sub":      "価格アラートとニュース",
    "settings.push.off_sub":     "資産が目標に達したら通知を受け取る",
    "settings.mfa":              "2段階認証",
    "settings.mfa_sub":          "推奨 · 認証アプリ",
    "settings.logout":           "ログアウト",
    "settings.done":             "完了",
  },

  he: {
    "tab.wallet":   "ארנק",
    "tab.invest":   "השקעה",
    "tab.social":   "חברתי",
    "tab.news":     "חדשות",
    "greeting":         "שלום, {name}",
    "greeting_prefix":  "שלום",
    "settings.profile_subtitle": "חשבון והעדפות",
    "settings.pro_mode":         "מצב Pro",
    "settings.pro_mode_sub":     "באנר חי, התפלגות ומובילים",
    "settings.light_mode":       "מצב בהיר",
    "settings.dark_mode":        "מצב כהה",
    "settings.theme_to_light":   "החלף לערכת נושא בהירה",
    "settings.theme_to_dark":    "החלף לערכת נושא כהה",
    "settings.language":         "שפה",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "ביומטריה",
    "settings.bio_unlock":       "פתח את SAMAS בלי להקליד PIN",
    "settings.bio_detecting":    "מזהה…",
    "settings.push":             "התראות פוש",
    "settings.push.on_sub":      "התראות מחיר וחדשות",
    "settings.push.off_sub":     "קבל התראות כשנכס מגיע ליעד שלך",
    "settings.mfa":              "אימות דו-שלבי",
    "settings.mfa_sub":          "מומלץ · אפליקציית Authenticator",
    "settings.logout":           "התנתקות",
    "settings.done":             "סיום",
  },

  ar: {
    "tab.wallet":   "المحفظة",
    "tab.invest":   "استثمار",
    "tab.social":   "اجتماعي",
    "tab.news":     "الأخبار",
    "greeting":         "مرحبًا، {name}",
    "greeting_prefix":  "مرحبًا",
    "settings.profile_subtitle": "الحساب والإعدادات",
    "settings.pro_mode":         "وضع Pro",
    "settings.pro_mode_sub":     "بانر مباشر، التوزيع والأكثر تحركًا",
    "settings.light_mode":       "الوضع الفاتح",
    "settings.dark_mode":        "الوضع الداكن",
    "settings.theme_to_light":   "التبديل إلى المظهر الفاتح",
    "settings.theme_to_dark":    "التبديل إلى المظهر الداكن",
    "settings.language":         "اللغة",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "البصمة",
    "settings.bio_unlock":       "افتح SAMAS بدون إدخال الرمز",
    "settings.bio_detecting":    "جارٍ الاكتشاف…",
    "settings.push":             "الإشعارات الفورية",
    "settings.push.on_sub":      "تنبيهات السعر والأخبار",
    "settings.push.off_sub":     "احصل على تنبيه عندما يصل الأصل إلى هدفك",
    "settings.mfa":              "المصادقة الثنائية",
    "settings.mfa_sub":          "موصى به · تطبيق Authenticator",
    "settings.logout":           "تسجيل الخروج",
    "settings.done":             "تم",
  },

  ko: {
    "tab.wallet":   "지갑",
    "tab.invest":   "투자",
    "tab.social":   "소셜",
    "tab.news":     "뉴스",
    "greeting":         "안녕하세요, {name}",
    "greeting_prefix":  "안녕하세요",
    "settings.profile_subtitle": "계정 및 환경설정",
    "settings.pro_mode":         "프로 모드",
    "settings.pro_mode_sub":     "라이브 배너, 분포 및 상위 종목",
    "settings.light_mode":       "라이트 모드",
    "settings.dark_mode":        "다크 모드",
    "settings.theme_to_light":   "라이트 테마로 전환",
    "settings.theme_to_dark":    "다크 테마로 전환",
    "settings.language":         "언어",
    "settings.faceid":           "Face ID",
    "settings.touchid":          "Touch ID",
    "settings.biometry":         "생체 인증",
    "settings.bio_unlock":       "PIN 없이 SAMAS 잠금 해제",
    "settings.bio_detecting":    "감지 중…",
    "settings.push":             "푸시 알림",
    "settings.push.on_sub":      "가격 알림 및 뉴스",
    "settings.push.off_sub":     "자산이 목표에 도달하면 알림 받기",
    "settings.mfa":              "2단계 인증",
    "settings.mfa_sub":          "권장 · Authenticator 앱",
    "settings.logout":           "로그아웃",
    "settings.done":             "완료",
  },
};

/**
 * t(key, lang, vars) — look up a translation.
 *
 * @param {string} key - dot-separated identifier (e.g. "settings.faceid")
 * @param {string} lang - language code; defaults to "es"
 * @param {object} [vars] - replacements for {placeholder} tokens
 * @returns {string} translated string, or es fallback, or the key itself
 */
export function t(key, lang = "es", vars = {}) {
  const table = V2[lang] || V2.es;
  let s = table[key];
  if (s === undefined) s = V2.es[key];
  if (s === undefined) return key; // surface the missing key, don't blank
  if (vars && Object.keys(vars).length) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return s;
}

// Tiny convenience: a curried helper if the caller would rather not
// repeat `lang` on every call. `const tt = withLang(lang); tt("key")`.
export function withLang(lang) {
  return (key, vars) => t(key, lang, vars);
}
