// Touch-panel window dragging for the frameless window.
//
// Wails' own drag support (the `--wails-draggable: drag` CSS property handled
// by the runtime's drag.js) only listens for mouse events, and the native
// Windows move loop it starts follows mouse messages -- neither reaches a
// touch contact, so a frameless window cannot be dragged by finger at all.
// See the wails3 skill's frameless.md ("--wails-draggable does not work on
// touch panels") for the full analysis.
//
// So: pick the gesture up from pointer events and move the window ourselves.
// Mouse input is left to the runtime; this only handles non-mouse pointers.
// Delete this module once upstream Wails handles touch, or the window will be
// moved twice.
import { Window } from '@wailsio/runtime'

const DRAG_THRESHOLD_PX = 6 // distance that separates a drag from a tap
const SETTLE_PX = 2         // dead zone that swallows DIP/px rounding jitter

type Axis = 'both' | 'x' | 'y' | null
interface Point { x: number; y: number }

// Is this a draggable surface, and along which axis? Beyond
// --wails-draggable: drag we read touch-action to see which axis the browser
// has *not* claimed for panning, so the definition of "draggable" stays in
// the stylesheet alone rather than being duplicated here.
function dragAxis(e: PointerEvent): Axis {
  const el = e.target
  if (!(el instanceof Element)) return null
  const style = getComputedStyle(el)
  if (style.getPropertyValue('--wails-draggable').trim() !== 'drag') return null
  // Outside the client box = on a scrollbar.
  if (e.offsetX < 0 || e.offsetX >= el.clientWidth) return null
  if (e.offsetY < 0 || e.offsetY >= el.clientHeight) return null

  const ta = style.touchAction
  if (ta === 'none') return 'both'
  const panX = ta.includes('pan-x') || ta.includes('pan-left') || ta.includes('pan-right')
  const panY = ta.includes('pan-y') || ta.includes('pan-up') || ta.includes('pan-down')
  if (panY && !panX) return 'x' // vertical belongs to the browser, horizontal is free
  if (panX && !panY) return 'y'
  return null                   // auto etc. = the browser owns the gesture
}

// On a single-axis surface, only arm when that axis dominates: the moment the
// browser decides the gesture is a pan it takes the pointer away with
// pointercancel, so arming on the pan axis would just die mid-drag.
function pastThreshold(axis: Exclude<Axis, null>, dx: number, dy: number): boolean {
  if (axis === 'x') return Math.abs(dx) >= DRAG_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)
  if (axis === 'y') return Math.abs(dy) >= DRAG_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)
  return Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX
}

export function initTouchDrag(): void {
  let press: {
    id: number; el: Element; axis: Exclude<Axis, null>
    grab: Point; origin: Promise<Point>
  } | null = null
  let dragging = false
  let drift: Point | null = null     // finger offset from the grab point = distance still to move
  let unseen: Point = { x: 0, y: 0 } // requested but not yet reflected in incoming events
  let sent: Point | null = null      // last window position we asked for
  let inFlight = false
  let settledAt = 0
  let frame = 0

  // Once per frame, one call in flight at a time (a finger emits several
  // events per frame).
  const tick = () => {
    frame = 0
    if (!press || !dragging) return
    frame = requestAnimationFrame(tick)
    if (!drift || inFlight) return

    const p = press, d = drift
    inFlight = true
    void (async () => {
      try {
        const from = sent ?? await p.origin
        if (press !== p) return // the finger lifted during the round trip
        sent = from
        const by = { x: Math.round(d.x - unseen.x), y: Math.round(d.y - unseen.y) }
        if (Math.abs(by.x) < SETTLE_PX && Math.abs(by.y) < SETTLE_PX) return
        unseen = { x: unseen.x + by.x, y: unseen.y + by.y }
        sent = { x: from.x + by.x, y: from.y + by.y }
        await Window.SetPosition(sent.x, sent.y)
      } catch { /* no window to move (browser preview) */
      } finally { settledAt = performance.now(); inFlight = false }
    })()
  }

  // Did a drag actually happen? Used to swallow the click the webview
  // synthesises afterwards. Windows' move handling sometimes eats pointerup,
  // so this is cleared on the next press rather than at the end of a drag.
  let dragged = false

  window.addEventListener('pointerdown', (e) => {
    press = null; dragging = false; dragged = false
    drift = null; sent = null; unseen = { x: 0, y: 0 }
    inFlight = false; settledAt = 0
    cancelAnimationFrame(frame); frame = 0
    if (e.pointerType === 'mouse' || !e.isPrimary) return // the runtime handles the mouse
    const axis = dragAxis(e)
    if (!axis) return
    press = {
      id: e.pointerId, el: e.target as Element, axis,
      grab: { x: e.clientX, y: e.clientY },
      origin: Window.Position().then(p => ({ x: p.x, y: p.y })),
    }
  }, { capture: true })

  window.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return
    const dx = e.clientX - press.grab.x
    const dy = e.clientY - press.grab.y
    if (!dragging) {
      // Nothing has moved yet, so the offset is exactly the finger travel.
      if (!pastThreshold(press.axis, dx, dy)) return
      dragging = true; dragged = true
      // The window slides out from under the finger, so we need the capture.
      try { press.el.setPointerCapture(press.id) } catch { /* element cannot take it */ }
      frame = requestAnimationFrame(tick)
    }
    e.preventDefault()
    // An event generated after every request landed hides nothing in drift.
    if (e.timeStamp >= settledAt) unseen = { x: 0, y: 0 }
    drift = { x: dx, y: dy }
  }, { capture: true })

  const end = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return
    try { press.el.releasePointerCapture(press.id) } catch { /* already gone */ }
    press = null; dragging = false; drift = null
    cancelAnimationFrame(frame); frame = 0
  }
  window.addEventListener('pointerup', end, { capture: true })
  window.addEventListener('pointercancel', end, { capture: true })

  // Kill the synthetic click after a drag; without this whatever button sits
  // under the finger at the drop point gets pressed.
  window.addEventListener('click', (e) => {
    if (!dragged) return
    dragged = false
    e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault()
  }, { capture: true })
}
