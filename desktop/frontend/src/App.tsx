import { useState, useEffect, useCallback, useRef } from 'react'
import { Events, Window } from '@wailsio/runtime'
import { SettingsService } from '../bindings/changeme'
import { Settings } from '../bindings/changeme/settings'

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
// --wails-draggable: no-drag. The gear toggles the settings view.
function TitleBar({ settingsOpen, onToggleSettings, onRefresh, onTop, onToggleOnTop, lastUpdatedLabel }: { settingsOpen: boolean; onToggleSettings: () => void; onRefresh: () => void; onTop: boolean; onToggleOnTop: () => void; lastUpdatedLabel: string | null }) {
  return (
    <header className="titlebar" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
      <div className="titlebar-left" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <button
          className={`titlebar-gear${settingsOpen ? ' is-active' : ''}`}
          aria-label="Settings"
          title="Settings"
          onClick={onToggleSettings}
        >
          <GearIcon />
        </button>
        <button
          className="titlebar-refresh"
          aria-label="Refresh"
          title="Refresh usage"
          onClick={onRefresh}
        >
          <RefreshIcon />
        </button>
        {lastUpdatedLabel && (
          <span className="titlebar-updated" style={{ '--wails-draggable': 'drag' } as React.CSSProperties} title="When the displayed usage was last fetched">
            Updated {lastUpdatedLabel}
          </span>
        )}
      </div>
      <div className="titlebar-controls" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <button
          className={`pin${onTop ? ' is-active' : ''}`}
          aria-label="Always on top"
          aria-pressed={onTop}
          title={onTop ? 'Always on top: on' : 'Always on top: off'}
          onClick={onToggleOnTop}
        >
          <PinIcon />
        </button>
        <button aria-label="Minimise" onClick={() => Window.Minimise()}>&#x2015;</button>
        <button aria-label="Close" className="close" onClick={() => Window.Close()}>&#x2715;</button>
      </div>
    </header>
  );
}

// TEMPOC theme colours (see options.html --color-accent/warning/danger).
const COLORS = { accent: '#7dd3fc', warning: '#fbbf24', danger: '#ef4444' };

// A dual-thumb range slider: warning is clamped to stay <= danger and vice
// versa, with a gradient fill mirroring the extension's options.js
// setupDualRange visual (accent -> warning -> danger).
function DualRange({
  min,
  max,
  warning,
  danger,
  onChange,
}: {
  min: number;
  max: number;
  warning: number;
  danger: number;
  onChange: (warning: number, danger: number) => void;
}) {
  const range = max - min;
  const wPct = ((warning - min) / range) * 100;
  const dPct = ((danger - min) / range) * 100;

  const handleWarning = (e: React.ChangeEvent<HTMLInputElement>) => {
    const w = Number(e.target.value);
    onChange(w, Math.max(w, danger));
  };
  const handleDanger = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = Number(e.target.value);
    onChange(Math.min(warning, d), d);
  };

  return (
    <div className="dual-range">
      <div className="dual-range-values">
        <span className="dual-range-warning">Warning: <b>{warning}</b></span>
        <span className="dual-range-danger">Danger: <b>{danger}</b></span>
      </div>
      <div className="dual-range-track">
        <div
          className="dual-range-fill"
          style={{
            background: `linear-gradient(to right, ${COLORS.accent} 0%, ${COLORS.accent} ${wPct}%, ${COLORS.warning} ${wPct}%, ${COLORS.warning} ${dPct}%, ${COLORS.danger} ${dPct}%, ${COLORS.danger} 100%)`,
          }}
        />
        <input
          type="range"
          className="dual-range-input"
          min={min}
          max={max}
          value={warning}
          onChange={handleWarning}
          style={{ zIndex: warning >= danger ? 5 : undefined }}
        />
        <input
          type="range"
          className="dual-range-input"
          min={min}
          max={max}
          value={danger}
          onChange={handleDanger}
        />
      </div>
    </div>
  );
}

