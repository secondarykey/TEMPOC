// i18n for the options page (an extension page — not a content script).
// The locale JSON files under locales/ are synced copies of the repo-root
// locales/ master shared with the desktop app; edit them there and run
// scripts/sync_locales.py.

const TEMPOC_LOCALES = [
  "en-US", "ja-JP", "fr-FR", "de-DE", "hi-IN", "id-ID",
  "it-IT", "ko-KR", "pt-BR", "es-419", "es-ES",
];
const TEMPOC_DEFAULT_LOCALE = "en-US";

// Resolve a wanted locale (claude.ai account locale or navigator.language)
// onto a supported code: exact match, then primary-language match
// (e.g. "ja" -> "ja-JP", "en-GB" -> "en-US"), else the default.
function tempocResolveLocale(wanted) {
  const w = (wanted || TEMPOC_DEFAULT_LOCALE).toLowerCase();
  const exact = TEMPOC_LOCALES.find((l) => l.toLowerCase() === w);
  if (exact) return exact;
  const lang = w.split("-")[0];
  return TEMPOC_LOCALES.find((l) => l.split("-")[0] === lang) ?? TEMPOC_DEFAULT_LOCALE;
}

async function tempocLoadMessages(locale) {
  const res = await fetch(`locales/${locale}.json`);
  return res.json();
}

// Replace the text of every [data-i18n] element. The English text already in
// the HTML is the fallback shown until the messages load (or for keys the
// loaded file somehow lacks).
function tempocApplyI18n(messages) {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = messages[el.dataset.i18n];
    if (typeof value === "string") el.textContent = value;
  });
}
