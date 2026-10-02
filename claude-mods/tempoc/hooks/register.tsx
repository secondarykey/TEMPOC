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

/** One window, ready to draw. */
type Reading = {
  used: number
  elapsed: number | null
  tone: keyof typeof PALETTE
  detail: string
}

const readings = (list: TempocWindow[], at: number): Reading[] =>
  list.map(w => {
    const label = SPAN[w.kind]?.label ?? w.kind
    const elapsed = elapsedPercent(w, at)
    return {
      used: w.percentUsed,
      elapsed,
      tone: level(w.percentUsed, elapsed) ?? 'accent',
      detail:
        `${label}: ${w.percentUsed.toFixed(0)}% used` +
        (elapsed === null ? '' : `, ${elapsed.toFixed(0)}% elapsed, resets in ${remaining(w, at)}`),
    }
  })

const clamp = (n: number) => Math.min(100, Math.max(0, n))

// The band holds one bar per window across its whole width, 5-hour on the
// left half and 7-day on the right: the track, the amount used in the tone's
// color, and a tick where elapsed time is. No text, no frame.
//
// The SVG is drawn in viewBox units stretched to the band (preserveAspectRatio
// "none"): the Svg element gets a height but no width, so it takes the
// markup's width up to the slot, and its markup is wider than any slot.
const VIEW_W = 1000
const GAP_W = 16
const HEIGHT_PX = 12
const TRACK_Y = 3
const TRACK_H = 6
const TICK_W = 3

function svgBars(rows: Reading[]): string {
  const span = (VIEW_W - GAP_W * (rows.length - 1)) / rows.length
  const body = rows
    .map((r, n) => {
      const x = n * (span + GAP_W)
      const fill = (clamp(r.used) / 100) * span
      const tick =
        r.elapsed === null
          ? ''
          : `<rect class="t" x="${(x + Math.min(span - TICK_W, (r.elapsed / 100) * span - TICK_W / 2)).toFixed(1)}" y="0" width="${TICK_W}" height="${HEIGHT_PX}" fill="#e5e7eb"/>`
      return (
        `<rect class="k" x="${x.toFixed(1)}" y="${TRACK_Y}" width="${span.toFixed(1)}" height="${TRACK_H}" fill="#4b5563"/>` +
        `<rect class="f${r.tone[0]}" x="${x.toFixed(1)}" y="${TRACK_Y}" width="${fill.toFixed(1)}" height="${TRACK_H}" fill="${PALETTE[r.tone][0]}"/>` +
        tick
      )
    })
    .join('')
  const light =
    `.k{fill:#d1d5db}.t{fill:#374151}` +
    `.fa{fill:${PALETTE.accent[1]}}.fw{fill:${PALETTE.warning[1]}}.fe{fill:${PALETTE.error[1]}}`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${HEIGHT_PX}" viewBox="0 0 ${VIEW_W} ${HEIGHT_PX}" preserveAspectRatio="none">` +
    `<style>@media (prefers-color-scheme: light){${light}}</style>${body}</svg>`
  )
}

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

    return (
      <Box flexDirection="row" alignItems="center">
        <Box flexGrow={1}>
          <els.Svg source={svgBars(rows)} alt={rows.map(r => r.detail).join(' / ')} height={HEIGHT_PX} />
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
