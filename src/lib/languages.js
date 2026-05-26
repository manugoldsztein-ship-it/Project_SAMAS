// ============================================================
// LANGUAGES — single source of truth for app i18n locales
// ============================================================
// Used by:
//   - App.jsx (the legacy ProfileSheet language picker, the t()
//     translation helper, and the document-dir flip for RTL).
//   - src/v2/Shell.jsx (the new SettingsSheet language picker).
//
// Lives in src/lib/ rather than src/v2/ because App.jsx (the parent)
// would create a circular import if it pulled from a v2/* path.
// Keep this module lean — strings are intentionally short so we
// can stage them in a dropdown without truncating.
// ============================================================

export const LANGUAGES = [
  { code: "es", label: "Español",   flag: "ES" },
  { code: "en", label: "English",   flag: "EN" },
  { code: "pt", label: "Português", flag: "PT" },
  { code: "it", label: "Italiano",  flag: "IT" },
  { code: "fr", label: "Français",  flag: "FR" },
  { code: "de", label: "Deutsch",   flag: "DE" },
  { code: "zh", label: "中文",        flag: "ZH" },
  { code: "ru", label: "Русский",    flag: "RU" },
  { code: "ja", label: "日本語",      flag: "JA" },
  { code: "he", label: "עברית",      flag: "HE" },
  { code: "ar", label: "العربية",    flag: "AR" },
  { code: "ko", label: "한국어",      flag: "KO" },
];

// Languages that render right-to-left. Used to flip `dir` on the
// document root so Hebrew / Arabic read naturally.
export const RTL_LANGS = ["he", "ar"];

// Convenience: lookup helper for the picker UI.
export function findLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}
