import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { TempocWindow } from '../types'

const windows = atom({ plugin: 'tempoc', key: 'windows' } as const, [] as TempocWindow[])
const now = atom({ plugin: 'tempoc', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'tempoc', key: 'isHidden' } as const, false)

// Whether the person closed the bars, kept across sessions like the reading.
const HIDDEN_KEY = 'isHidden'
// An hourglass, the status bar's button that brings the bars back.
const SHOW_ICON = String.fromCharCode(0x29d7)
// Pixels per cell of the desktop's code font, and the cells the band's close
// button takes: together they turn the band's width in cells into pixels.
const CELL_PX = 8.4
const CLOSE_COLUMNS = 4

async function setHidden($: EngineInterface, value: boolean) {
  await update($, isHidden, () => value)
  await $.store.set(HIDDEN_KEY, value)
}

// The last reading is kept across sessions, so a new session shows the bars
// before its first response; elapsed time is computed from the clock anyway.
const STORE_KEY = 'windows'

const HOUR = 60 * 60 * 1000
const SPAN: Record<string, { label: string; ms: number }> = {
  five_hour: { label: '5h', ms: 5 * HOUR },
  seven_day: { label: '7d', ms: 7 * 24 * HOUR },
}

// Same defaults as the extension and the desktop app: warn as soon as usage
// is ahead of elapsed time, danger once it is more than 10 points ahead.
const WARNING_AT = 0
const DANGER_AT = 10
const UTILIZATION_WARNING = 98
const UTILIZATION_DANGER = 100

const toWindow = (r: SessionRateLimit): TempocWindow => {
  const t = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  return { kind: r.kind, percentUsed: r.percentUsed, resetsAt: Number.isNaN(t) ? null : t }
}

/** Percent of the window's time that has passed, or null when it cannot be known. */
const elapsedPercent = (w: TempocWindow, at: number): number | null => {
  const span = SPAN[w.kind]
  if (!span || w.resetsAt === null) return null
  const left = w.resetsAt - at
  if (left <= 0) return 100
  return Math.min(100, Math.max(0, ((span.ms - left) / span.ms) * 100))
}

const level = (used: number, elapsed: number | null): 'error' | 'warning' | undefined => {
  if (used >= UTILIZATION_DANGER) return 'error'
  const diff = elapsed === null ? 0 : used - elapsed
  if (diff > DANGER_AT) return 'error'
  if (diff > WARNING_AT || used >= UTILIZATION_WARNING) return 'warning'
  return undefined
}

