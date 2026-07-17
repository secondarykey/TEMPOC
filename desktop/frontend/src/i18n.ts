// UI language and date/time locale for the desktop app.
//
// Claude officially supports a fixed set of BCP-47 locales that always carry
// a region subtag (en-US, ja-JP, ...). TEMPOC stores and resolves those same
// codes internally so the supported list can later grow to the full official
// set without touching the settings model. One resolved code drives both the
// UI strings and every Intl date/duration formatter, so the interface language
// and the date format can never disagree.
//
// The translations themselves live in per-locale JSON files under ./locales,
// so a new language is added by dropping in a JSON file (and listing its code
// in SUPPORTED_LOCALES) without touching this logic. Parameterised messages
// are stored as templates with {token} placeholders; this module wraps them in
// typed functions (the `Messages` type below) so callers keep a compile-time
// checked API instead of poking raw strings.

import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';

export const SUPPORTED_LOCALES = ['en-US', 'ja-JP'] as const;
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = 'en-US';

// Resolve the locale setting ("" = auto → navigator.language) onto a
// supported code: exact match first, then primary-language match
// (e.g. "ja" → "ja-JP", "en-GB" → "en-US"), else the default.
export function resolveLocale(setting: string): LocaleCode {
  const wanted = (setting || navigator.language || DEFAULT_LOCALE).toLowerCase();
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === wanted);
  if (exact) return exact;
  const lang = wanted.split('-')[0];
  return SUPPORTED_LOCALES.find((l) => l.split('-')[0] === lang) ?? DEFAULT_LOCALE;
}

// Shape of a locale's JSON resource. Each JSON file is assigned to this type
// below, so a missing or mistyped key fails the build rather than showing a
// blank/undefined string at runtime. Plain values are finished strings;
// `updated`/`elapsed`/`resetsIn`/`resetsTooltip` are {token} templates; and
// `durationUnits`/`ago` are the data the two Intl fallbacks assemble from.
type PluralForms = { one: string; other: string };
type RawMessages = {
  settings: string;
  refreshUsage: string;
  refresh: string;
  updated: string;
  updatedTooltip: string;
  alwaysOnTop: string;
  alwaysOnTopOn: string;
  alwaysOnTopOff: string;
  minimise: string;
  close: string;

  loginRequired: string;
  loginToClaude: string;
  waitingForUsage: string;
  currentSession: string;
  weeklyLimit: string;
  weeklyScopedFallback: string;
  elapsed: string;
  resetsIn: string;
  resetsTooltip: string;
  notStarted: string;

  durationUnits: { day: string; hour: string; minute: string };
  justNow: string;
  ago: { second: PluralForms; minute: PluralForms; hour: PluralForms; day: PluralForms };

  settingsTitle: string;
  sectionGeneral: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  sizeMode: string;
  sizeNormal: string;
  sizeSmall: string;
  sizeCompact: string;
  transparentWindow: string;
  autoRefresh: string;
  minutesUnit: string;
  nextLaunchNote: string;
  sectionFormatting: string;
  language: string;
  languageAuto: string;
  durationStyle: string;
  durationNarrow: string;
  durationShort: string;
  durationLong: string;
  decimalPlaces: string;
  percentFormat: string;
  sectionHour5: string;
  sectionDay7: string;
  sectionWeeklyScoped: string;
  show: string;
  showRemaining: string;
  colorThreshold: string;
  labelField: string;
  sectionUtilization: string;
  utilizationHelp: string;
  warning: string;
  danger: string;
  interceptorTitle: string;
  interceptorDesc: string;
  toggle: string;
  apply: string;
};

// The API callers use. Same as the plain strings in RawMessages, except the
// parameterised entries are exposed as functions that fill in their template.
export type Messages = Omit<
  RawMessages,
  'updated' | 'elapsed' | 'resetsIn' | 'resetsTooltip' | 'durationUnits' | 'ago'
> & {
  updated: (when: string) => string;
  elapsed: (pct: string) => string;
  resetsIn: (remain: string) => string;
  resetsTooltip: (date: string, remain: string) => string;
  // Fallbacks for when Intl.DurationFormat / Intl.RelativeTimeFormat are
  // unavailable in the WebView; assembled from durationUnits / ago.
  durationFallback: (days: number, hours: number, minutes: number) => string;
  agoFallback: (value: number, unit: keyof RawMessages['ago']) => string;
};

// Replace every {key} in `template` with params[key].
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
}

// Wrap a RawMessages (a locale's JSON) in the function-bearing Messages API.
function build(raw: RawMessages): Messages {
  const { updated, elapsed, resetsIn, resetsTooltip, durationUnits, ago, ...plain } = raw;
  return {
    ...plain,
    updated: (when) => interpolate(updated, { when }),
    elapsed: (pct) => interpolate(elapsed, { pct }),
    resetsIn: (remain) => interpolate(resetsIn, { remain }),
    resetsTooltip: (date, remain) => interpolate(resetsTooltip, { date, remain }),
    durationFallback: (days, hours, minutes) => {
      const parts: string[] = [];
      if (days) parts.push(`${days}${durationUnits.day}`);
      if (days || hours) parts.push(`${hours}${durationUnits.hour}`);
      parts.push(`${minutes}${durationUnits.minute}`);
      return parts.join(' ');
    },
    agoFallback: (value, unit) => {
      const forms = ago[unit];
      return interpolate(value === 1 ? forms.one : forms.other, { value });
    },
  };
}

const MESSAGES: Record<LocaleCode, Messages> = {
  'en-US': build(enUS),
  'ja-JP': build(jaJP),
};

export function getMessages(locale: LocaleCode): Messages {
  return MESSAGES[locale];
}
