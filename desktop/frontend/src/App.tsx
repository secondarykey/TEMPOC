import { useState, useEffect, useCallback, useRef } from 'react'
import { Events, Window } from '@wailsio/runtime'
import { SettingsService } from '../bindings/changeme'
import { Settings } from '../bindings/changeme/settings'
import SettingsWindow from './SettingsWindow'
import { COLORS, applyTheme } from './theme'
import { resolveLocale, getMessages, type LocaleCode, type Messages } from './i18n'

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Custom title bar for the frameless window: the header itself is the drag
// region; the gear button and window controls opt out with
// --wails-draggable: no-drag. The gear opens the (now separate) settings
// window rather than toggling an in-window view.
function TitleBar({ onOpenSettings, onRefresh, onTop, onToggleOnTop, lastUpdatedLabel, t }: { onOpenSettings: () => void; onRefresh: () => void; onTop: boolean; onToggleOnTop: () => void; lastUpdatedLabel: string | null; t: Messages }) {
  return (
    <header className="titlebar" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
      <div className="titlebar-left" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <button
          className="titlebar-gear"
          aria-label={t.settings}
          title={t.settings}
          onClick={onOpenSettings}
        >
          <GearIcon />
        </button>
        <button
          className="titlebar-refresh"
          aria-label={t.refresh}
          title={t.refreshUsage}
          onClick={onRefresh}
        >
          <RefreshIcon />
        </button>
        {lastUpdatedLabel && (
          <span className="titlebar-updated" style={{ '--wails-draggable': 'drag' } as React.CSSProperties} title={t.updatedTooltip}>
            {t.updated(lastUpdatedLabel)}
          </span>
        )}
      </div>
      <div className="titlebar-controls" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <button
          className={`pin${onTop ? ' is-active' : ''}`}
          aria-label={t.alwaysOnTop}
          aria-pressed={onTop}
          title={onTop ? t.alwaysOnTopOn : t.alwaysOnTopOff}
          onClick={onToggleOnTop}
        >
          <PinIcon />
        </button>
        <button aria-label={t.minimise} onClick={() => Window.Minimise()}>&#x2015;</button>
        {/* tempoc:quit (not Window.Close()) so Go can save the window position
            while the frameless window still reports reliable coordinates. */}
        <button aria-label={t.close} className="close" onClick={() => Events.Emit('tempoc:quit')}>&#x2715;</button>
      </div>
    </header>
  );
}

type SizeMode = 'normal' | 'small' | 'compact';

type UsageWindow = { utilization?: number; resets_at?: string | null };
type WindowKind = 'five_hour' | 'seven_day' | 'weekly_scoped' | 'credits';
// The API's extra_usage object ("Usage credits"): pay-as-you-go spending once a
// plan limit is hit. Amounts are integers in the currency's minor units, scaled
// by decimal_places (monthly_limit 5000 + decimal_places 2 => $50.00).
type CreditsData = {
  is_enabled?: boolean;
  monthly_limit?: number | null;
  used_credits?: number | null;
  utilization?: number | null;
  currency?: string | null;
  decimal_places?: number | null;
};
type UsagePayload = {
  seven_day?: UsageWindow;
  five_hour?: UsageWindow;
  // weekly_scoped is a newer window Claude added; may be absent/temporary.
  weekly_scoped?: UsageWindow;
  extra_usage?: CreditsData;
};

// Length of each usage window in milliseconds. The window start is derived by
// subtracting this from resets_at (the window end), matching the Chrome
// extension's calculation. weekly_scoped is treated as a 7-day window; credits
// are excluded because a calendar month has no fixed length (see windowStart).
const WINDOW_MS: Record<Exclude<WindowKind, 'credits'>, number> = {
  five_hour: 5 * 60 * 60 * 1000,
  seven_day: 7 * 24 * 60 * 60 * 1000,
  weekly_scoped: 7 * 24 * 60 * 60 * 1000,
};