const remaining = (w: TempocWindow, at: number): string => {
  if (w.resetsAt === null) return ''
  const min = Math.max(0, Math.round((w.resetsAt - at) / 60000))
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

/** One window, ready to draw: the bar's figures and the texts around it. */
type Reading = {
  used: number
  elapsed: number | null
  tone: keyof typeof PALETTE
  label: string
  usedText: string
  resetText: string
  remainText: string
  /** The tooltip and the readers' text: every figure, elapsed included. */
  detail: string
}

const LABEL: Record<string, string> = { five_hour: '5-Hour', seven_day: '7-Day' }

const readings = (list: TempocWindow[], at: number): Reading[] =>
  list.map(w => {
    const label = LABEL[w.kind] ?? w.kind
    const elapsed = elapsedPercent(w, at)
    const usedText = `${w.percentUsed.toFixed(0)}%`
    const resetText = w.resetsAt === null ? '' : `Resets ${resetClock(w, at)}`
    const remainText = w.resetsAt === null ? '' : `${remaining(w, at)} left`
    return {
      used: w.percentUsed,
      elapsed,
      tone: level(w.percentUsed, elapsed) ?? 'accent',
      label,
      usedText,
      resetText,
      remainText,
      detail: [
        `${label}: ${usedText} used`,
        resetText,
        elapsed === null ? '' : `Elapsed ${elapsed.toFixed(1)}%`,
        remainText,
      ]
        .filter(Boolean)
        .join(' / '),
    }
  })

const clamp = (n: number) => Math.min(100, Math.max(0, n))

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

function svgBars(rows: Reading[], width: number): string {
  const span = (width - GAP_PX * (rows.length - 1)) / rows.length
  const text = (x: number, anchor: string, cls: string, fill: string, s: string) =>
    `<text class="${cls}" x="${x.toFixed(1)}" y="${TEXT_Y}" font-size="12" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`
  const body = rows
    .map((r, n) => {
      const x = n * (span + GAP_PX)
      const color = PALETTE[r.tone][0]
      const tail = [r.resetText, r.remainText].filter(Boolean).join(' \u00b7 ')
      const labelW = (r.label.length + 1) * CHAR_PX
      const usedW = (r.usedText.length + 0.5) * CHAR_PX
      const tailW = tail.length * CHAR_PX
      const barX = x + labelW + usedW + PAD_PX
      const barW = Math.max(24, span - (labelW + usedW + tailW + PAD_PX * 2))
      const fill = (clamp(r.used) / 100) * barW
      const tick =
        r.elapsed === null
          ? ''
          : `<rect class="t" x="${(barX + Math.min(barW - TICK_W, (r.elapsed / 100) * barW - TICK_W / 2)).toFixed(1)}" y="${TICK_Y}" width="${TICK_W}" height="${TICK_H}" fill="#e5e7eb"/>`
      return (
        `<g><title>${esc(r.detail)}</title>` +
        `<rect x="${x.toFixed(1)}" y="0" width="${span.toFixed(1)}" height="${HEIGHT_PX}" fill="transparent"/>` +
        text(x, 'start', 'm', '#9ca3af', r.label) +
        text(x + labelW + usedW, 'end', `u${r.tone[0]}`, color, r.usedText) +
        `<rect class="k" x="${barX.toFixed(1)}" y="${TRACK_Y}" width="${barW.toFixed(1)}" height="${TRACK_H}" rx="3" fill="#4b5563"/>` +
        `<rect class="f${r.tone[0]}" x="${barX.toFixed(1)}" y="${TRACK_Y}" width="${fill.toFixed(1)}" height="${TRACK_H}" rx="3" fill="${color}"/>` +
        tick +
        text(x + span, 'end', 'm', '#9ca3af', tail) +
        `</g>`
      )
    })
    .join('')
  const light =
    `.k{fill:#d1d5db}.t{fill:#374151}.m{fill:#6b7280}` +
    `.fa,.ua{fill:${PALETTE.accent[1]}}.fw,.uw{fill:${PALETTE.warning[1]}}.fe,.ue{fill:${PALETTE.error[1]}}`
  // The Svg is drawn interactive so each row's <title> shows as a tooltip.
  // That puts it in a frame of its own; declaring both color schemes keeps the
  // frame from painting an opaque page behind the bars.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT_PX}" viewBox="0 0 ${width} ${HEIGHT_PX}" style="color-scheme: light dark; background: transparent">` +
    `<style>:root{color-scheme: light dark; background: transparent}text{font-family: system-ui, sans-serif; font-variant-numeric: tabular-nums}@media (prefers-color-scheme: light){${light}}</style>${body}</svg>`
  )
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    const stored = await $.store.get(STORE_KEY)
    if (Array.isArray(stored)) await update($, windows, () => stored as TempocWindow[])
    if ((await $.store.get(HIDDEN_KEY)) === true) await update($, isHidden, () => true)
    await publish($, (await $.session.usage()).rateLimits)

    const tick = async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    }
    await tick()
    $.clock.every(30_000, () => void tick())

    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await publish($, e.rateLimits)
    return next(e)
  })

  // The bars sit in the band above the prompt: the only site that draws an Svg.
  // The figures stay out of sight; the Svg's alt carries them for readers.
  // The band's close button hides it; the status bar then offers it back.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, windows)
    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) return next(e)

    const els = $.ui.resolve(e)
    if (!('Svg' in els)) return next(e)

    const at = (await read($, now)) || (await $.clock.now())
    const rows = readings(list, at)
    const { Box, Button } = els

    // An interactive Svg sits in a frame of its own, which does not stretch to
    // the band: it needs a width in pixels. The band reports its width in cells
    // of the surface's code font, so the width is those cells at CELL_PX each,
    // less the close button's.
    const width = Math.max(200, Math.round((e.props.bodyColumns - CLOSE_COLUMNS) * CELL_PX))
    void $.store.set('bandColumns', e.props.bodyColumns)

    return (
      <Box flexDirection="row" alignItems="center">
        <Box flexGrow={1} alignSelf="center">
          <els.Svg
            source={svgBars(rows, width)}
            alt={rows.map(r => r.detail).join(' / ')}
            width={width}
            height={HEIGHT_PX}
            isInteractive
          />
        </Box>
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
