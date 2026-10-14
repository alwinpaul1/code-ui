import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import {
  clearTerminalLiveInputFocusTimer,
  focusTerminalLiveInputTarget,
  scheduleTerminalLiveInputFocus,
  type TerminalLiveInputFocusTarget,
  type TerminalLiveInputFocusTimerRef
} from './terminal-live-input'
import {
  clearKeyboardRelease,
  keyboardReleased,
  releaseKeyboard
} from '../session/keyboard-release'

type TerminalLiveInputFocusContext = {
  readonly canSend: boolean
  readonly keyboardHeight: number
  readonly liveInputEnabled: boolean
}

type DockFieldContext = TerminalLiveInputFocusContext & {
  /** The buffered command field may take keys (composing is local). */
  readonly canCompose: boolean
}

type UseTerminalLiveInputFocusOptions<T extends TerminalLiveInputFocusTarget> =
  TerminalLiveInputFocusContext & {
    readonly activeHandleRef: RefObject<string | null>
    readonly canCompose: boolean
    /** The buffered command field, the dock's field while live input is off. */
    readonly commandInputRef: RefObject<TerminalLiveInputFocusTarget | null>
    readonly inputRef: RefObject<T | null>
    /** Whether any text field holds focus, as React Native records it
     *  (`anyTextFieldFocused` in session/text-field-focus.ts). Passed in so
     *  this module does not reach react-native. */
    readonly isAnyTextFieldFocused: () => boolean
    readonly lifecycleIdentity: object | null
    readonly lifecycleKey: string
    readonly timerRef: TerminalLiveInputFocusTimerRef
  }

type TerminalLiveInputFocusHandlers = {
  /** A dock field (live or command) came on screen: claim an open keyboard no field holds. */
  readonly armLiveInputKeyboardClaim: () => void
  readonly focusLiveInput: () => void
  /** A dock field's own onBlur. */
  readonly handleLiveInputBlur: () => void
  /** A dock field's own onFocus. */
  readonly handleLiveInputFocus: () => void
  readonly handleTerminalTap: (handle: string) => void
  /** The app is putting the keyboard away on purpose: the next blur is not
   *  one to undo, and a pending claim is dropped. */
  readonly releaseLiveInputKeyboard: () => void
  /** The session screen gained (true) or lost (false) navigation focus. */
  readonly reportLiveInputScreenFocus: (focused: boolean) => void
  readonly resetLiveInputFocus: () => void
}

/** How long the keyboard must stay up, with no field focused, before the live
 *  field takes it back. The chat composer's COMPOSER_KEYBOARD_SETTLE_MS, for
 *  the same reason: Android clears the keyboard height only at the end of its
 *  hide animation, so a keyboard that is leaving still reads as up for about
 *  that long. Not imported from there: that module reaches react-native. */
export const LIVE_INPUT_KEYBOARD_SETTLE_MS = 500
/** After the settle, how often the claim looks again, and for how long after
 *  it was armed. A single look missed a field that was not ready at that
 *  instant (the tab's PTY not named yet, the old field's focus not cleared
 *  yet, the replacement field not mounted yet) and never looked again. */
export const LIVE_INPUT_KEYBOARD_RETRY_MS = 250
export const LIVE_INPUT_KEYBOARD_CLAIM_MS = 2000