// Start of the window that ends at `end`. Credits follow the calendar month,
// which varies in length, so their start is one calendar month back from the
// end rather than a fixed subtraction. Both ends of a credits window are UTC
// month boundaries (see creditsResetsAt), and Date.UTC normalises month -1 into
// the previous December, so January needs no special case.
function windowStart(kind: WindowKind, end: number): number {
  if (kind !== 'credits') return end - WINDOW_MS[kind];
  const d = new Date(end);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function formatPercent(n: number, settings: Settings): string {
  const fmt = settings.percentFormat || '{}%';
  return fmt.replace('{}', n.toFixed(settings.decimalPlaces));
}

// Utilisation from the API is a whole percent (no decimals), so it's always
// shown as an integer like "100%" — independent of the decimalPlaces setting
// (which still applies to the computed Elapsed percentage).
function formatUtil(n: number): string {
  return `${Math.round(n)}%`;
}

// Format a remaining duration using Intl.DurationFormat (ported from
// content.js's createDuration + redraw). Intl.DurationFormat isn't in the
// TS lib yet, so it's accessed dynamically and wrapped in try/catch, falling
// back to a localized "1d 3h 20m"-style string when unsupported or given
// bad input.
type DurationParts = { days?: number; hours?: number; minutes?: number; seconds?: number };

function formatRemaining(ms: number, durationStyle: string, locale: LocaleCode, t: Messages): string {
  if (ms < 0) ms = 0;
  // Intl.DurationFormat omits zero-valued fields, so during the last minute a
  // days/hours/minutes duration formats to the empty string and the label reads
  // as a bare "left". Count down in seconds over that final minute instead —
  // it both fills the label and shows the reset really is seconds away.
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const seconds = Math.floor((ms / 1000) % 60);
  const underMinute = !days && !hours && !minutes;
  const duration: DurationParts = underMinute ? { seconds } : { days, hours, minutes };
  try {
    const DurationFormat = (Intl as unknown as { DurationFormat?: new (locale: string, opts: { style: string }) => { format: (d: DurationParts) => string } }).DurationFormat;
    if (!DurationFormat) throw new Error('Intl.DurationFormat unsupported');
    const df = new DurationFormat(locale, { style: durationStyle });
    return df.format(duration);
  } catch {
    return t.durationFallback(days, hours, minutes, seconds);
  }
}

// Format how long ago the usage data was last received, as a localized
// relative string (e.g. "5 sec. ago", "2 min. ago"). Uses the same `now` tick
// that drives the Elapsed bars, so it stays fresh without re-fetching. Falls
// back to a localized plain string when Intl.RelativeTimeFormat is unavailable.
function formatLastUpdated(sinceMs: number, locale: LocaleCode, t: Messages): string {
  const sec = Math.max(0, Math.floor(sinceMs / 1000));
  const pick = (): [number, 'second' | 'minute' | 'hour' | 'day'] => {
    if (sec < 60) return [sec, 'second'];
    const min = Math.floor(sec / 60);
    if (min < 60) return [min, 'minute'];
    const hr = Math.floor(min / 60);
    if (hr < 24) return [hr, 'hour'];
    return [Math.floor(hr / 24), 'day'];
  };
  const [value, unit] = pick();
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    return rtf.format(-value, unit);
  } catch {
    return value === 0 ? t.justNow : t.agoFallback(value, unit);
  }
}

// Format the window's reset moment as a localized date/time (ported from
// content.js: month/day/weekday + hour/minute). This is the value that isn't
// shown on Claude's own usage page — knowing exactly which day and hour the
// window resets is the point of this app.
function formatResetDate(d: Date, locale: LocaleCode): string {
  try {
    return d.toLocaleString(locale, {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
    });
  } catch {
    return d.toLocaleString();
  }
}

// Format a credit amount for display. Amounts come from the API as integers in
// the currency's minor units, with decimal_places giving the scale. Passing
// `currency` renders the symbol; the label pairs a currency-bearing figure with
// a bare one — "($1.69/50.00)" — so the symbol isn't repeated. Both are
// formatted for the UI locale, and an unknown currency code (which would make
// Intl throw) falls back to the plain number.
function formatCredits(minor: number, decimals: number, locale: LocaleCode, currency?: string): string {
  const value = minor / Math.pow(10, decimals);
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  try {
    return new Intl.NumberFormat(
      locale,
      currency ? { ...opts, style: 'currency', currency } : opts,
    ).format(value);
  } catch {
    return value.toFixed(decimals);
  }
}

