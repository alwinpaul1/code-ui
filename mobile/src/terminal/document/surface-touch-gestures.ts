import { scope, scheduleDocumentFrame } from './document-scope'
import { touchesInRoot } from './document-host-seams'
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
export type TerminalTouchState = {
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
  if (scope.touchGesture.velY === 0) {
    scope.touchGesture.velY = instantVelocity
    return
  }
  // Why: touchmove cadence is uneven in WebView. Blend recent samples so
  // momentum launch doesn't inherit a one-frame spike or stall — weighted by
  // elapsed TIME, because a per-sample weight lets a 120 Hz stream converge
  // twice as fast and launch a different velocity from the same finger.
  // oxlint-disable-next-line prefer-exponentiation-operator -- the document's text is pinned token for token; rewriting this changes the native program
  const weight = 1 - Math.pow(1 - VELOCITY_BLEND_WEIGHT, dt / VELOCITY_BLEND_REFERENCE_MS)
  scope.touchGesture.velY = scope.touchGesture.velY * (1 - weight) + instantVelocity * weight
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
      if (scope.touchGesture.momentumId) {
        cancelAnimationFrame(scope.touchGesture.momentumId)
        scope.touchGesture.momentumId = null
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
      scope.touchGesture.canPanX = contentOverflowsViewportWidth()
      const touches = touchesInRoot(scope.root, e.touches)
      if (touches.length === 2) {
        scope.touchGesture.isPinching = true
        resetSmoothScrollOffset()
        scope.touchGesture.pinchDist = getDistance(touches[0], touches[1])
        scope.touchGesture.pinchScale = scope.userScale
        const mx = (touches[0].clientX + touches[1].clientX) / 2
        const my = (touches[0].clientY + touches[1].clientY) / 2
        const total = getTotalScale()
        scope.touchGesture.pinchSurfX = (mx - scope.panX) / total
        scope.touchGesture.pinchSurfY = (my - scope.panY) / total
      } else if (touches.length === 1) {
        scope.touchGesture.isPinching = false
        scope.touchGesture.dragging = true
        beginScrollGestureWriteHold()
        scope.touchGesture.lastX = touches[0].clientX
        scope.touchGesture.lastY = touches[0].clientY
        scope.touchGesture.lastTime = nowMs()
        scope.touchGesture.velY = 0
        scope.touchGesture.accumDelta = 0
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

      const touches = touchesInRoot(scope.root, e.touches)
      if (touches.length === 2) {
        scope.touchGesture.isPinching = true
        const dist = getDistance(touches[0], touches[1])
        const mx = (touches[0].clientX + touches[1].clientX) / 2
        const my = (touches[0].clientY + touches[1].clientY) / 2

        const ratio = dist / scope.touchGesture.pinchDist
        // Why: userScale is a CSS multiplier on the current font size; bound it so
        // the resulting apparent size (currentTextScale × userScale) stays within
        // the preset range, since release snaps to one of those presets.
        const loScale = scope.MIN_TEXT_SCALE / scope.currentTextScale
        const hiScale = scope.MAX_TEXT_SCALE / scope.currentTextScale
        scope.userScale = Math.max(
          loScale,
          Math.min(hiScale, scope.touchGesture.pinchScale * ratio)
        )
        const total = getTotalScale()
        scope.panX = mx - scope.touchGesture.pinchSurfX * total
        scope.panY = my - scope.touchGesture.pinchSurfY * total
        clampPan()
        updateTransform()
      } else if (touches.length === 1 && !scope.touchGesture.isPinching) {
        const x = touches[0].clientX,
          y = touches[0].clientY
        const now = nowMs(),
          dt = now - scope.touchGesture.lastTime

        // Why: pan horizontally only when content overflows the viewport (larger
        // than fit) — same check clampPan() uses, decided once at touchstart.
        // Vertical always drives buffer scroll so scrollback stays reachable at
        // any text size; calling the never-defined contentWiderThanViewport()
        // here threw and killed all single-finger scrolling, scrollback included.
        if (scope.touchGesture.canPanX) {
          scope.panX += x - scope.touchGesture.lastX
          clampPan()
          updateTransform()
        }

        const deltaY = scope.touchGesture.lastY - y
        scope.touchGesture.lastTime = now
        if (shouldRouteScrollToTerminalInput()) {
          updateTouchVelocity(deltaY, dt)
          resetSmoothScrollOffset()
          const effectiveCellH = getCellHeight() * getTotalScale()
          scope.touchGesture.accumDelta += deltaY
          const lines = Math.trunc(scope.touchGesture.accumDelta / effectiveCellH)
          if (lines !== 0) {
            scope.touchGesture.accumDelta -= lines * effectiveCellH
            routeScrollLines(lines, x, y)
          }
        } else {
          if (enqueueNormalBufferScrollDelta(deltaY)) {
            updateTouchVelocity(deltaY, dt)
          } else {
            // The buffer end. Let the content follow the finger with rising
            // resistance rather than stopping dead; touchend springs it back.
            pullOverscroll(deltaY)
            scope.touchGesture.velY = 0
          }
        }
        scope.touchGesture.lastX = x
        scope.touchGesture.lastY = y
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

      const touches = touchesInRoot(scope.root, e.touches)
      if (scope.touchGesture.isPinching && touches.length < 2) {
        scope.touchGesture.isPinching = false
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
        if (touches.length === 1) {
          // Why: the pinch changed the scale, so the pan decision taken at
          // touchstart no longer holds for the finger that is still down.
          scope.touchGesture.canPanX = contentOverflowsViewportWidth()
          scope.touchGesture.lastX = touches[0].clientX
          scope.touchGesture.lastY = touches[0].clientY
          scope.touchGesture.lastTime = nowMs()
          scope.touchGesture.velY = 0
          scope.touchGesture.accumDelta = 0
        }
        return
      }

      if (touches.length === 0) {
        scope.touchGesture.dragging = false
        releaseOverscroll()
        let vel = scope.touchGesture.velY
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
            scope.touchGesture.momentumId = null
            endScrollGestureWriteHold()
            settleSmoothScrollOffset()
            return
          }
          const delta = vel * elapsed
          if (shouldRouteScrollToTerminalInput()) {
            resetSmoothScrollOffset()
            const effectiveCellH = getCellHeight() * getTotalScale()
            scope.touchGesture.accumDelta += delta
            const lines = Math.trunc(scope.touchGesture.accumDelta / effectiveCellH)
            if (lines !== 0) {
              scope.touchGesture.accumDelta -= lines * effectiveCellH
              routeScrollLines(lines, scope.touchGesture.lastX, scope.touchGesture.lastY)
            }
          } else {
            if (!applyNormalBufferScrollDelta(delta)) {
              scope.touchGesture.momentumId = null
              endScrollGestureWriteHold()
              releaseOverscroll()
              settleSmoothScrollOffset()
              return
            }
          }
          scope.touchGesture.momentumId = scheduleDocumentFrame(momentumStep)
        }
        if (Math.abs(vel) > MIN_VEL) {
          cancelSmoothScrollSettle()
          scope.touchGesture.momentumId = scheduleDocumentFrame(momentumStep)
        } else {
          endScrollGestureWriteHold()
          settleSmoothScrollOffset()
        }
      }
    },
    { capture: true, passive: true }
  )
}

export function startSurfaceTouchGestures() {
  attachSurfaceEventHandlers(scope.surface!)
}

/** Ruling 21: the momentum loop, which would keep scrolling into the terminal that replaced it. */
export function stopSurfaceTouchGestures() {
  if (scope.touchGesture.momentumId !== null) {
    cancelAnimationFrame(scope.touchGesture.momentumId)
    scope.touchGesture.momentumId = null
  }
}
