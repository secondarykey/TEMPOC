import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { TempocDraft, TempocSettings, TempocThresholds, TempocView, TempocWindow } from '../types'

const windows = atom({ plugin: 'tempoc', key: 'windows' } as const, [] as TempocWindow[])
const view = atom({ plugin: 'tempoc', key: 'view' } as const, { windows: [], at: 0 } as TempocView)
const isHidden = atom({ plugin: 'tempoc', key: 'isHidden' } as const, false)

// Whether the person closed the bars, kept across sessions like the reading.
const HIDDEN_KEY = 'isHidden'
// An hourglass, the status bar's button that brings the bars back.
const SHOW_ICON = String.fromCharCode(0x29d7)
// Pixels per cell of the desktop's code font, and the cells the band's gear and close
// buttons take: together they turn the band's width in cells into pixels.
const CELL_PX = 7.8
const CLOSE_COLUMNS = 7

// The settings pane, opened by the band's gear or by /tempoc. Its edits stay
// in `draft` until Apply, which saves them all at once in the plugin's store:
// no option rows, so no module reload per field.
const SETTINGS_PANE = 'tempoc-settings'
const GEAR_ICON = String.fromCharCode(0x2699)
// Ballot boxes, checked and not: the settings pane's color switches.
const CHECKED = 0x2611
const UNCHECKED = 0x2610
// The settings pane's column widths, in cells: a field's label, its input.
const LABEL_COLUMNS = 10
const INPUT_COLUMNS = 8
const SETTINGS_KEY = 'settings'

// Same defaults as the extension and the desktop app: warn as soon as usage
// is ahead of elapsed time, danger once it is more than 10 points ahead.
const DEFAULT_SETTINGS: TempocSettings = {
  hour5: { isEnabled: true, warning: 0, danger: 10 },
  day7: { isEnabled: true, warning: 0, danger: 10 },
  utilizationWarning: 98,
  utilizationDanger: 100,
}
const settings = atom({ plugin: 'tempoc', key: 'settings' } as const, DEFAULT_SETTINGS)
const draft = atom({ plugin: 'tempoc', key: 'draft' } as const, null as TempocDraft | null)

// The settings the drawing code reads; kept equal to the `settings` state.
let current: TempocSettings = DEFAULT_SETTINGS

const toDraft = (s: TempocSettings): TempocDraft => ({
  hour5: { isEnabled: s.hour5.isEnabled, warning: String(s.hour5.warning), danger: String(s.hour5.danger) },
  day7: { isEnabled: s.day7.isEnabled, warning: String(s.day7.warning), danger: String(s.day7.danger) },
  utilizationWarning: String(s.utilizationWarning),
  utilizationDanger: String(s.utilizationDanger),
})

/** The draft as settings, or null when a number is not 0 to 100. */
function fromDraft(d: TempocDraft): TempocSettings | null {
  const pct = (text: string) => {
    const n = Number(text.trim())
    return text.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
  }
  const values = [d.hour5.warning, d.hour5.danger, d.day7.warning, d.day7.danger, d.utilizationWarning, d.utilizationDanger].map(pct)
  if (values.some(v => v === null)) return null
  const [h5w, h5d, d7w, d7d, uw, ud] = values as number[]
  return {
    hour5: { isEnabled: d.hour5.isEnabled, warning: h5w!, danger: h5d! },
    day7: { isEnabled: d.day7.isEnabled, warning: d7w!, danger: d7d! },
    utilizationWarning: uw!,
    utilizationDanger: ud!,
  }
}

/** Saves settings, makes the drawing use them and redraws. */
async function saveSettings($: EngineInterface, next: TempocSettings) {
  current = next
  await update($, settings, () => next)
  await $.store.set(SETTINGS_KEY, next)
  await redraw?.()
}

async function setHidden($: EngineInterface, value: boolean) {
  await update($, isHidden, () => value)
  await $.store.set(HIDDEN_KEY, value)
}

// The last reading is kept across sessions, so a new session shows the bars
// before its first response; elapsed time is computed from the clock anyway.
const STORE_KEY = 'windows'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const SPAN_MS: Record<string, number> = {
  five_hour: 5 * HOUR,
  seven_day: 7 * 24 * HOUR,
}

/** A window's color thresholds, its own and the shared usage levels. */
type Thresholds = TempocThresholds & { utilizationWarning: number; utilizationDanger: number }

const thresholdsOf = (kind: string): Thresholds => {
  const own = kind === 'five_hour' ? current.hour5 : kind === 'seven_day' ? current.day7 : DEFAULT_SETTINGS.hour5
  return { ...own, utilizationWarning: current.utilizationWarning, utilizationDanger: current.utilizationDanger }
}