// The start of the next UTC month as an ISO timestamp: the moment Claude's
// usage credits reset. The usage API reports no reset time for credits at all
// (every other window carries resets_at), and claude.ai's own page just says
// "Resets Aug 1" — i.e. the calendar month of the billing cycle, which is UTC.
// The bar renders this moment in the user's locale and timezone like any other,
// so in e.g. JST it correctly reads as the 1st at 09:00.
function nextUtcMonthStart(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

// Per-window color thresholds / remaining-time preference.
function pickCfg(kind: WindowKind, s: Settings) {
  if (kind === 'five_hour')
    return { colorEnabled: s.hour5ColorEnabled, danger: s.hour5Danger, warning: s.hour5Warning, showRemain: s.showRemainHour5 };
  if (kind === 'seven_day')
    return { colorEnabled: s.day7ColorEnabled, danger: s.day7Danger, warning: s.day7Warning, showRemain: s.showRemainDay7 };
  if (kind === 'credits')
    return { colorEnabled: s.creditsColorEnabled, danger: s.creditsDanger, warning: s.creditsWarning, showRemain: s.showRemainCredits };
  return {
    colorEnabled: s.weeklyScopedColorEnabled,
    danger: s.weeklyScopedDanger,
    warning: s.weeklyScopedWarning,
    showRemain: s.showRemainWeeklyScoped,
  };
}

// Color of the utilisation fill, ported exactly from content.js's redraw().
function computeColor(util: number, elapsed: number, kind: WindowKind, s: Settings): string {
  const cfg = pickCfg(kind, s);
  if (!cfg.colorEnabled) return COLORS.accent;
  if (util >= s.utilizationDanger) return COLORS.danger;
  const diff = util - elapsed;
  if (diff > cfg.danger) return COLORS.danger;
  if (diff > cfg.warning || util >= s.utilizationWarning) return COLORS.warning;
  return COLORS.accent;
}

// A usage window rendered as a progress bar: the coloured fill is the usage
// utilisation, and the vertical marker is how far through the time window we
// are. An optional `secondary` window (e.g. weekly_scoped) is nested inside the
// same card, sharing this window's timeline (reset time / elapsed / remaining);
// only its label and utilisation differ.
function UsageBar({
  label,
  kind,
  data,
  now,
  settings,
  secondary,
  sizeMode,
  utilText,
  locale,
  t,
}: {
  label: string;
  kind: WindowKind;
  data: UsageWindow | undefined;
  now: number;
  settings: Settings;
  secondary?: { label: string; kind: WindowKind; data: UsageWindow | undefined };
  sizeMode: SizeMode;
  // Replaces the bare percentage in the value cell — credits show their amounts
  // alongside it ("$13.63/50.00 | 27%"). Since that needs far more room than a
  // percentage, its presence also widens the value column (--util-col, see
  // .usage-bar--wide-util in style.css).
  utilText?: string;
  locale: LocaleCode;
  t: Messages;
}) {
  const util = clamp(data?.utilization ?? 0);
  const resets = data?.resets_at ? new Date(data.resets_at) : null;

  let elapsed = 0;
  let remainMs = 0;
  let started = false;
  if (resets && !Number.isNaN(resets.getTime())) {
    started = true;
    const end = resets.getTime();
    const start = windowStart(kind, end);
    elapsed = clamp(((now - start) / (end - start)) * 100);
    remainMs = end - now;
  }

  const color = computeColor(util, elapsed, kind, settings);
  const showRemain = pickCfg(kind, settings).showRemain;

  // secondary shares this window's elapsed timeline; only label/util/color differ.
  const secUtil = secondary ? clamp(secondary.data?.utilization ?? 0) : 0;
  const secColor = secondary ? computeColor(secUtil, elapsed, secondary.kind, settings) : '';

  // Build a hover tooltip for a given utilisation: usage, reset date, elapsed
  // and remaining, one line each. The reset date / elapsed / remaining are the
  // window's shared timeline, so the only line that differs between the primary
  // bar and the nested weekly_scoped bar is usage — hence the util parameter
  // and the separate secTooltip. Each bar shows its own figures (scoped ⇒
  // scoped usage), so the tooltip is attached per bar, not to the whole card.
  const buildTip = (u: number): string => {
    const lines = [t.usage(formatUtil(u))];
    if (started && resets) {
      lines.push(t.resetsAt(formatResetDate(resets, locale)));
      lines.push(t.elapsed(formatPercent(elapsed, settings)));
      lines.push(t.remaining(formatRemaining(remainMs, settings.durationStyle, locale, t)));
    } else {
      lines.push(t.notStarted);
    }
    return lines.join('\n');
  };
  const tooltip = buildTip(util);
  const secTooltip = secondary ? buildTip(secUtil) : '';

  // Compact mode: a single line per window, "label | elapsed% | utilization%"
  // (utilization last, at the eye-catching right edge), instead of the
  // track/marker/foot layout. The reset date and remaining time aren't shown as
  // columns (so the row stays as small as possible) — they, and everything
  // else, live in the row's hover tooltip. Each row carries its own window's
  // tooltip (primary row `tooltip`, weekly_scoped row `secTooltip`), so the
  // scoped row reports the scoped figures. The label has no title of its own,
  // so hovering anywhere on the row — label included — shows that tooltip. The
  // fixed value columns (style.css --compact-*-col) keep cells lined up across
  // every row (and across cards, each its own grid); the secondary row shares
  // the primary's timeline, so its elapsed cell stays empty.
  // Only the primary bar can carry a custom value text (utilText); the nested
  // secondary is always a plain percentage.
  const cardClass = `usage-bar${utilText ? ' usage-bar--wide-util' : ''}`;

  if (sizeMode === 'compact') {
    const row = (lbl: string, value: string, c: string, tip: string, sub?: boolean) => (
      <div className={`usage-bar-compact${sub ? ' usage-bar-compact--sub' : ''}`} title={tip}>
        <span className="usage-bar-label">{lbl}</span>
        <span className="usage-bar-compact-elapsed">{sub ? '' : started ? formatPercent(elapsed, settings) : '—'}</span>
        <span className="usage-bar-util" style={{ color: c }}>{value}</span>
      </div>
    );
    return (
      <div className={cardClass}>
        {row(label, utilText ?? formatUtil(util), color, tooltip)}
        {secondary && row(secondary.label, formatUtil(secUtil), secColor, secTooltip, true)}
      </div>
    );
  }

  return (
    <div className={cardClass} title={tooltip}>
      <div className="usage-bar-head">
        <span className="usage-bar-label">{label}</span>
        <span className="usage-bar-util" style={{ color }}>{utilText ?? formatUtil(util)}</span>
      </div>
      <div className="usage-bar-track-wrap">
        <div className="usage-bar-track">
          <div className="usage-bar-fill" style={{ width: `${util}%`, background: color }} />
        </div>
        {started && (
          <div className="usage-bar-marker" style={{ left: `${elapsed}%` }} />
        )}
      </div>

      {/* The scoped sub-bar's own parts carry secTooltip, overriding the card's
          primary tooltip on hover so the scoped bar reports scoped figures. */}
      {secondary && (
        <>
          <div className="usage-bar-head usage-bar-head--sub" title={secTooltip}>
            <span className="usage-bar-label">{secondary.label}</span>
            <span className="usage-bar-util" style={{ color: secColor }}>{formatUtil(secUtil)}</span>
          </div>
          <div className="usage-bar-track-wrap" title={secTooltip}>
            <div className="usage-bar-track">
              <div className="usage-bar-fill" style={{ width: `${secUtil}%`, background: secColor }} />
            </div>
            {started && <div className="usage-bar-marker" style={{ left: `${elapsed}%` }} />}
          </div>
        </>
      )}

      {/* Foot is the "time" row: "<date> resets" (left) and remaining (right).
          Elapsed% isn't shown here — it's in the card's hover tooltip
          (`tooltip` above) along with usage and the reset date. */}
      <div className="usage-bar-foot">
        <span className="usage-bar-reset">
          {started && resets ? t.resetsAt(formatResetDate(resets, locale)) : ''}
        </span>
        <span>
          {started
            ? showRemain
              ? t.remaining(formatRemaining(remainMs, settings.durationStyle, locale, t))
              : ''
            : t.notStarted}
        </span>
      </div>
    </div>
  );
}

function MainWindow() {
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [settings, setSettings] = useState<Settings>(() => new Settings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // True while the interceptor reports Claude wants a login (it lands on
  // /login). Shows the "Log in to Claude" button; cleared as soon as usage
  // data flows again.
  const [authRequired, setAuthRequired] = useState(false);
  // Set when the interceptor reports it couldn't read the usage API (Claude
  // returning 5xx, an HTML error page, a network failure). Deliberately does
  // NOT clear `usage` or `lastUpdated`: the last figures we received are still
  // the last known truth, and blanking them would render every bar at 0% —
  // an outage would look like a fresh window. The modal over the bars (and the
  // timestamp going stale in the title bar) is what tells the user the numbers
  // are old.
  // Holds the technical reason for the tooltip; '' still counts as an error.
  const [fetchError, setFetchError] = useState<string | null>(null);
  // True from the moment the modal's retry is pressed until we hear back (a
  // usage event, another fetch-error) or the fallback timeout below fires.
  // Without it a retry that silently goes nowhere — the interceptor skips the
  // refresh while sitting on the login page, say — would look like a dead
  // button, since a repeated failure re-reports the same error and changes
  // nothing on screen.
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    SettingsService.Get()
      .then((s) => {
        setSettings(s);
        setSettingsLoaded(true);
      })
      .catch((err) => {
        // Backend Load() already falls back to defaults on a corrupt
        // settings.json, so this only guards against I/O errors (e.g. an
        // unreadable file). Without it settingsLoaded stays false forever
        // and the main window renders no usage bars at all.
        console.error('tempoc: failed to load settings, using defaults', err);
        setSettings(new Settings());
        setSettingsLoaded(true);
      });
  }, []);

  useEffect(() => {
    const off = Events.On('tempoc:usage', (e: any) => {
      setUsage(e.data as UsagePayload);
      setLastUpdated(Date.now());
      // Data is flowing, so the session is authenticated and Claude is up.
      setAuthRequired(false);
      setFetchError(null);
      setRetrying(false);
    });
    const offAuth = Events.On('tempoc:auth-required', () => {
      setAuthRequired(true);
      setRetrying(false);
      // A login prompt replaces the whole view, so a stale fetch error under
      // it would only reappear (out of context) once the login succeeds.
      setFetchError(null);
    });
    // Claude couldn't be read. Keep whatever we already show — only raise the
    // modal, so the user sees the numbers stopped updating instead of seeing
    // them silently reset.
    const offFetchError = Events.On('tempoc:fetch-error', (e: any) => {
      setFetchError((e?.data?.msg as string) ?? '');
      setRetrying(false);
    });
    // The settings window emits this after Apply commits a new draft via
    // SettingsService.Set. Re-fetching (rather than receiving the value in
    // the event payload) keeps the settings window as the sole writer and
    // the main window a plain reader, and reuses the existing settings-driven
    // useEffects (transparency, always-on-top, sizing) below as the apply path.
    const offSettingsApplied = Events.On('tempoc:settings-applied', () => {
      SettingsService.Get().then(setSettings);
    });
    // Recompute elapsed-time progress once per second.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      if (typeof off === 'function') off();
      if (typeof offAuth === 'function') offAuth();
      if (typeof offFetchError === 'function') offFetchError();
      if (typeof offSettingsApplied === 'function') offSettingsApplied();
    };
  }, []);

  // Fallback for a retry that never reports back (the interceptor skips the
  // refresh on the login page, or the click never reaches a live fetch). Puts
  // the button back so the user can try again instead of staring at a stuck
  // "retrying" state.
  useEffect(() => {
    if (!retrying) return;
    const id = setTimeout(() => setRetrying(false), 15000);
    return () => clearTimeout(id);
  }, [retrying]);

  // Auto-refresh when a window's reset moment passes. Claude keeps reporting the
  // stale 100% until the usage endpoint is hit again, so the instant `now`
  // crosses any window's resets_at we trigger the same refresh the toolbar
  // button does, flipping the bar to the fresh 0%. Guarded per reset boundary:
  // right after a reset the server may briefly still return the old resets_at
  // (still in the past), so we retry a bounded number of times, spaced out, and
  // stop firing once the returned resets_at advances into the future (new key).
  const resetFireRef = useRef<Map<string, { attempts: number; last: number }>>(new Map());
  useEffect(() => {
    if (!usage) return;
    const MAX_ATTEMPTS = 5;
    const RETRY_MS = 8000;
    const windows = [usage.five_hour, usage.seven_day, usage.weekly_scoped];
    let fire = false;
    for (const w of windows) {
      if (!w?.resets_at) continue;
      const end = new Date(w.resets_at).getTime();
      if (Number.isNaN(end) || now < end) continue;
      const rec = resetFireRef.current.get(w.resets_at) ?? { attempts: 0, last: 0 };
      if (rec.attempts >= MAX_ATTEMPTS || now - rec.last < RETRY_MS) continue;
      rec.attempts += 1;
      rec.last = now;
      resetFireRef.current.set(w.resets_at, rec);
      fire = true;
    }
    if (fire) Events.Emit('tempoc:refresh');
  }, [now, usage]);

  // Apply/remove the opaque page background based on the transparency setting.
  useEffect(() => {
    document.documentElement.classList.toggle('is-transparent', settings.transparent);
  }, [settings.transparent]);

  // Apply the theme setting ("system" follows the OS preference live). Gated
  // on settingsLoaded so the first paint keeps the CSS default (dark) instead
  // of flashing the system theme before the saved choice is known.
  useEffect(() => {
    if (settingsLoaded) applyTheme(settings.theme);
  }, [settingsLoaded, settings.theme]);

  // Apply the persisted always-on-top state (restored on restart). Gated on
  // settingsLoaded so we act on the saved value, not the default-false initial.
  useEffect(() => {
    if (settingsLoaded) Window.SetAlwaysOnTop(settings.alwaysOnTop);
  }, [settingsLoaded, settings.alwaysOnTop]);

  const weeklyScopedHasData =
    !!usage?.weekly_scoped &&
    (usage.weekly_scoped.utilization != null || usage.weekly_scoped.resets_at != null);

  // Measure the natural height of the usage content via a ResizeObserver so the
  // window can fit however many bars are shown: one bar is much shorter than
  // two, and the nested weekly sub-bar adds a little. The ref is attached to the
  // .usage-bars container; when it unmounts (settings view / placeholder) the
  // last measurement is retained but unused, since those views size differently.
  const [contentHeight, setContentHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (node) {
      const ro = new ResizeObserver(() => setContentHeight(node.scrollHeight));
      ro.observe(node);
      observerRef.current = ro;
      setContentHeight(node.scrollHeight);
    }
  }, []);

  const sizeMode: SizeMode = (settings.sizeMode as SizeMode) || 'normal';

  // Target native window height. Settings is a fixed tall screen; the usage view
  // fits its measured content plus the fixed chrome around it: #root padding
  // (10) + title bar (34) + .app vertical padding. The padding shrinks with the
  // size mode (see style.css .mode-small / .mode-compact), so the chrome
  // allowance shrinks with it too — these are the same provisional numbers as
  // the CSS padding tweaks and may need retuning together.
  const CHROME_PX: Record<SizeMode, number> = { normal: 96, small: 76, compact: 64 };
  // Low enough that the window can shrink to fit a single compact-mode row;
  // mirrors main.go's MinHeight.
  const MIN_WINDOW_H = 90;
  const usageTarget =
    contentHeight > 0 ? Math.max(MIN_WINDOW_H, Math.round(contentHeight + CHROME_PX[sizeMode])) : 0;
  const targetHeight = usageTarget;

  // The usage view only resizes horizontally by hand — vertical size always
  // tracks measured content (above), so the user's bottom-edge drag is locked
  // out via SetMinSize/SetMaxSize with an equal min/max height (see below).
  const MIN_W = 360; // mirrors main.go's MinWidth
  // Wails treats a MaxWidth of 0 (or negative) as "no constraint": in
  // wails/v3@alpha2.114 pkg/application/webview_window_windows.go's
  // WM_GETMINMAXINFO handler, `mmi.PtMaxTrackSize.X` is only overridden when
  // `width > 0` after scaleWithWindowDPI (and scaleWithWindowDPI(0, h) stays 0
  // regardless of DPI), so passing 0 here leaves width unconstrained while
  // MaxHeight still locks height. Confirmed by reading that source directly
  // rather than assumed — no arbitrarily "large" fallback needed.
  const MAX_W = 0;

  // Wails' Window.SetSize is instant, so we tween it ourselves frame-by-frame
  // for a smooth resize. The first application (and a target of 0, i.e. not yet
  // measured) is snapped without animation.
  const heightRef = useRef<number>(340);
  const animRef = useRef<number | null>(null);
  const resizedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    if (targetHeight <= 0) return;
    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    const from = heightRef.current;
    // Frameless windows report CSS px == DIP, so innerWidth is the window's
    // current DIP width — avoids an async round-trip through Window.Size()
    // and, crucially, preserves whatever width the user dragged the window to
    // instead of snapping it back to a hardcoded value on every height change.
    const width = window.innerWidth;

    // Widen the height lock to bracket both endpoints *before* animating: the
    // tween's intermediate SetSize calls pass every height between `from` and
    // `targetHeight`, and the previous lock (min == max == the old target) would
    // otherwise reject them — most obviously when shrinking, where the old
    // lock's min equals `from` and every smaller in-between frame would be
    // below it. Once we reach the target (either the snap path or the end of
    // the animation) the lock is tightened back to exactly targetHeight so the
    // user can't drag the bottom edge.
    const lo = Math.min(from, targetHeight);
    const hi = Math.max(from, targetHeight);
    Window.SetMinSize(MIN_W, lo);
    Window.SetMaxSize(MAX_W, hi);

    const lockToTarget = () => {
      Window.SetMinSize(MIN_W, targetHeight);
      Window.SetMaxSize(MAX_W, targetHeight);
    };

    if (!resizedOnceRef.current || from === targetHeight) {
      resizedOnceRef.current = true;
      heightRef.current = targetHeight;
      Window.SetSize(width, targetHeight);
      lockToTarget();
      return;
    }
    const duration = 220;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const h = Math.round(from + (targetHeight - from) * eased);
      heightRef.current = h;
      Window.SetSize(width, h);
      if (p < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
        lockToTarget();
      }
    };
    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [targetHeight]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = new Settings({ ...prev, ...patch });
      SettingsService.Set(next).catch((err) => console.error('tempoc: failed to save settings', err));
      return next;
    });
  }, []);

  const locale = resolveLocale(settings.locale);
  const t = getMessages(locale);

  // Usage credits: the API gives a monthly spend limit and the amount spent,
  // both as integers in the currency's minor units, but no reset time and (in
  // practice) no utilization — so the percentage is computed from the pair and
  // the timeline from the UTC calendar month. Like weekly_scoped, the bar and
  // its settings section only appear once a limit has actually been reported.
  // Right after a month rollover the spent figure stays stale until the next
  // refresh lands; the bar itself flips to the new month immediately.
  const credits = usage?.extra_usage;
  const creditsHasData = !!credits && credits.monthly_limit != null;
  // "Show only when needed": credits are what Claude bills once a plan limit is
  // exhausted, so until then the bar is just noise. Needed = the 5-hour or the
  // 7-day window has reached 100%. weekly_scoped is deliberately not counted:
  // it's a sub-limit of the weekly window, not a limit that sends you to
  // credits on its own.
  const creditsNeeded = [usage?.five_hour, usage?.seven_day].some(
    (w) => (w?.utilization ?? 0) >= 100,
  );
  const creditsVisible =
    settings.showCredits && creditsHasData && (!settings.creditsOnlyWhenNeeded || creditsNeeded);
  const creditsDecimals = credits?.decimal_places ?? 2;
  const creditsLimit = credits?.monthly_limit ?? 0;
  const creditsUsed = credits?.used_credits ?? 0;
  const creditsWindow: UsageWindow = {
    utilization: credits?.utilization ?? (creditsLimit > 0 ? (creditsUsed / creditsLimit) * 100 : 0),
    resets_at: nextUtcMonthStart(now),
  };
  // The value cell carries the amounts as well as the percentage — money is the
  // whole point of this bar, and the label column stays a plain window name like
  // every other bar. The currency symbol goes on the spent figure only.
  const creditsUtilText =
    `${formatCredits(creditsUsed, creditsDecimals, locale, credits?.currency ?? undefined)}` +
    `/${formatCredits(creditsLimit, creditsDecimals, locale)}` +
    ` | ${formatUtil(clamp(creditsWindow.utilization ?? 0))}`;

  const lastUpdatedLabel =
    lastUpdated != null ? formatLastUpdated(now - lastUpdated, locale, t) : null;

  // Safety net for a failure that never reports itself. Every known failure
  // path posts tempoc:fetch-error, but a path we haven't found (or a dropped
  // event) would leave the last figures on screen with nothing marking them as
  // old — only the title bar's "N min ago" creeping up, which is easy to miss.
  // Auto refresh runs every `refreshInterval` minutes, so two intervals with no
  // new data means refreshing has stopped working whatever the reason.
  // Skipped when auto refresh is off (0): with only the manual button there is
  // no expected update to be late for.
  const staleAfterMs = settings.refreshInterval > 0 ? settings.refreshInterval * 60_000 * 2 : 0;
  const stale = staleAfterMs > 0 && lastUpdated != null && now - lastUpdated > staleAfterMs;

  const rootModeClass = sizeMode === 'small' ? ' mode-small' : sizeMode === 'compact' ? ' mode-compact' : '';

  // Same path as the title bar's refresh button: ask the interceptor to fetch
  // again. Success clears the modal (a usage event arrives); another failure
  // re-reports the error and leaves the displayed figures untouched.
  const retryFetch = () => {
    setRetrying(true);
    Events.Emit('tempoc:refresh');
  };

  return (
    <div className={`root${rootModeClass}`}>
      <TitleBar
        onOpenSettings={() => Events.Emit('tempoc:open-settings')}
        onRefresh={() => Events.Emit('tempoc:refresh')}
        onTop={settings.alwaysOnTop}
        onToggleOnTop={() => updateSettings({ alwaysOnTop: !settings.alwaysOnTop })}
        lastUpdatedLabel={lastUpdatedLabel}
        t={t}
      />
      <main className="app">
        {authRequired ? (
          // Takes precedence over any stale usage data: once the interceptor
          // reports the session is gone (401 or a /login redirect), the bars
          // would only show outdated numbers, so fall back to the login prompt.
          <div className="app-placeholder">
            {t.loginRequired}
            <br />
            <button className="login-button" onClick={() => Events.Emit('tempoc:login')}>
              {t.loginToClaude}
            </button>
          </div>
        ) : !usage ? (
          <p className="app-placeholder">
            {t.waitingForUsage}<span className="loading-dots" aria-hidden="true" />
          </p>
        ) : (
          <div className="usage-bars" ref={measureRef}>
            {settings.showHour5 && (
              <UsageBar label={t.currentSession} kind="five_hour" data={usage.five_hour} now={now} settings={settings} sizeMode={sizeMode} locale={locale} t={t} />
            )}
            {settings.showDay7 ? (
              <UsageBar
                label={t.weeklyLimit}
                kind="seven_day"
                data={usage.seven_day}
                now={now}
                settings={settings}
                sizeMode={sizeMode}
                locale={locale}
                t={t}
                secondary={
                  settings.showWeeklyScoped && weeklyScopedHasData
                    ? { label: settings.weeklyScopedLabel || t.weeklyScopedFallback, kind: 'weekly_scoped', data: usage.weekly_scoped }
                    : undefined
                }
              />
            ) : (
              settings.showWeeklyScoped &&
              weeklyScopedHasData && (
                <UsageBar
                  label={settings.weeklyScopedLabel || t.weeklyScopedFallback}
                  kind="weekly_scoped"
                  data={usage.weekly_scoped}
                  now={now}
                  settings={settings}
                  sizeMode={sizeMode}
                  locale={locale}
                  t={t}
                />
              )
            )}
            {creditsVisible && (
              <UsageBar label={t.creditsLabel} kind="credits" data={creditsWindow} now={now} settings={settings} sizeMode={sizeMode} utilText={creditsUtilText} locale={locale} t={t} />
            )}
          </div>
        )}
      </main>
      {/* Claude can't be read. Covers the content area (the title bar stays
          usable, so the window can still be moved, pinned or closed) with a
          single centred retry — the numbers underneath are the last known
          truth, deliberately left intact but no longer being updated, and the
          overlay is what stops them from being read as current. Not rendered
          when the session is gone: the login prompt owns that case, and
          auth-required clears fetchError anyway. Also raised by `stale`, with
          a softer wording: nothing reported a failure, we only know the
          figures stopped being refreshed. */}
      {(fetchError != null || stale) && !authRequired && (
        <div
          className="error-modal-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="fetch-error-title"
        >
          <div className="error-modal">
            <span className="error-modal-icon" aria-hidden="true">!</span>
            <p className="error-modal-text" id="fetch-error-title" title={fetchError || undefined}>
              {fetchError != null ? t.fetchError : t.staleUsage}
            </p>
            <button className="error-modal-retry" onClick={retryFetch} disabled={retrying}>
              {t.retry}
              {retrying && <span className="loading-dots" aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Every window loaded by this app shares one entry point (main.tsx), so the
// settings window (main.go's settingsWin, loaded at "/?window=settings")
// is routed here by URL query rather than needing its own HTML entry.
function App() {
  const isSettingsWindow = new URLSearchParams(location.search).get('window') === 'settings';
  return isSettingsWindow ? <SettingsWindow /> : <MainWindow />;
}

export default App
