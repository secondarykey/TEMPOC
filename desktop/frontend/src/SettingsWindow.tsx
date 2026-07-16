import { useEffect, useState } from 'react'
import { Events, Window } from '@wailsio/runtime'
import { SettingsService } from '../bindings/changeme'
import { Settings } from '../bindings/changeme/settings'
import { COLORS, applyTheme } from './theme'

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
export function SettingsView({
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
      <section className="settings-section">
        <h3 className="settings-section-title">General</h3>
        <label className="settings-row">
          <span>Theme</span>
          <select value={settings.theme || 'system'} onChange={(e) => onUpdate({ theme: e.target.value })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Size mode</span>
          <select value={settings.sizeMode || 'normal'} onChange={(e) => onUpdate({ sizeMode: e.target.value })}>
            <option value="normal">Normal</option>
            <option value="small">Small</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Transparent window</span>
          <input
            type="checkbox"
            checked={settings.transparent}
            onChange={(e) => onUpdate({ transparent: e.target.checked })}
          />
        </label>
        <label className="settings-row">
          <span>Auto-refresh</span>
          <span className="settings-row-controls">
            <input
              type="checkbox"
              checked={settings.refreshInterval > 0}
              onChange={(e) => onUpdate({ refreshInterval: e.target.checked ? 5 : 0 })}
            />
            <input
              type="number"
              className="settings-number-input"
              min={1}
              max={60}
              value={settings.refreshInterval > 0 ? settings.refreshInterval : 5}
              disabled={settings.refreshInterval <= 0}
              onChange={(e) => onUpdate({ refreshInterval: Number(e.target.value) })}
            />
            <span className="settings-unit">min</span>
          </span>
        </label>
        <div className="settings-help-text">Takes effect on next app launch.</div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Formatting</h3>
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
      </section>

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
          <label className="settings-check-row">
            <span>Show</span>
            <input type="checkbox" checked={settings.showWeeklyScoped} onChange={(e) => onUpdate({ showWeeklyScoped: e.target.checked })} />
          </label>
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
        <h3 className="settings-section-title">Utilization Threshold</h3>
        <div className="settings-help-text">Forces warning/danger colors when absolute usage reaches these values.</div>
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

// Custom title bar for the settings window, mirroring App.tsx's TitleBar
// (same .titlebar / .titlebar-controls classes and drag-region pattern) but
// with a plain text label instead of the usage window's icon buttons, and a
// single close control — there's nothing to pin or refresh here.
function SettingsTitleBar() {
  return (
    <header className="titlebar" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
      <div className="titlebar-left" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <span className="titlebar-title">Settings</span>
      </div>
      <div className="titlebar-controls" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <button aria-label="Close" className="close" onClick={() => Window.Close()}>&#x2715;</button>
      </div>
    </header>
  );
}

// Root component for the settings window (a separate JS context from the
// main window — see App.tsx's router). Settings are edited as a local draft
// and only committed via SettingsService.Set when the user clicks Apply;
// closing (or the main window's Windows-close semantics, which just hide
// this window per main.go) discards any unsaved draft. The main window
// picks up the change by re-fetching settings on tempoc:settings-applied.
export default function SettingsWindow() {
  const [draft, setDraft] = useState<Settings>(() => new Settings());
  const [loaded, setLoaded] = useState(false);
  // Flag-based dirty tracking (set true on first edit) rather than a
  // deep-equal comparison against the last-loaded settings — simpler, and
  // "the user touched something" is all the Apply button needs to know.
  const [dirty, setDirty] = useState(false);
  const [hasWeeklyScoped, setHasWeeklyScoped] = useState(false);

  useEffect(() => {
    const reload = () => {
      SettingsService.Get().then((s) => {
        setDraft(s);
        setDirty(false);
        setLoaded(true);
        // This window renders with the *saved* theme, not the draft's: like
        // every other setting, a theme picked in the select only takes effect
        // on Apply (see apply()), and reopening discards it with the draft.
        applyTheme(s.theme);
      });
    };
    // Hidden -> Show (main.go's settingsWin) does not remount this
    // component, so the initial load alone wouldn't catch settings changed
    // elsewhere (e.g. the main window's always-on-top pin) between closes.
    // Reloading on every tempoc:open-settings also implements the discard-
    // on-close behaviour: the draft is always reset to the saved value the
    // next time the window is opened.
    reload();
    const offOpen = Events.On('tempoc:open-settings', reload);
    // Same condition as MainWindow's weeklyScopedHasData (App.tsx): the
    // Weekly (scoped) section only appears once real data has been seen.
    const offUsage = Events.On('tempoc:usage', (e: any) => {
      const usage = e.data as { weekly_scoped?: { utilization?: number; resets_at?: string | null } };
      setHasWeeklyScoped(
        !!usage?.weekly_scoped &&
          (usage.weekly_scoped.utilization != null || usage.weekly_scoped.resets_at != null)
      );
    });
    return () => {
      if (typeof offOpen === 'function') offOpen();
      if (typeof offUsage === 'function') offUsage();
    };
  }, []);

  const updateDraft = (patch: Partial<Settings>) => {
    setDraft((prev) => new Settings({ ...prev, ...patch }));
    setDirty(true);
  };

  const apply = async () => {
    try {
      // Read the current saved value first and carry its alwaysOnTop
      // forward instead of the draft's: the main window's pin button saves
      // alwaysOnTop immediately (it's the only setting written outside this
      // draft/apply flow), so applying a draft opened before a pin toggle
      // would otherwise silently revert the pin.
      const current = await SettingsService.Get();
      const next = new Settings({ ...draft, alwaysOnTop: current.alwaysOnTop });
      await SettingsService.Set(next);
      setDraft(next);
      setDirty(false);
      // The main window picks the new theme up via tempoc:settings-applied;
      // this window is its own JS context, so apply it here too.
      applyTheme(next.theme);
      Events.Emit('tempoc:settings-applied');
    } catch (err) {
      console.error('tempoc: failed to apply settings', err);
    }
  };

  return (
    <div className="root">
      <SettingsTitleBar />
      <main className="app">
        {loaded && <SettingsView settings={draft} onUpdate={updateDraft} hasWeeklyScoped={hasWeeklyScoped} />}
      </main>
      <footer className="settings-footer">
        <button className="settings-btn" onClick={() => Window.Close()}>Close</button>
        <button className="settings-btn settings-apply" disabled={!dirty || !loaded} onClick={apply}>Apply</button>
      </footer>
    </div>
  );
}