const toWindow = (r: SessionRateLimit): TempocWindow => {
  const t = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  return { kind: r.kind, percentUsed: r.percentUsed, resetsAt: Number.isNaN(t) ? null : t }
}

/** Percent of the window's time that has passed, or null when it cannot be known. */
const elapsedPercent = (w: TempocWindow, at: number): number | null => {
  const span = SPAN_MS[w.kind]
  if (!span || w.resetsAt === null) return null
  const left = w.resetsAt - at
  if (left <= 0) return 100
  return Math.min(100, Math.max(0, ((span - left) / span) * 100))
}

const level = (used: number, elapsed: number | null, t: Thresholds): 'error' | 'warning' | undefined => {
  if (!t.isEnabled) return undefined
  if (used >= t.utilizationDanger) return 'error'
  const diff = elapsed === null ? 0 : used - elapsed
  if (diff > t.danger) return 'error'
  if (diff > t.warning || used >= t.utilizationWarning) return 'warning'
  return undefined
}

const remaining = (w: TempocWindow, at: number): string => {
  if (w.resetsAt === null) return ''
  const min = Math.max(0, Math.round((w.resetsAt - at) / MINUTE))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** The reset moment as a local clock time, with the date when it is not today. */
const resetClock = (w: TempocWindow, at: number): string => {
  if (w.resetsAt === null) return ''
  const t = new Date(w.resetsAt)
  const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
  return t.toDateString() === new Date(at).toDateString() ? hm : `${t.getMonth() + 1}/${t.getDate()} ${hm}`
}

async function publish($: EngineInterface, limits: SessionRateLimit[]) {
  if (limits.length === 0) return
  const list = limits.map(toWindow)
  await update($, windows, () => list)
  await $.store.set(STORE_KEY, list)
}

// Bar colors, from the desktop app's theme (dark first, light second).
const PALETTE = {
  accent: ['#7dd3fc', '#0284c7'],
  warning: ['#fbbf24', '#d97706'],
  error: ['#ef4444', '#dc2626'],
} as const

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

/** One window at one moment: the bar's figures and the texts around it. */
type Reading = {
  used: number
  elapsed: number | null
  tone: keyof typeof PALETTE
  label: string
  usedText: string
  /** The line's short form beside the bar: the reset time, the time left in brackets. */
  tail: string
  /** The tooltip and the readers' text: every figure, elapsed included. */
  detail: string
}

function describe(w: TempocWindow, at: number): Reading {
  const label = LABEL[w.kind] ?? w.kind
  const elapsed = elapsedPercent(w, at)
  const usedText = `${w.percentUsed.toFixed(0)}%`
  return {
    used: w.percentUsed,
    elapsed,
    tone: level(w.percentUsed, elapsed, thresholdsOf(w.kind)) ?? 'accent',
    label,
    usedText,
    tail: w.resetsAt === null ? '' : `${resetClock(w, at)} (${remaining(w, at)})`,
    detail: [
      `${label}: ${usedText} used`,
      w.resetsAt === null ? '' : `Resets ${resetClock(w, at)}`,
      elapsed === null ? '' : `Elapsed ${elapsed.toFixed(1)}%`,
      w.resetsAt === null ? '' : `${remaining(w, at)} left`,
    ]
      .filter(Boolean)
      .join(' / '),
  }
}

const clamp = (n: number) => Math.min(100, Math.max(0, n))

// An interactive Svg is a frame that reloads whenever its source changes, and
// a reload blinks. So the source is built to stay the same for an hour: the
// elapsed tick moves by SMIL animation, and the texts that change by the
// minute (the time left, the tooltip) are drawn ahead for STATES minutes and
// switched on in turn by SMIL. The hooks redraw only when that runs out, when
// a color is due to change, or when a new reading arrives.
const STATES = 60
const REDRAW_MS = STATES * MINUTE

/** Milliseconds until the drawing must be rebuilt: a color change, a reset, or the drawn-ahead hour running out. */
function untilRedraw(list: TempocWindow[], at: number): number {
  let wait = REDRAW_MS
  for (const w of list) {
    const span = SPAN_MS[w.kind]
    if (!span || w.resetsAt === null) continue
    if (w.resetsAt > at) wait = Math.min(wait, w.resetsAt - at + 1000)
    // The color depends on usage minus elapsed; elapsed only grows, so each
    // threshold is crossed once, when elapsed reaches usage minus it.
    const t = thresholdsOf(w.kind)
    if (!t.isEnabled) continue
    for (const threshold of [t.danger, t.warning]) {
      const target = w.percentUsed - threshold
      if (target <= 0 || target >= 100) continue
      const crossAt = w.resetsAt - span * (1 - target / 100)
      if (crossAt > at) wait = Math.min(wait, crossAt - at + 1000)
    }
  }
  return Math.max(5000, wait)
}

// The band holds one row per window side by side, 5-hour on the left half and
// 7-day on the right, laid out like the desktop app's compact mode so the band
// stays one line tall: the label and the amount used, the bar, then the reset
// time and the time left. The bar is the track, the amount used in the tone's
// color, and a tick where elapsed time is; elapsed itself is in the tooltip,
// as on the desktop.
const GAP_PX = 20
const HEIGHT_PX = 20
const TEXT_Y = 14.5
const TRACK_Y = 7
const TRACK_H = 6
const TICK_Y = 3
const TICK_H = 14
const TICK_W = 2
const PAD_PX = 8
// Rough advance of a character of the band's small sans-serif text, used to
// leave room for the texts beside the bar.
const CHAR_PX = 6.6

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function svgBars(list: TempocWindow[], at: number, width: number): string {
  const span = (width - GAP_PX * (list.length - 1)) / list.length
  const text = (x: number, anchor: string, cls: string, fill: string, s: string) =>
    `<text class="${cls}" x="${x.toFixed(1)}" y="${TEXT_Y}" font-size="12" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`

  const body = list
    .map((w, n) => {
      const r = describe(w, at)
      const x = n * (span + GAP_PX)
      const color = PALETTE[r.tone][0]

      // The minute-by-minute texts, merged where a run of minutes reads the same.
      const states: { from: number; to: number; tail: string; detail: string }[] = []
      for (let k = 0; k < STATES; k++) {
        const d = describe(w, at + k * MINUTE)
        const last = states[states.length - 1]
        if (last && last.tail === d.tail && last.detail === d.detail) last.to = k + 1
        else states.push({ from: k, to: k + 1, tail: d.tail, detail: d.detail })
      }

      const labelW = (r.label.length + 1) * CHAR_PX
      const usedW = (r.usedText.length + 0.5) * CHAR_PX
      const tailW = Math.max(...states.map(s => s.tail.length)) * CHAR_PX
      const barX = x + labelW + usedW + PAD_PX
      const barW = Math.max(24, span - (labelW + usedW + tailW + PAD_PX * 2))
      const fill = (clamp(r.used) / 100) * barW
      const tickX = (e: number) => barX + Math.min(barW - TICK_W, (e / 100) * barW - TICK_W / 2)

      let tick = ''
      if (r.elapsed !== null && w.resetsAt !== null) {
        const seconds = Math.max(1, (w.resetsAt - at) / 1000)
        tick =
          `<rect class="t" x="${tickX(r.elapsed).toFixed(1)}" y="${TICK_Y}" width="${TICK_W}" height="${TICK_H}" fill="#e5e7eb">` +
          `<animate attributeName="x" from="${tickX(r.elapsed).toFixed(1)}" to="${tickX(100).toFixed(1)}" dur="${seconds.toFixed(0)}s" fill="freeze"/>` +
          `</rect>`
      }

      // Each state is hidden but for its own minutes; the last stays on, so a
      // late redraw shows a slightly old text rather than none. Its transparent
      // rect, drawn over the row, carries the tooltip.
      const timed = states
        .map((s, i) => {
          const end = i === states.length - 1 ? '' : ` end="${s.to * 60}s"`
          return (
            `<g visibility="hidden"><set attributeName="visibility" to="visible" begin="${s.from * 60}s"${end}/>` +
            `<title>${esc(s.detail)}</title>` +
            text(x + span, 'end', 'm', '#9ca3af', s.tail) +
            `<rect x="${x.toFixed(1)}" y="0" width="${span.toFixed(1)}" height="${HEIGHT_PX}" fill="transparent"/>` +
            `</g>`
          )
        })
        .join('')

      return (
        text(x, 'start', 'm', '#9ca3af', r.label) +
        text(x + labelW + usedW, 'end', `u${r.tone[0]}`, color, r.usedText) +
        `<rect class="k" x="${barX.toFixed(1)}" y="${TRACK_Y}" width="${barW.toFixed(1)}" height="${TRACK_H}" rx="3" fill="#4b5563"/>` +
        `<rect class="f${r.tone[0]}" x="${barX.toFixed(1)}" y="${TRACK_Y}" width="${fill.toFixed(1)}" height="${TRACK_H}" rx="3" fill="${color}"/>` +
        tick +
        timed
      )
    })
    .join('')

  const light =
    `.k{fill:#d1d5db}.t{fill:#374151}.m{fill:#6b7280}` +
    `.fa,.ua{fill:${PALETTE.accent[1]}}.fw,.uw{fill:${PALETTE.warning[1]}}.fe,.ue{fill:${PALETTE.error[1]}}`
  // The Svg is drawn interactive so each row's <title> shows as a tooltip and
  // the SMIL above runs. That puts it in a frame of its own; declaring both
  // color schemes keeps the frame from painting an opaque page behind it.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT_PX}" viewBox="0 0 ${width} ${HEIGHT_PX}" style="color-scheme: light dark; background: transparent">` +
    `<style>:root{color-scheme: light dark; background: transparent}text{font-family: system-ui, sans-serif; font-variant-numeric: tabular-nums}@media (prefers-color-scheme: light){${light}}</style>${body}</svg>`
  )
}

