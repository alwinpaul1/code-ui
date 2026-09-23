import { scope } from './document-scope'
import {
  clampPan,
  contentOverflowsViewportWidth,
  getCellHeight,
  invalidateSurfaceMetrics
} from './fit-scale'
import { notify } from './host-notify'
import { attachSurfaceMouseClickDragHandler } from './mouse-click-drag'
import { routeScrollLines, shouldRouteScrollToTerminalInput } from './mouse-input-encoding'
import {
  MOMENTUM_MAX_STEP_MS,
  applyNormalBufferScrollDelta,
  armSmoothScrollSettle,
  cancelSmoothScrollSettle,
  enqueueNormalBufferScrollDelta,
  resetSmoothScrollOffset,
  settleSmoothScrollOffset
} from './normal-buffer-smooth-scroll'
import { pullOverscroll, releaseOverscroll } from './overscroll-bend'
import { dispatcherShouldBlockSurface } from './tap-dispatch'
import { applyTextScale, snapToTextScalePreset } from './text-scaling'
import { getTotalScale, nowMs, updateTransform } from './viewport-transform'
import { attachSurfaceWheelHandler } from './wheel-scroll'
import { beginScrollGestureWriteHold, endScrollGestureWriteHold } from './write-queue'

/** A surface that has already been wired, so a re-mount does not stack handlers. */
type TerminalGestureSurface = HTMLElement & { __orcaSurfaceHandlersAttached?: boolean }

/** The live touch gesture: the last point, the velocity, and the pinch it may be in. */
type TerminalTouchState = {
  lastX: number
  lastY: number
  lastTime: number
  velY: number
  /** Whether a finger is down and dragging; a fling in flight is `momentumId`. */
  dragging: boolean
  accumDelta: number
  momentumId: number | null
  isPinching: boolean
  /** Whether the content overflows the viewport's width, decided once per gesture. */
  canPanX: boolean
  pinchDist: number
  pinchScale: number
  pinchSurfX: number
  pinchSurfY: number
}

export const ts: TerminalTouchState = {
  lastX: 0,
  lastY: 0,
  lastTime: 0,
  velY: 0,
  dragging: false,
  accumDelta: 0,
  momentumId: null,
  isPinching: false,
  canPanX: false,
  pinchDist: 0,
  pinchScale: 0,
  pinchSurfX: 0,
  pinchSurfY: 0
}

// Why: every scroll constant below is per MILLISECOND, not per frame. The old
// per-frame friction and fixed 16ms step made a fling travel twice as far on a
// 120 Hz phone as on a 60 Hz one. VELOCITY_BLEND_WEIGHT and FRICTION_PER_MS
// are the old 0.45 blend and 0.972 friction expressed over a 60 Hz frame, so
// 60 Hz behaviour is unchanged and every other refresh rate now matches it.
const VELOCITY_BLEND_REFERENCE_MS = 1000 / 60
const VELOCITY_BLEND_WEIGHT = 0.45
const FRICTION_PER_MS = 0.998297482

const MIN_VEL = 0.012

export function updateTouchVelocity(deltaY: number, dt: number) {
  if (!(dt > 0)) {
    return
  }
  const instantVelocity = deltaY / dt
  if (!Number.isFinite(instantVelocity)) {
    return
  }
  if (ts.velY === 0) {
    ts.velY = instantVelocity
    return
  }
  // Why: touchmove cadence is uneven in WebView. Blend recent samples so
  // momentum launch doesn't inherit a one-frame spike or stall — weighted by
  // elapsed TIME, because a per-sample weight lets a 120 Hz stream converge
  // twice as fast and launch a different velocity from the same finger.
  // oxlint-disable-next-line prefer-exponentiation-operator -- the document's text is pinned token for token; rewriting this changes the native program
  const weight = 1 - Math.pow(1 - VELOCITY_BLEND_WEIGHT, dt / VELOCITY_BLEND_REFERENCE_MS)
  ts.velY = ts.velY * (1 - weight) + instantVelocity * weight
}

