import { afterWritesDrained, disposeTermObservers } from './write-queue'
import { scheduleScrollIndicatorUpdate } from './viewport-transform'
import type { TerminalDocumentScope } from './document-scope'
import { logFeedAndEvict } from './selection-state-and-eviction'
import {
  emitKeyboardAvoidanceMetrics,
  requestKeyboardAvoidanceMetrics
} from './keyboard-avoidance-metrics'
import { syncTerminalScreenTransformToRender } from './normal-buffer-smooth-scroll'
import { emitModesIfChanged } from './mode-mirroring'

export function attachTermObservers(scope: TerminalDocumentScope) {
  if (!scope.term) {
    return
  }
  disposeTermObservers(scope)
  try {
    scope.termObserverDisposables.push(
      scope.term.onLineFeed!(function () {
        logFeedAndEvict(scope)
      })
    )
  } catch {}
  try {
    scope.termObserverDisposables.push(
      scope.term.onScroll!(function () {
        scheduleScrollIndicatorUpdate(scope, false)
      })
    )
  } catch {}
  // Why: the frame xterm actually paints a scrolled row is the only frame the
  // sub-row remainder may change on. See syncTerminalScreenTransformToRender.
  try {
    if (scope.term.onRender) {
      scope.termObserverDisposables.push(
        scope.term.onRender(() => syncTerminalScreenTransformToRender(scope))
      )
    }
  } catch {}
  // Why: emit modes on every parsed write so RN's mirror stays current
  // without round-trip; covers \x1b[?2004h/l and alt-screen toggles.
  try {
    if (scope.term.onWriteParsed) {
      scope.termObserverDisposables.push(
        scope.term.onWriteParsed(function () {
          emitModesIfChanged(scope)
          requestKeyboardAvoidanceMetrics(scope)
        })
      )
    }
  } catch {}
  // Initial emit once buffer settles.
  afterWritesDrained(scope, function () {
    emitModesIfChanged(scope)
    emitKeyboardAvoidanceMetrics(scope)
  })
}