// Rebuilds the drawing now and schedules the next rebuild. Set by session.start
// (it needs that hook's `$`), called again when a new reading arrives.
let redraw: (() => Promise<void>) | undefined

/** The saved settings, read leniently: anything missing or malformed keeps its default. */
function readSettings(saved: unknown): TempocSettings {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Record<string, unknown>>
  const pct = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : d)
  const win = (v: unknown, d: TempocThresholds): TempocThresholds => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<Record<string, unknown>>
    return {
      isEnabled: typeof o.isEnabled === 'boolean' ? o.isEnabled : d.isEnabled,
      warning: pct(o.warning, d.warning),
      danger: pct(o.danger, d.danger),
    }
  }
  return {
    hour5: win(s.hour5, DEFAULT_SETTINGS.hour5),
    day7: win(s.day7, DEFAULT_SETTINGS.day7),
    utilizationWarning: pct(s.utilizationWarning, DEFAULT_SETTINGS.utilizationWarning),
    utilizationDanger: pct(s.utilizationDanger, DEFAULT_SETTINGS.utilizationDanger),
  }
}

async function openSettings($: EngineInterface) {
  await update($, draft, () => null)
  await $.ui.open({ id: SETTINGS_PANE, title: 'TEMPOC', focus: true, closeOnEscape: true })
}

