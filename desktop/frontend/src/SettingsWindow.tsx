import { Events } from '@wailsio/runtime'
import { Settings } from '../bindings/changeme/settings'
import { COLORS } from './theme'

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
          <span>Size mode</span>
          <select value={settings.sizeMode || 'normal'} onChange={(e) => onUpdate({ sizeMode: e.target.value })}>
            <option value="normal">Normal</option>
            <option value="small">Small</option>
            <option value="compact">Compact</option>
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
