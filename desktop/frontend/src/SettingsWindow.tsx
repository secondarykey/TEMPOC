import { useEffect, useState } from 'react'
import { Events, Window } from '@wailsio/runtime'
import { SettingsService } from '../bindings/changeme'
import { Settings } from '../bindings/changeme/settings'
import { COLORS, applyTheme } from './theme'
import { resolveLocale, getMessages, type Messages } from './i18n'

// A dual-thumb range slider: warning is clamped to stay <= danger and vice
// versa, with a gradient fill mirroring the extension's options.js
// setupDualRange visual (accent -> warning -> danger).
function DualRange({
  min,
  max,
  warning,
  danger,
  onChange,
  t,
}: {
  min: number;
  max: number;
  warning: number;
  danger: number;
  onChange: (warning: number, danger: number) => void;
  t: Messages;
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
        <span className="dual-range-warning">{t.warning}: <b>{warning}</b></span>
        <span className="dual-range-danger">{t.danger}: <b>{danger}</b></span>
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

  // The settings window renders in the draft's language, so picking a
  // language previews immediately here; the main window only follows on
  // Apply, like every other setting.
  const t = getMessages(resolveLocale(settings.locale));

  return (
    <div className="settings">
      <section className="settings-section">
        <h3 className="settings-section-title">{t.sectionGeneral}</h3>
        <label className="settings-row">
          <span>{t.theme}</span>
          <select value={settings.theme || 'system'} onChange={(e) => onUpdate({ theme: e.target.value })}>
            <option value="system">{t.themeSystem}</option>
            <option value="light">{t.themeLight}</option>
            <option value="dark">{t.themeDark}</option>
          </select>
        </label>
        <label className="settings-row">
          <span>{t.sizeMode}</span>
          <select value={settings.sizeMode || 'normal'} onChange={(e) => onUpdate({ sizeMode: e.target.value })}>
            <option value="normal">{t.sizeNormal}</option>
            <option value="small">{t.sizeSmall}</option>
            <option value="compact">{t.sizeCompact}</option>
          </select>
        </label>
        <label className="settings-row">
          <span>{t.transparentWindow}</span>
          <input
            type="checkbox"
            checked={settings.transparent}
            onChange={(e) => onUpdate({ transparent: e.target.checked })}
          />
        </label>
        <label className="settings-row">
          <span>{t.autoRefresh}</span>
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
            <span className="settings-unit">{t.minutesUnit}</span>
          </span>
        </label>
        <div className="settings-help-text">{t.nextLaunchNote}</div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">{t.sectionFormatting}</h3>
        <label className="settings-row">
          <span>{t.language}</span>
          {/* Language names are the site's own region-qualified endonyms
              (e.g. "English (United States)", "日本語 (日本)") — copied verbatim
              from claude.ai, including its casing/spacing, so users find the
              exact label they see on the site. */}
          <select value={settings.locale} onChange={(e) => onUpdate({ locale: e.target.value })}>
            <option value="">{t.languageAuto}</option>
            <option value="en-US">English (United States)</option>
            <option value="ja-JP">日本語 (日本)</option>
            <option value="fr-FR">français (France)</option>
            <option value="de-DE">Deutsch (Deutschland)</option>
            <option value="hi-IN">हिन्दी (भारत)</option>
            <option value="id-ID">Indonesia (Indonesia)</option>
            <option value="it-IT">italiano (Italia)</option>
            <option value="ko-KR">한국어(대한민국)</option>
            <option value="pt-BR">português (Brasil)</option>
            <option value="es-419">español (Latinoamérica)</option>
            <option value="es-ES">español (España)</option>
          </select>
        </label>
        <label className="settings-row">
          <span>{t.durationStyle}</span>
          <select value={settings.durationStyle} onChange={(e) => onUpdate({ durationStyle: e.target.value })}>
            <option value="narrow">{t.durationNarrow}</option>
            <option value="short">{t.durationShort}</option>
            <option value="long">{t.durationLong}</option>
          </select>
        </label>
        <label className="settings-row">
          <span>{t.decimalPlaces}</span>
          <select value={settings.decimalPlaces} onChange={(e) => onUpdate({ decimalPlaces: Number(e.target.value) })}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label className="settings-row">
          <span>{t.percentFormat}</span>
          <input
            type="text"
            className="settings-text-input"
            value={settings.percentFormat}
            onChange={(e) => onUpdate({ percentFormat: e.target.value || '{}%' })}
          />
        </label>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">{t.sectionHour5}</h3>
        <label className="settings-check-row">
          <span>{t.show}</span>
          <input type="checkbox" checked={settings.showHour5} onChange={(e) => onUpdate({ showHour5: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>{t.showRemaining}</span>
          <input type="checkbox" checked={settings.showRemainHour5} onChange={(e) => onUpdate({ showRemainHour5: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>{t.colorThreshold}</span>
          <input type="checkbox" checked={settings.hour5ColorEnabled} onChange={(e) => onUpdate({ hour5ColorEnabled: e.target.checked })} />
        </label>
        <DualRange
          min={-50}
          max={50}
          warning={settings.hour5Warning}
          danger={settings.hour5Danger}
          onChange={(w, d) => onUpdate({ hour5Warning: w, hour5Danger: d })}
          t={t}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">{t.sectionDay7}</h3>
        <label className="settings-check-row">
          <span>{t.show}</span>
          <input type="checkbox" checked={settings.showDay7} onChange={(e) => onUpdate({ showDay7: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>{t.showRemaining}</span>
          <input type="checkbox" checked={settings.showRemainDay7} onChange={(e) => onUpdate({ showRemainDay7: e.target.checked })} />
        </label>
        <label className="settings-check-row">
          <span>{t.colorThreshold}</span>
          <input type="checkbox" checked={settings.day7ColorEnabled} onChange={(e) => onUpdate({ day7ColorEnabled: e.target.checked })} />
        </label>
        <DualRange
          min={-50}
          max={50}
          warning={settings.day7Warning}
          danger={settings.day7Danger}
          onChange={(w, d) => onUpdate({ day7Warning: w, day7Danger: d })}
          t={t}
        />
      </section>

      {hasWeeklyScoped && (
        <section className="settings-section">
          <h3 className="settings-section-title">{t.sectionWeeklyScoped}</h3>
          <label className="settings-check-row">
            <span>{t.show}</span>
            <input type="checkbox" checked={settings.showWeeklyScoped} onChange={(e) => onUpdate({ showWeeklyScoped: e.target.checked })} />
          </label>
          <label className="settings-row">
            <span>{t.labelField}</span>
            <input
              type="text"
              className="settings-text-input"
              value={settings.weeklyScopedLabel}
              placeholder={t.weeklyScopedFallback}
              onChange={(e) => onUpdate({ weeklyScopedLabel: e.target.value })}
            />
          </label>
          <label className="settings-check-row">
            <span>{t.showRemaining}</span>
            <input type="checkbox" checked={settings.showRemainWeeklyScoped} onChange={(e) => onUpdate({ showRemainWeeklyScoped: e.target.checked })} />
          </label>
          <label className="settings-check-row">
            <span>{t.colorThreshold}</span>
            <input type="checkbox" checked={settings.weeklyScopedColorEnabled} onChange={(e) => onUpdate({ weeklyScopedColorEnabled: e.target.checked })} />
          </label>
          <DualRange
            min={-50}
            max={50}
            warning={settings.weeklyScopedWarning}
            danger={settings.weeklyScopedDanger}
            onChange={(w, d) => onUpdate({ weeklyScopedWarning: w, weeklyScopedDanger: d })}
            t={t}
          />
        </section>
      )}

      <section className="settings-section">
        <h3 className="settings-section-title">{t.sectionUtilization}</h3>
        <div className="settings-help-text">{t.utilizationHelp}</div>
        <DualRange
          min={0}
          max={100}
          warning={settings.utilizationWarning}
          danger={settings.utilizationDanger}
          onChange={(w, d) => onUpdate({ utilizationWarning: w, utilizationDanger: d })}
          t={t}
        />
      </section>

      <div className="settings-row settings-debug-row">
        <div>
          <div className="settings-row-label">{t.interceptorTitle}</div>
          <div className="settings-row-desc">{t.interceptorDesc}</div>
        </div>
        <button className="settings-btn" onClick={toggleClaude}>{t.toggle}</button>
      </div>
    </div>
  );
}

// Custom title bar for the settings window, mirroring App.tsx's TitleBar
// (same .titlebar / .titlebar-controls classes and drag-region pattern) but
// with a plain text label instead of the usage window's icon buttons, and a
// single close control — there's nothing to pin or refresh here.
function SettingsTitleBar({ t }: { t: Messages }) {
  return (
    <header className="titlebar" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
      <div className="titlebar-left" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <span className="titlebar-title">{t.settingsTitle}</span>
      </div>
      <div className="titlebar-controls" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <button aria-label={t.close} className="close" onClick={() => Window.Close()}>&#x2715;</button>
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
      SettingsService.Get()
        .then((s) => {
          setDraft(s);
          setDirty(false);
          setLoaded(true);
          // This window renders with the *saved* theme, not the draft's: like
          // every other setting, a theme picked in the select only takes effect
          // on Apply (see apply()), and reopening discards it with the draft.
          applyTheme(s.theme);
        })
        .catch((err) => {
          // Backend Load() already falls back to defaults on a corrupt
          // settings.json; this only guards I/O errors so `loaded` doesn't
          // stay false forever and leave this window blank.
          console.error('tempoc: failed to load settings, using defaults', err);
          const s = new Settings();
          setDraft(s);
          setDirty(false);
          setLoaded(true);
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

  // Same draft-locale rendering as SettingsView: the title bar and footer
  // follow the language selected in the (unsaved) draft.
  const t = getMessages(resolveLocale(draft.locale));

  // The frameless titlebar above is React, but the *native* window title
  // (taskbar / Alt-Tab) is owned by Wails. This window's own JS context can
  // set it directly, so it stays localized without Go needing to resolve a
  // locale. Follows the draft language, matching the previewed UI. Format
  // mirrors the previous hard-coded "TEMPOC Settings".
  useEffect(() => {
    Window.SetTitle(`TEMPOC ${t.settingsTitle}`);
  }, [t.settingsTitle]);

  return (
    <div className="root">
      <SettingsTitleBar t={t} />
      <main className="app">
        {loaded && <SettingsView settings={draft} onUpdate={updateDraft} hasWeeklyScoped={hasWeeklyScoped} />}
      </main>
      <footer className="settings-footer">
        <button className="settings-btn" onClick={() => Window.Close()}>{t.close}</button>
        <button className="settings-btn settings-apply" disabled={!dirty || !loaded} onClick={apply}>{t.apply}</button>
      </footer>
    </div>
  );
}
