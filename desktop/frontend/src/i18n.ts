// UI language and date/time locale for the desktop app.
//
// Claude officially supports a fixed set of BCP-47 locales that always carry
// a region subtag (en-US, ja-JP, ...). TEMPOC stores and resolves those same
// codes internally so the supported list can later grow to the full official
// set without touching the settings model. One resolved code drives both the
// UI strings (dictionaries below) and every Intl date/duration formatter, so
// the interface language and the date format can never disagree.

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

// Every user-visible string, typed so a locale missing a key fails to
// compile. Parameterised messages are functions, letting each language put
// the value where its grammar needs it.
export type Messages = {
  // Title bar (main window)
  settings: string;
  refreshUsage: string;
  refresh: string;
  updated: (when: string) => string;
  updatedTooltip: string;
  alwaysOnTop: string;
  alwaysOnTopOn: string;
  alwaysOnTopOff: string;
  minimise: string;
  close: string;

  // Main window body
  loginRequired: string;
  loginToClaude: string;
  waitingForUsage: string;
  currentSession: string;
  weeklyLimit: string;
  weeklyScopedFallback: string;
  elapsed: (pct: string) => string;
  resetsIn: (remain: string) => string;
  resetsTooltip: (date: string, remain: string) => string;
  notStarted: string;

  // Fallbacks for when Intl.DurationFormat / Intl.RelativeTimeFormat are
  // unavailable in the WebView.
  durationFallback: (days: number, hours: number, minutes: number) => string;
  justNow: string;
  agoFallback: (value: number, unit: 'second' | 'minute' | 'hour' | 'day') => string;

  // Settings window
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

const EN_US: Messages = {
  settings: 'Settings',
  refreshUsage: 'Refresh usage',
  refresh: 'Refresh',
  updated: (when) => `Updated ${when}`,
  updatedTooltip: 'When the displayed usage was last fetched',
  alwaysOnTop: 'Always on top',
  alwaysOnTopOn: 'Always on top: on',
  alwaysOnTopOff: 'Always on top: off',
  minimise: 'Minimise',
  close: 'Close',

  loginRequired: 'Login required',
  loginToClaude: 'Log in to Claude',
  waitingForUsage: 'Waiting for usage data',
  currentSession: 'Current session',
  weeklyLimit: 'Weekly limit',
  weeklyScopedFallback: 'Weekly (scoped)',
  elapsed: (pct) => `Elapsed ${pct}`,
  resetsIn: (remain) => `resets in ${remain}`,
  resetsTooltip: (date, remain) => `Resets ${date} (${remain})`,
  notStarted: 'not started',

  durationFallback: (days, hours, minutes) => {
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (days || hours) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
  },
  justNow: 'just now',
  agoFallback: (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'} ago`,

  settingsTitle: 'Settings',
  sectionGeneral: 'General',
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  sizeMode: 'Size mode',
  sizeNormal: 'Normal',
  sizeSmall: 'Small',
  sizeCompact: 'Compact',
  transparentWindow: 'Transparent window',
  autoRefresh: 'Auto-refresh',
  minutesUnit: 'min',
  nextLaunchNote: 'Takes effect on next app launch.',
  sectionFormatting: 'Formatting',
  language: 'Language',
  languageAuto: 'Auto (system)',
  durationStyle: 'Duration style',
  durationNarrow: 'Narrow (3d 4h)',
  durationShort: 'Short (3 days 4 hr.)',
  durationLong: 'Long (3 days 4 hours)',
  decimalPlaces: 'Decimal places',
  percentFormat: 'Percent format',
  sectionHour5: '5-Hour Window',
  sectionDay7: '7-Day Window',
  sectionWeeklyScoped: 'Weekly (scoped) Window',
  show: 'Show',
  showRemaining: 'Show remaining time',
  colorThreshold: 'Color threshold',
  labelField: 'Label',
  sectionUtilization: 'Utilization Threshold',
  utilizationHelp: 'Forces warning/danger colors when absolute usage reaches these values.',
  warning: 'Warning',
  danger: 'Danger',
  interceptorTitle: 'Claude interceptor window',
  interceptorDesc: 'Show the hidden Claude page for login or debugging.',
  toggle: 'Toggle',
  apply: 'Apply',
};

const JA_JP: Messages = {
  settings: '設定',
  refreshUsage: '使用量を更新',
  refresh: '更新',
  updated: (when) => `${when}に更新`,
  updatedTooltip: '表示中の使用量を最後に取得した時刻',
  alwaysOnTop: '最前面に表示',
  alwaysOnTopOn: '最前面に表示: オン',
  alwaysOnTopOff: '最前面に表示: オフ',
  minimise: '最小化',
  close: '閉じる',

  loginRequired: 'ログインが必要です',
  loginToClaude: 'Claude にログイン',
  waitingForUsage: '使用量データを待機中',
  currentSession: '現在のセッション',
  weeklyLimit: '週間上限',
  weeklyScopedFallback: 'Weekly (scoped)',
  elapsed: (pct) => `経過 ${pct}`,
  resetsIn: (remain) => `あと${remain}でリセット`,
  resetsTooltip: (date, remain) => `${date} にリセット（${remain}）`,
  notStarted: '未開始',

  durationFallback: (days, hours, minutes) => {
    const parts: string[] = [];
    if (days) parts.push(`${days}日`);
    if (days || hours) parts.push(`${hours}時間`);
    parts.push(`${minutes}分`);
    return parts.join(' ');
  },
  justNow: 'たった今',
  agoFallback: (value, unit) => {
    const units = { second: '秒', minute: '分', hour: '時間', day: '日' } as const;
    return `${value}${units[unit]}前`;
  },

  settingsTitle: '設定',
  sectionGeneral: '全般',
  theme: 'テーマ',
  themeSystem: 'システム',
  themeLight: 'ライト',
  themeDark: 'ダーク',
  sizeMode: '表示サイズ',
  sizeNormal: '標準',
  sizeSmall: '小',
  sizeCompact: 'コンパクト',
  transparentWindow: 'ウィンドウを透明化',
  autoRefresh: '自動更新',
  minutesUnit: '分',
  nextLaunchNote: '次回起動時に反映されます。',
  sectionFormatting: '表示形式',
  language: '言語',
  languageAuto: '自動（システム）',
  durationStyle: '期間の表記',
  durationNarrow: '短縮（3d 4h）',
  durationShort: '標準（3日 4時間）',
  durationLong: '詳細（3日 4時間）',
  decimalPlaces: '小数点以下の桁数',
  percentFormat: 'パーセント表記',
  sectionHour5: '5時間ウィンドウ',
  sectionDay7: '7日ウィンドウ',
  sectionWeeklyScoped: 'Weekly (scoped) ウィンドウ',
  show: '表示',
  showRemaining: '残り時間を表示',
  colorThreshold: '色分けしきい値',
  labelField: 'ラベル',
  sectionUtilization: '使用率しきい値',
  utilizationHelp: '使用率がこの値に達したとき、警告/危険色を強制します。',
  warning: '警告',
  danger: '危険',
  interceptorTitle: 'Claude 傍受ウィンドウ',
  interceptorDesc: '非表示の Claude ページをログインやデバッグ用に表示します。',
  toggle: '切り替え',
  apply: '適用',
};

const MESSAGES: Record<LocaleCode, Messages> = {
  'en-US': EN_US,
  'ja-JP': JA_JP,
};

export function getMessages(locale: LocaleCode): Messages {
  return MESSAGES[locale];
}