export function useTerminalLiveInputFocus<T extends TerminalLiveInputFocusTarget>({
  activeHandleRef,
  canCompose,
  canSend,
  commandInputRef,
  inputRef,
  isAnyTextFieldFocused,
  keyboardHeight,
  lifecycleIdentity,
  lifecycleKey,
  liveInputEnabled,
  timerRef
}: UseTerminalLiveInputFocusOptions<T>): TerminalLiveInputFocusHandlers {
  const contextRef = useRef<TerminalLiveInputFocusContext>({
    canSend,
    keyboardHeight,
    liveInputEnabled
  })
  const dockRef = useRef<DockFieldContext>({
    canCompose,
    canSend,
    keyboardHeight,
    liveInputEnabled
  })
  useLayoutEffect(() => {
    contextRef.current = { canSend, keyboardHeight, liveInputEnabled }
    dockRef.current = { canCompose, canSend, keyboardHeight, liveInputEnabled }
    if (keyboardHeight <= 0) {
      clearKeyboardRelease()
    }
  }, [canCompose, canSend, keyboardHeight, liveInputEnabled])

  // Keyboard claim state; see claimOrphanedKeyboard below.
  const heldRef = useRef(false)
  const screenFocusedRef = useRef(false)
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelKeyboardClaim = useCallback(() => {
    if (claimTimerRef.current !== null) {
      clearTimeout(claimTimerRef.current)
      claimTimerRef.current = null
    }
  }, [])
  useLayoutEffect(() => cancelKeyboardClaim, [cancelKeyboardClaim])

  const resetLiveInputFocus = useCallback(() => {
    clearTerminalLiveInputFocusTimer(timerRef)
    // A blur this app asks for is never one to undo.
    heldRef.current = false
    cancelKeyboardClaim()
    inputRef.current?.blur()
  }, [cancelKeyboardClaim, inputRef, timerRef])

  // Retained Expo routes must not carry focus work across navigation or reconnect scopes.
  useLayoutEffect(() => resetLiveInputFocus, [lifecycleIdentity, lifecycleKey, resetLiveInputFocus])

  const focusLiveInput = useCallback(() => {
    const context = contextRef.current
    if (!context.canSend || !context.liveInputEnabled) {
      return
    }
    focusTerminalLiveInputTarget(inputRef.current, {
      keyboardHeight: context.keyboardHeight,
      refocus: () => scheduleTerminalLiveInputFocus(timerRef, focusLiveInput)
    })
  }, [inputRef, timerRef])

  const handleTerminalTap = useCallback(
    (handle: string) => {
      const context = contextRef.current
      if (handle !== activeHandleRef.current || !context.canSend || !context.liveInputEnabled) {
        return
      }
      // WKWebView still owns first responder during its touchend notification.
      scheduleTerminalLiveInputFocus(timerRef, () => {
        if (activeHandleRef.current === handle) {
          focusLiveInput()
        }
      })
    },
    [activeHandleRef, focusLiveInput, timerRef]
  )

  /**
   * Never a keyboard up over the live field while the field does not hold it.
   *
   * Reported 2026-10-14 from a Samsung phone: the keyboard up over a terminal
   * tab, the live field reading "Tap to type" with no caret and its border not
   * in the focused accent, so it was not focused. Android leaves the keyboard
   * up when focus moves from a field to a view that is not one, and the
   * terminal pane is a WebView, which takes view focus on a touch. A tap that
   * posts terminal-tap is refocused by handleTerminalTap above, but a tap on a
   * program that tracks the mouse is a click and posts nothing (5c62f7201),
   * and neither does a scroll. A live field mounted under a keyboard left up
   * (a tab switch from chat) is the same state from the other side; the chat
   * composer handles its own case in use-composer-keeps-keyboard.ts.
   *
   * So when the dock's field loses a focus it held, or comes on screen, it
   * takes the keyboard back once that has stayed up for
   * LIVE_INPUT_KEYBOARD_SETTLE_MS with no text field focused. The field is
   * whichever the bar draws: the live field, or the buffered command field
   * while live input is off. It keeps looking every
   * LIVE_INPUT_KEYBOARD_RETRY_MS until LIVE_INPUT_KEYBOARD_CLAIM_MS: on
   * 0.9.141 a new terminal tab that started Claude still left the keyboard
   * up with nothing focused (2026-10-14), because one look at the settle
   * found the tab not ready yet and never looked again. A blur this app asks
   * for goes through resetLiveInputFocus or releaseLiveInputKeyboard (which
   * also releases the keyboard for the chat composer, keyboard-release.ts),
   * so it is never undone. Another field that takes focus keeps it.
   */
  const claimOrphanedKeyboard = useCallback(() => {
    if (claimTimerRef.current !== null) {
      return
    }
    const until = Date.now() + LIVE_INPUT_KEYBOARD_CLAIM_MS
    const look = (): void => {
      claimTimerRef.current = null
      const dock = dockRef.current
      if (dock.keyboardHeight <= 0 || keyboardReleased() || !screenFocusedRef.current) {
        // Down, put away on purpose, or not on screen: nothing to keep.
        return
      }
      const live = dock.liveInputEnabled
      const input = live ? inputRef.current : commandInputRef.current
      if (input && (live ? dock.canSend : dock.canCompose) && !isAnyTextFieldFocused()) {
        // The one line this leaves behind. If keys still go nowhere after it,
        // native refused the focus.
        console.warn(
          `[live-input] claimed an open keyboard no field held for the ${live ? 'live' : 'command'} field`
        )
        input.focus()
        return
      }
      if (Date.now() < until) {
        claimTimerRef.current = setTimeout(look, LIVE_INPUT_KEYBOARD_RETRY_MS)
      }
    }
    claimTimerRef.current = setTimeout(look, LIVE_INPUT_KEYBOARD_SETTLE_MS)
  }, [commandInputRef, inputRef, isAnyTextFieldFocused])

  const handleLiveInputFocus = useCallback(() => {
    heldRef.current = true
    cancelKeyboardClaim()
  }, [cancelKeyboardClaim])

  const handleLiveInputBlur = useCallback(() => {
    if (!heldRef.current) {
      return
    }
    heldRef.current = false
    claimOrphanedKeyboard()
  }, [claimOrphanedKeyboard])

  // Every path that puts the keyboard away on purpose (a dismissal, live input
  // off, the tab action sheet, select mode) says so first, so the blur that
  // follows is not taken for a theft. Waiting for keyboardDidHide alone is
  // a race: it can land after the settle (the action sheet keeps a 450 ms
  // fallback for exactly that), and a Keyboard.dismiss() with no RN field
  // focused may not hide anything at all.
  const releaseLiveInputKeyboard = useCallback(() => {
    heldRef.current = false
    releaseKeyboard()
    cancelKeyboardClaim()
  }, [cancelKeyboardClaim])

  const reportLiveInputScreenFocus = useCallback(
    (focused: boolean) => {
      const returned = focused && !screenFocusedRef.current
      screenFocusedRef.current = focused
      if (!focused) {
        cancelKeyboardClaim()
      } else if (returned) {
        // Back on top over a keyboard nobody holds: the same claim as a mount.
        claimOrphanedKeyboard()
      }
    },
    [cancelKeyboardClaim, claimOrphanedKeyboard]
  )

  return {
    armLiveInputKeyboardClaim: claimOrphanedKeyboard,
    focusLiveInput,
    handleLiveInputBlur,
    handleLiveInputFocus,
    handleTerminalTap,
    releaseLiveInputKeyboard,
    reportLiveInputScreenFocus,
    resetLiveInputFocus
  }
}