async function closeSettings($: EngineInterface) {
  await update($, draft, () => null)
  await $.ui.close({ id: SETTINGS_PANE })
}

async function editDraft($: EngineInterface, edit: (d: TempocDraft) => TempocDraft) {
  await update($, draft, d => edit(d ?? toDraft(current)))
}

async function applyDraft($: EngineInterface) {
  const d = await read($, draft)
  if (d === null) return
  const next = fromDraft(d)
  if (next === null) {
    $.ui.toast('TEMPOC: 0-100')
    return
  }
  await saveSettings($, next)
  await update($, draft, () => null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    current = readSettings(await $.store.get(SETTINGS_KEY))
    await update($, settings, () => current)

    const stored = await $.store.get(STORE_KEY)
    if (Array.isArray(stored)) await update($, windows, () => stored as TempocWindow[])
    if ((await $.store.get(HIDDEN_KEY)) === true) await update($, isHidden, () => true)
    await publish($, (await $.session.usage()).rateLimits)

    let timer: Timer | undefined
    redraw = async () => {
      timer?.cancel()
      const t = await $.clock.now()
      const list = await read($, windows)
      await update($, view, () => ({ windows: list, at: t }))
      const wait = untilRedraw(list, t)
      timer = $.clock.after(wait, () => void redraw?.())
    }
    await redraw()

    await $.command.register({ name: 'tempoc', description: 'Change when the TEMPOC bars turn Warning or Danger color' })

    return result
  })

  on('command.run', { command: 'tempoc' }, async $ => {
    await openSettings($)
    return { text: 'TEMPOC settings opened.' }
  })

  // The settings: per window, whether to color the bar and the points at which
  // it turns Warning and Danger; then the usage levels that turn any bar. Edits
  // go to the draft as they are typed; Apply saves them all and redraws.
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    if (!('Input' in els)) return <Text dimColor>-</Text>
    const { Input } = els

    // One setting per line so the pane stays readable when narrow. There is no
    // checkbox element, so the color switch is a Button drawn as one.
    const d = (await read($, draft)) ?? toDraft(await read($, settings))
    // The label in a box of its own, so Warning and Danger line up, and the
    // input in a fixed-width box, since it otherwise stretches across the pane.
    const field = (key: string, label: string, value: string, onChange: (v: string) => void) => (
      <Box key={key} flexDirection="row" alignItems="center" justifyContent="flex-start" paddingLeft={2}>
        <Box width={LABEL_COLUMNS} flexShrink={0}>
          <Text>{label}</Text>
        </Box>
        <Box width={INPUT_COLUMNS} flexShrink={0}>
          <Input key={key} value={value} onInput={onChange} onSubmit={onChange} />
        </Box>
      </Box>
    )
    const windowBlock = (which: 'hour5' | 'day7', label: string) => {
      const w = d[which]
      const set = (patch: Partial<TempocDraft['hour5']>) =>
        void editDraft($, x => ({ ...x, [which]: { ...x[which], ...patch } }))
      return (
        <Box key={which} flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={2}>
            <Text bold>{label}</Text>
            <Button
              key={`${which}-color`}
              plain
              label={`${String.fromCharCode(w.isEnabled ? CHECKED : UNCHECKED)} Color`}
              onPress={() => set({ isEnabled: !w.isEnabled })}
            />
          </Box>
          {field(`${which}-warning`, 'Warning', w.warning, v => set({ warning: v }))}
          {field(`${which}-danger`, 'Danger', w.danger, v => set({ danger: v }))}
        </Box>
      )
    }
    const setShared = (patch: Partial<Pick<TempocDraft, 'utilizationWarning' | 'utilizationDanger'>>) =>
      void editDraft($, x => ({ ...x, ...patch }))

    return (
      <Box flexDirection="column" gap={1}>
        {windowBlock('hour5', '5h')}
        {windowBlock('day7', '7d')}
        <Box flexDirection="column">
          <Text bold>Usage</Text>
          {field('usage-warning', 'Warning', d.utilizationWarning, v => setShared({ utilizationWarning: v }))}
          {field('usage-danger', 'Danger', d.utilizationDanger, v => setShared({ utilizationDanger: v }))}
        </Box>
        <Box flexDirection="row" gap={2}>
          <Button key="tempoc-settings-apply" variant="primary" label="Apply" onPress={() => void applyDraft($)} />
          <Button key="tempoc-settings-close" role="dismiss" label="Close" onPress={() => void closeSettings($)} />
        </Box>
      </Box>
    )
  })

  // Submitting a prompt remounts the band on the desktop, and a remounted frame
  // replays its SMIL from the start, as of the last rebuild. Rebuilding here
  // keeps that start current; the remount blinks either way.
  on('prompt.submit', async ($, e, next) => {
    await redraw?.()
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await publish($, e.rateLimits)
      await redraw?.()
    }
    return next(e)
  })

  // The bars sit in the band above the prompt: the only site that draws an Svg.
  // The band's close button hides it; the status bar then offers it back.
  //
  // The drawing is built from `view`, the windows and the moment of the last
  // rebuild, not from the clock: the band redraws for its own reasons too (a
  // turn starting or ending), and an unchanged source keeps the frame from
  // reloading. A rebuild sets both at once, so a new reading reloads it once.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { windows: list, at } = await read($, view)
    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) return next(e)

    const els = $.ui.resolve(e)
    if (!('Svg' in els)) return next(e)

    const { Box, Button } = els

    // An interactive Svg sits in a frame of its own, which does not stretch to
    // the band: it needs a width in pixels. The band reports its width in cells
    // of the surface's code font, so the width is those cells at CELL_PX each,
    // less the buttons'. The estimate errs short; should it still overflow, the
    // row does not wrap and the bars are clipped, so the buttons stay in place.
    const width = Math.max(200, Math.round((e.props.bodyColumns - CLOSE_COLUMNS) * CELL_PX))

    return (
      <Box flexDirection="row" flexWrap="nowrap" alignItems="center">
        <Box flexGrow={1} flexShrink={1} overflow="hidden" alignSelf="center">
          <els.Svg
            source={svgBars(list, at, width)}
            alt={list.map(w => describe(w, at).detail).join(' / ')}
            width={width}
            height={HEIGHT_PX}
            isInteractive
          />
        </Box>
        <Button
          key="tempoc-gear"
          plain
          dimColor
          label={GEAR_ICON}
          onPress={() => void openSettings($)}
        />
        <Button key="tempoc-hide" role="dismiss" label="×" onPress={() => setHidden($, true)} />
      </Box>
    )
  })

  // While the band is closed, the status bar carries one button to reopen it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, isHidden)) || (await read($, windows)).length === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const reopen = (
      <Button key="tempoc-show" plain dimColor label={SHOW_ICON} onPress={() => setHidden($, false)} />
    )
    if (e.props.modes.length === 0) return reopen
    return (
      <Box flexDirection="row">
        <Text dimColor>{e.props.modes.join(' & ')}</Text>
        {reopen}
      </Box>
    )
  })
}