// Settings view: houses configuration and debug controls. All changes update
// React state immediately (so bars re-render live) and persist via
// SettingsService.Set.
function SettingsView({
  settings,
  onUpdate,
  hasWeeklyScoped,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  hasWeeklyScoped: boolean;
}) {
  const toggleClaude = () => {
    Events.Emit('tempoc:toggle-claude');
  };

  return (
    <div className="settings">
      <h2 className="settings-title">Settings</h2>

      <section className="settings-section">
        <h3 className="settings-section-title">5-Hour Window</h3>
        <label className="settings-check-row">
          <span>Show</span>
          <input type="checkbox" checked={settings.showHour5} onChange={(e) => onUpdate({ showHour5: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>Show remaining time</span>
          <input type="checkbox" checked={settings.showRemainHour5} onChange={(e) => onUpdate({ showRemainHour5: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>Color threshold</span>
          <input type="checkbox" checked={settings.hour5ColorEnabled} onChange={(e) => onUpdate({ hour5ColorEnabled: e.target.checked })} />
        </label>
        <DualRange
          min={-50}
          max={50}
          warning={settings.hour5Warning}
          danger={settings.hour5Danger}
          onChange={(w, d) => onUpdate({ hour5Warning: w, hour5Danger: d })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">7-Day Window</h3>
        <label className="settings-check-row">
          <span>Show</span>
          <input type="checkbox" checked={settings.showDay7} onChange={(e) => onUpdate({ showDay7: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>Show remaining time</span>
          <input type="checkbox" checked={settings.showRemainDay7} onChange={(e) => onUpdate({ showRemainDay7: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>Color threshold</span>
          <input type="checkbox" checked={settings.day7ColorEnabled} onChange={(e) => onUpdate({ day7ColorEnabled: e.target.checked })} />
        </label>
        <DualRange
          min={-50}
          max={50}
          warning={settings.day7Warning}
          danger={settings.day7Danger}
          onChange={(w, d) => onUpdate({ day7Warning: w, day7Danger: d })}
        />
      </section>

      {hasWeeklyScoped && (
        <section className="settings-section">
          <h3 className="settings-section-title">Weekly (scoped) Window</h3>
          <label className="settings-row">
            <span>Label</span>
            <input
              type="text"
              className="settings-text-input"
              value={settings.weeklyScopedLabel}
              placeholder="Weekly (scoped)"
              onChange={(e) => onUpdate({ weeklyScopedLabel: e.target.value })}
            />
          </label>
          <label className="settings-check-row">
            <span>Show</span>
            <input type="checkbox" checked={settings.showWeeklyScoped} onChange={(e) => onUpdate({ showWeeklyScoped: e.target.checked })} />
          </label>
          <label className="settings-check-row">
            <span>Show remaining time</span>
            <input type="checkbox" checked={settings.showRemainWeeklyScoped} onChange={(e) => onUpdate({ showRemainWeeklyScoped: e.target.checked })} />
          </label>
          <label className="settings-check-row">
            <span>Color threshold</span>
            <input type="checkbox" checked={settings.weeklyScopedColorEnabled} onChange={(e) => onUpdate({ weeklyScopedColorEnabled: e.target.checked })} />
          </label>
          <DualRange
            min={-50}
            max={50}
            warning={settings.weeklyScopedWarning}
            danger={settings.weeklyScopedDanger}
            onChange={(w, d) => onUpdate({ weeklyScopedWarning: w, weeklyScopedDanger: d })}
          />
        </section>
      )}

      <section className="settings-section">
        <h3 className="settings-section-title">General</h3>
        <label className="settings-check-row">
          <span>Transparent window</span>
          <input
            type="checkbox"
            checked={settings.transparent}
            onChange={(e) => onUpdate({ transparent: e.target.checked })}
          />
        </label>
        <label className="settings-row">
          <span>Language</span>
          <select value={settings.locale} onChange={(e) => onUpdate({ locale: e.target.value })}>
            <option value="">Auto (system)</option>
            <option value="en-US">English</option>
            <option value="ja-JP">日本語</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Duration style</span>
          <select value={settings.durationStyle} onChange={(e) => onUpdate({ durationStyle: e.target.value })}>
            <option value="narrow">Narrow (3d 4h)</option>
            <option value="short">Short (3 days 4 hr.)</option>
            <option value="long">Long (3 days 4 hours)</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Decimal places</span>
          <select value={settings.decimalPlaces} onChange={(e) => onUpdate({ decimalPlaces: Number(e.target.value) })}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Percent format</span>
          <input
            type="text"
            className="settings-text-input"
            value={settings.percentFormat}
            onChange={(e) => onUpdate({ percentFormat: e.target.value || '{}%' })}
          />
        </label>
        <div className="settings-row settings-row--refresh">
          <label className="settings-row settings-row--nogap">
            <span>Auto-refresh</span>
            <input
              type="checkbox"
              checked={settings.refreshInterval > 0}
              onChange={(e) => onUpdate({ refreshInterval: e.target.checked ? 2 : 0 })}
            />
            <input
              type="number"
              className="settings-number-input"
              min={1}
              max={60}
              value={settings.refreshInterval > 0 ? settings.refreshInterval : 2}
              disabled={settings.refreshInterval <= 0}
              onChange={(e) => onUpdate({ refreshInterval: Number(e.target.value) })}
            />
            <span className="settings-unit">min</span>
          </label>
          <div className="settings-help-text">Takes effect on next app launch.</div>
        </div>
        <div className="settings-row">
          <span>Utilization floor</span>
        </div>
        <DualRange
          min={0}
          max={100}
          warning={settings.utilizationWarning}
          danger={settings.utilizationDanger}
          onChange={(w, d) => onUpdate({ utilizationWarning: w, utilizationDanger: d })}
        />
      </section>

      <div className="settings-row settings-debug-row">
        <div>
          <div className="settings-row-label">Claude interceptor window</div>
          <div className="settings-row-desc">Show the hidden Claude page for login or debugging.</div>
        </div>
        <button className="settings-btn" onClick={toggleClaude}>Toggle</button>
      </div>
    </div>
  );
}

type UsageWindow = { utilization?: number; resets_at?: string | null };
type WindowKind = 'five_hour' | 'seven_day' | 'weekly_scoped';
type UsagePayload = {
  seven_day?: UsageWindow;
  five_hour?: UsageWindow;
  // weekly_scoped is a newer window Claude added; may be absent/temporary.
  weekly_scoped?: UsageWindow;
};

// Length of each usage window in milliseconds. The window start is derived by
// subtracting this from resets_at (the window end), matching the Chrome
// extension's calculation. weekly_scoped is treated as a 7-day window.
const WINDOW_MS: Record<WindowKind, number> = {
  five_hour: 5 * 60 * 60 * 1000,
  seven_day: 7 * 24 * 60 * 60 * 1000,
  weekly_scoped: 7 * 24 * 60 * 60 * 1000,
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

// Effective locale for date/duration formatting: the explicit setting, or the
// OS/browser locale when set to "auto" (empty).
const resolveLocale = (settings: Settings): string => settings.locale || navigator.language;

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
// back to a simple "1d 3h 20m" string when unsupported or given bad input.
function formatRemaining(ms: number, durationStyle: string, locale: string): string {
  if (ms < 0) ms = 0;
  const duration = {
    days: Math.floor(ms / (1000 * 60 * 60 * 24)),
    hours: Math.floor((ms / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((ms / (1000 * 60)) % 60),
  };
  try {
    const DurationFormat = (Intl as unknown as { DurationFormat?: new (locale: string, opts: { style: string }) => { format: (d: typeof duration) => string } }).DurationFormat;
    if (!DurationFormat) throw new Error('Intl.DurationFormat unsupported');
    const df = new DurationFormat(locale, { style: durationStyle });
    return df.format(duration);
  } catch {
    const parts: string[] = [];
    if (duration.days) parts.push(`${duration.days}d`);
    if (duration.days || duration.hours) parts.push(`${duration.hours}h`);
    parts.push(`${duration.minutes}m`);
    return parts.join(' ');
  }
}

// Format how long ago the usage data was last received, as a localized
// relative string (e.g. "5 sec. ago", "2 min. ago"). Uses the same `now` tick
// that drives the Elapsed bars, so it stays fresh without re-fetching. Falls
// back to a plain English string when Intl.RelativeTimeFormat is unavailable.
function formatLastUpdated(sinceMs: number, locale: string): string {
  const sec = Math.max(0, Math.floor(sinceMs / 1000));
  const pick = (): [number, Intl.RelativeTimeFormatUnit] => {
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
    return value === 0 ? 'just now' : `${value} ${unit}${value === 1 ? '' : 's'} ago`;
  }
}

// Format the window's reset moment as a localized date/time (ported from
// content.js: month/day/weekday + hour/minute). This is the value that isn't
// shown on Claude's own usage page — knowing exactly which day and hour the
// window resets is the point of this app.
function formatResetDate(d: Date, locale: string): string {
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

// Per-window color thresholds / remaining-time preference.
function pickCfg(kind: WindowKind, s: Settings) {
  if (kind === 'five_hour')
    return { colorEnabled: s.hour5ColorEnabled, danger: s.hour5Danger, warning: s.hour5Warning, showRemain: s.showRemainHour5 };
  if (kind === 'seven_day')
    return { colorEnabled: s.day7ColorEnabled, danger: s.day7Danger, warning: s.day7Warning, showRemain: s.showRemainDay7 };
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
}: {
  label: string;
  kind: WindowKind;
  data: UsageWindow | undefined;
  now: number;
  settings: Settings;
  secondary?: { label: string; kind: WindowKind; data: UsageWindow | undefined };
}) {
  const util = clamp(data?.utilization ?? 0);
  const resets = data?.resets_at ? new Date(data.resets_at) : null;

  let elapsed = 0;
  let remainMs = 0;
  let started = false;
  if (resets && !Number.isNaN(resets.getTime())) {
    started = true;
    const end = resets.getTime();
    const start = end - WINDOW_MS[kind];
    elapsed = clamp(((now - start) / (end - start)) * 100);
    remainMs = end - now;
  }

  const color = computeColor(util, elapsed, kind, settings);
  const showRemain = pickCfg(kind, settings).showRemain;

  // secondary shares this window's elapsed timeline; only label/util/color differ.
  const secUtil = secondary ? clamp(secondary.data?.utilization ?? 0) : 0;
  const secColor = secondary ? computeColor(secUtil, elapsed, secondary.kind, settings) : '';

  return (
    <div className="usage-bar">
      <div className="usage-bar-head">
        <span className="usage-bar-label">{label}</span>
        <span className="usage-bar-reset">{started && resets ? formatResetDate(resets, resolveLocale(settings)) : ''}</span>
        <span className="usage-bar-util" style={{ color }}>{formatUtil(util)}</span>
      </div>
      <div className="usage-bar-track-wrap">
        <div className="usage-bar-track">
          <div className="usage-bar-fill" style={{ width: `${util}%`, background: color }} />
        </div>
        {started && (
          <div className="usage-bar-marker" style={{ left: `${elapsed}%` }} title={`Elapsed ${formatPercent(elapsed, settings)}`} />
        )}
      </div>

      {secondary && (
        <>
          <div className="usage-bar-head usage-bar-head--sub">
            <span className="usage-bar-label">{secondary.label}</span>
            <span className="usage-bar-reset" />
            <span className="usage-bar-util" style={{ color: secColor }}>{formatUtil(secUtil)}</span>
          </div>
          <div className="usage-bar-track-wrap">
            <div className="usage-bar-track">
              <div className="usage-bar-fill" style={{ width: `${secUtil}%`, background: secColor }} />
            </div>
            {started && <div className="usage-bar-marker" style={{ left: `${elapsed}%` }} />}
          </div>
        </>
      )}

      <div className="usage-bar-foot">
        <span>Elapsed {started ? formatPercent(elapsed, settings) : '—'}</span>
        <span>
          {started
            ? showRemain
              ? `resets in ${formatRemaining(remainMs, settings.durationStyle, resolveLocale(settings))}`
              : ''
            : 'not started'}
        </span>
      </div>
    </div>
  );
}

function App() {
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settings, setSettings] = useState<Settings>(() => new Settings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    SettingsService.Get().then((s) => {
      setSettings(s);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    const off = Events.On('tempoc:usage', (e: any) => {
      setUsage(e.data as UsagePayload);
      setLastUpdated(Date.now());
    });
    // Recompute elapsed-time progress once per second.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      if (typeof off === 'function') off();
    };
  }, []);

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

  // Target native window height. Settings is a fixed tall screen; the usage view
  // fits its measured content plus the fixed chrome around it: #root padding
  // (10) + title bar (34) + .app vertical padding (~52) ≈ 96px. Clamped to the
  // window's MinHeight so a shrink never desyncs from what the OS applies.
  const CHROME_PX = 96;
  const MIN_WINDOW_H = 160;
  const usageTarget =
    contentHeight > 0 ? Math.max(MIN_WINDOW_H, Math.round(contentHeight + CHROME_PX)) : 0;
  const targetHeight = settingsOpen ? 800 : usageTarget;

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
    if (!resizedOnceRef.current || from === targetHeight) {
      resizedOnceRef.current = true;
      heightRef.current = targetHeight;
      Window.SetSize(520, targetHeight);
      return;
    }
    const duration = 220;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const h = Math.round(from + (targetHeight - from) * eased);
      heightRef.current = h;
      Window.SetSize(520, h);
      animRef.current = p < 1 ? requestAnimationFrame(step) : null;
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

  const lastUpdatedLabel =
    lastUpdated != null ? formatLastUpdated(now - lastUpdated, resolveLocale(settings)) : null;

  return (
    <div className="root">
      <TitleBar
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        onRefresh={() => Events.Emit('tempoc:refresh')}
        onTop={settings.alwaysOnTop}
        onToggleOnTop={() => updateSettings({ alwaysOnTop: !settings.alwaysOnTop })}
        lastUpdatedLabel={lastUpdatedLabel}
      />
      <main className="app">
        {settingsOpen ? (
          settingsLoaded && (
            <SettingsView
              settings={settings}
              onUpdate={updateSettings}
              hasWeeklyScoped={weeklyScopedHasData}
            />
          )
        ) : !usage ? (
          <p className="app-placeholder">
            Waiting for usage data<span className="loading-dots" aria-hidden="true" />
            <br />
            <span className="app-placeholder-hint">(log in to Claude if prompted)</span>
          </p>
        ) : (
          <div className="usage-bars" ref={measureRef}>
            {settings.showHour5 && (
              <UsageBar label="Current session" kind="five_hour" data={usage.five_hour} now={now} settings={settings} />
            )}
            {settings.showDay7 ? (
              <UsageBar
                label="Weekly limit"
                kind="seven_day"
                data={usage.seven_day}
                now={now}
                settings={settings}
                secondary={
                  settings.showWeeklyScoped && weeklyScopedHasData
                    ? { label: settings.weeklyScopedLabel || 'Weekly (scoped)', kind: 'weekly_scoped', data: usage.weekly_scoped }
                    : undefined
                }
              />
            ) : (
              settings.showWeeklyScoped &&
              weeklyScopedHasData && (
                <UsageBar
                  label={settings.weeklyScopedLabel || 'Weekly (scoped)'}
                  kind="weekly_scoped"
                  data={usage.weekly_scoped}
                  now={now}
                  settings={settings}
                />
              )
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App