export function getDistance(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX,
    dy = a.clientY - b.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

export function attachSurfaceEventHandlers(targetSurface: TerminalGestureSurface) {
  if (!targetSurface || targetSurface.__orcaSurfaceHandlersAttached) {
    return
  }
  targetSurface.__orcaSurfaceHandlersAttached = true
  // Why: init() swaps in a new hidden surface to avoid flicker; each
  // replacement needs gesture handlers or tab-switch replays stop scrolling.
  targetSurface.addEventListener(
    'mousedown',
    function (e) {
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )
  targetSurface.addEventListener(
    'click',
    function (e) {
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )

  attachSurfaceWheelHandler(targetSurface)
  attachSurfaceMouseClickDragHandler(targetSurface)

  targetSurface.addEventListener(
    'touchstart',
    function (e) {
      if (dispatcherShouldBlockSurface()) {
        return
      }
      if (ts.momentumId) {
        cancelAnimationFrame(ts.momentumId)
        ts.momentumId = null
      }
      cancelSmoothScrollSettle()
      // Why: the finger owns the content from here, so stop any settle in
      // flight — but re-arm it on the idle timer. Catching a fling and then
      // holding still would otherwise leave the content off the row grid, and
      // a long press (500ms) resolves the cell under the finger from the grid.
      if (scope.smoothScrollOffsetY !== 0) {
        armSmoothScrollSettle()
      }
      // Why: content width, content height and the window box cannot change
      // while a finger is down, so this is the one place per gesture that pays
      // for a layout read; every touchmove then reads the cache.
      invalidateSurfaceMetrics()
      ts.canPanX = contentOverflowsViewportWidth()
      if (e.touches.length === 2) {
        ts.isPinching = true
        resetSmoothScrollOffset()
        ts.pinchDist = getDistance(e.touches[0], e.touches[1])
        ts.pinchScale = scope.userScale
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const total = getTotalScale()
        ts.pinchSurfX = (mx - scope.panX) / total
        ts.pinchSurfY = (my - scope.panY) / total
      } else if (e.touches.length === 1) {
        ts.isPinching = false
        ts.dragging = true
        beginScrollGestureWriteHold()
        ts.lastX = e.touches[0].clientX
        ts.lastY = e.touches[0].clientY
        ts.lastTime = nowMs()
        ts.velY = 0
        ts.accumDelta = 0
      }
    },
    { capture: true, passive: true }
  )

  targetSurface.addEventListener(
    'touchmove',
    function (e) {
      if (dispatcherShouldBlockSurface()) {
        return
      }
      if (!scope.term) {
        return
      }
      e.preventDefault()
      e.stopPropagation()

      if (e.touches.length === 2) {
        ts.isPinching = true
        const dist = getDistance(e.touches[0], e.touches[1])
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2

        const ratio = dist / ts.pinchDist
        // Why: userScale is a CSS multiplier on the current font size; bound it so
        // the resulting apparent size (currentTextScale × userScale) stays within
        // the preset range, since release snaps to one of those presets.
        const loScale = scope.MIN_TEXT_SCALE / scope.currentTextScale
        const hiScale = scope.MAX_TEXT_SCALE / scope.currentTextScale
        scope.userScale = Math.max(loScale, Math.min(hiScale, ts.pinchScale * ratio))
        const total = getTotalScale()
        scope.panX = mx - ts.pinchSurfX * total
        scope.panY = my - ts.pinchSurfY * total
        clampPan()
        updateTransform()
      } else if (e.touches.length === 1 && !ts.isPinching) {
        const x = e.touches[0].clientX,
          y = e.touches[0].clientY
        const now = nowMs(),
          dt = now - ts.lastTime

        // Why: pan horizontally only when content overflows the viewport (larger
        // than fit) — same check clampPan() uses, decided once at touchstart.
        // Vertical always drives buffer scroll so scrollback stays reachable at
        // any text size; calling the never-defined contentWiderThanViewport()
        // here threw and killed all single-finger scrolling, scrollback included.
        if (ts.canPanX) {
          scope.panX += x - ts.lastX
          clampPan()
          updateTransform()
        }

        const deltaY = ts.lastY - y
        ts.lastTime = now
        if (shouldRouteScrollToTerminalInput()) {
          updateTouchVelocity(deltaY, dt)
          resetSmoothScrollOffset()
          const effectiveCellH = getCellHeight() * getTotalScale()
          ts.accumDelta += deltaY
          const lines = Math.trunc(ts.accumDelta / effectiveCellH)
          if (lines !== 0) {
            ts.accumDelta -= lines * effectiveCellH
            routeScrollLines(lines, x, y)
          }
        } else {
          if (enqueueNormalBufferScrollDelta(deltaY)) {
            updateTouchVelocity(deltaY, dt)
          } else {
            // The buffer end. Let the content follow the finger with rising
            // resistance rather than stopping dead; touchend springs it back.
            pullOverscroll(deltaY)
            ts.velY = 0
          }
        }
        ts.lastX = x
        ts.lastY = y
      }
    },
    { capture: true, passive: false }
  )

  targetSurface.addEventListener(
    'touchend',
    function (e) {
      if (dispatcherShouldBlockSurface()) {
        return
      }
      if (!scope.term) {
        return
      }

      if (ts.isPinching && e.touches.length < 2) {
        ts.isPinching = false
        // Why: a finished pinch snaps to the nearest preset and becomes the new
        // font size (reflowing the grid), so pinch-to-zoom IS the in-terminal way
        // to set the text size. The CSS pinch zoom (userScale) is reset; the real
        // size change reflows columns and RN persists + resizes the PTY to match.
        const target = snapToTextScalePreset(scope.currentTextScale * scope.userScale)
        const changed = target !== scope.currentTextScale
        scope.userScale = 1
        scope.panX = 0
        scope.panY = 0
        applyTextScale(target)
        updateTransform()
        notify({ type: 'font-scale-changed', fontScale: target })
        if (changed) {
          notify({ type: 'haptic', kind: 'selection' })
        }
        if (e.touches.length === 1) {
          // Why: the pinch changed the scale, so the pan decision taken at
          // touchstart no longer holds for the finger that is still down.
          ts.canPanX = contentOverflowsViewportWidth()
          ts.lastX = e.touches[0].clientX
          ts.lastY = e.touches[0].clientY
          ts.lastTime = nowMs()
          ts.velY = 0
          ts.accumDelta = 0
        }
        return
      }

      if (e.touches.length === 0) {
        ts.dragging = false
        releaseOverscroll()
        let vel = ts.velY
        let momentumTime = 0
        function momentumStep(frameTime?: number) {
          const now = typeof frameTime === 'number' ? frameTime : nowMs()
          if (momentumTime === 0) {
            momentumTime = now - VELOCITY_BLEND_REFERENCE_MS
          }
          let elapsed = now - momentumTime
          momentumTime = now
          if (elapsed <= 0) {
            elapsed = 1
          }
          // Why: a long stall must not teleport the content a screenful. Ordinary
          // frame variance has to pass through untouched, or the fling stops
          // tracking the clock.
          if (elapsed > MOMENTUM_MAX_STEP_MS) {
            elapsed = MOMENTUM_MAX_STEP_MS
          }
          // oxlint-disable-next-line prefer-exponentiation-operator -- the document's text is pinned token for token; rewriting this changes the native program
          vel *= Math.pow(FRICTION_PER_MS, elapsed)
          if (Math.abs(vel) < MIN_VEL) {
            ts.momentumId = null
            endScrollGestureWriteHold()
            settleSmoothScrollOffset()
            return
          }
          const delta = vel * elapsed
          if (shouldRouteScrollToTerminalInput()) {
            resetSmoothScrollOffset()
            const effectiveCellH = getCellHeight() * getTotalScale()
            ts.accumDelta += delta
            const lines = Math.trunc(ts.accumDelta / effectiveCellH)
            if (lines !== 0) {
              ts.accumDelta -= lines * effectiveCellH
              routeScrollLines(lines, ts.lastX, ts.lastY)
            }
          } else {
            if (!applyNormalBufferScrollDelta(delta)) {
              ts.momentumId = null
              endScrollGestureWriteHold()
              releaseOverscroll()
              settleSmoothScrollOffset()
              return
            }
          }
          ts.momentumId = requestAnimationFrame(momentumStep)
        }
        if (Math.abs(vel) > MIN_VEL) {
          cancelSmoothScrollSettle()
          ts.momentumId = requestAnimationFrame(momentumStep)
        } else {
          endScrollGestureWriteHold()
          settleSmoothScrollOffset()
        }
      }
    },
    { capture: true, passive: true }
  )
}

attachSurfaceEventHandlers(scope.surface!)
