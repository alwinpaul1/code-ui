import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalLiveInputFocusTarget,
  TerminalLiveInputFocusTimerRef
} from './terminal-live-input'
import {
  LIVE_INPUT_KEYBOARD_SETTLE_MS,
  useTerminalLiveInputFocus
} from './use-terminal-live-input-focus'

// Reported 2026-10-14 from a Samsung phone (screenshot): a terminal tab with
// live input, the soft keyboard up, the live field reading "Tap to type" with
// no caret, and its border in colors.border rather than the focused accent.
// The field was not focused while the keyboard was. Android leaves the
// keyboard up when focus moves from a field to a view that is not one; the
// terminal pane is a WebView, which takes view focus on a touch, and a tap on
// a program that tracks the mouse (Claude Code) or a scroll posts no
// terminal-tap to refocus the field. These drive the session's live-input
// focus hook with the keyboard height the screen reports and React Native's
// focus record as a flag.

type Field = TerminalLiveInputFocusTarget & {
  readonly blur: ReturnType<typeof vi.fn>
  readonly focus: ReturnType<typeof vi.fn>
}

const native = { someFieldFocused: false }

function liveField(): Field {
  return {
    blur: vi.fn(() => {
      native.someFieldFocused = false
    }),
    focus: vi.fn(() => {
      native.someFieldFocused = true
    }),
    isFocused: () => native.someFieldFocused
  }
}

type Props = {
  readonly canSend: boolean
  readonly inputRef: RefObject<TerminalLiveInputFocusTarget | null>
  readonly keyboardHeight: number
  readonly liveInputEnabled: boolean
}

type Handlers = ReturnType<typeof useTerminalLiveInputFocus>

let renderer: ReactTestRenderer | null = null
let handlers: Handlers | null = null
const timerRef: TerminalLiveInputFocusTimerRef = { current: null }
const activeHandleRef = { current: 'term_claude' as string | null }

function Harness(props: Props): null {
  handlers = useTerminalLiveInputFocus({
    ...props,
    activeHandleRef,
    isAnyTextFieldFocused: () => native.someFieldFocused,
    lifecycleIdentity: null,
    lifecycleKey: 'host:worktree:connected',
    timerRef
  })
  return null
}

function mount(props: Props): Handlers {
  act(() => {
    renderer = create(createElement(Harness, props))
  })
  return handlers!
}

function rerender(props: Props): void {
  act(() => renderer!.update(createElement(Harness, props)))
}

/** The field held the keyboard: the screen is on top and the field focused. */
function typing(field: Field, keyboardHeight = 320): Handlers {
  const hook = mount({
    canSend: true,
    inputRef: { current: field },
    keyboardHeight,
    liveInputEnabled: true
  })
  hook.reportLiveInputScreenFocus(true)
  field.focus()
  hook.handleLiveInputFocus()
  field.focus.mockClear()
  return hook
}

/** Native moves focus off the field (the WebView took it); the keyboard stays. */
function focusTakenByTerminal(hook: Handlers): void {
  native.someFieldFocused = false
  hook.handleLiveInputBlur()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  native.someFieldFocused = false
  timerRef.current = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  handlers = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the live field keeps the keyboard it holds', () => {
  it('takes the keyboard back when a touch on the terminal takes focus and the keyboard stays up', () => {
    const field = liveField()
    const hook = typing(field)

    focusTakenByTerminal(hook)
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).toHaveBeenCalledTimes(1)
    // The diagnostic line it leaves behind.
    expect(console.warn).toHaveBeenCalledWith('[live-input] claimed an open keyboard no field held')
  })

  it('waits for the keyboard to settle before it claims, so a keyboard on its way down is not raised', () => {
    const field = liveField()
    const hook = typing(field)

    focusTakenByTerminal(hook)
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS - 1)
    })
    expect(field.focus).not.toHaveBeenCalled()
    // keyboardDidHide reports the height gone before the settle ends.
    rerender({
      canSend: true,
      inputRef: { current: field },
      keyboardHeight: 0,
      liveInputEnabled: true
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('leaves the keyboard to another field that took focus', () => {
    const field = liveField()
    const hook = typing(field)

    hook.handleLiveInputBlur()
    native.someFieldFocused = true // a sheet's own field
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('never raises the keyboard again after the app puts it away, even when keyboardDidHide is late', () => {
    // A dismissal, live input off, the tab action sheet, select mode: the
    // keyboard height still reads as up past the settle.
    const field = liveField()
    const hook = typing(field)

    hook.releaseLiveInputKeyboard()
    focusTakenByTerminal(hook) // the native blur event that follows, no field focused
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS * 2)
    })

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('drops a pending claim when select mode puts the keyboard away after a long press', () => {
    const field = liveField()
    const hook = typing(field)

    focusTakenByTerminal(hook) // the long press took view focus
    hook.releaseLiveInputKeyboard()
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('never undoes a blur the app asked for (a covered screen, a reconnect)', () => {
    const field = liveField()
    const hook = typing(field)

    act(() => hook.resetLiveInputFocus())
    hook.handleLiveInputBlur() // the native blur event that follows
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('claims nothing under a covered screen', () => {
    const field = liveField()
    const hook = typing(field)

    focusTakenByTerminal(hook)
    hook.reportLiveInputScreenFocus(false)
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('claims nothing once live input is off or the terminal cannot take keys', () => {
    for (const change of [{ liveInputEnabled: false }, { canSend: false }]) {
      const field = liveField()
      const hook = typing(field)
      focusTakenByTerminal(hook)
      rerender({
        canSend: true,
        inputRef: { current: field },
        keyboardHeight: 320,
        liveInputEnabled: true,
        ...change
      })
      act(() => {
        vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
      })
      expect(field.focus, JSON.stringify(change)).not.toHaveBeenCalled()
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('takes a keyboard left up with no field focused when the live field comes on screen', () => {
    // A tab switch from chat with the keyboard up: the composer leaves, the
    // live field mounts unfocused under the keyboard.
    const field = liveField()
    const hook = mount({
      canSend: true,
      inputRef: { current: field },
      keyboardHeight: 320,
      liveInputEnabled: true
    })
    hook.reportLiveInputScreenFocus(true)

    hook.armLiveInputKeyboardClaim()
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('takes a keyboard nobody holds when the session screen comes back on top', () => {
    const field = liveField()
    const hook = mount({
      canSend: true,
      inputRef: { current: field },
      keyboardHeight: 320,
      liveInputEnabled: true
    })
    hook.reportLiveInputScreenFocus(false)

    hook.reportLiveInputScreenFocus(true)
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('never raises a keyboard that is down when the live field comes on screen', () => {
    const field = liveField()
    const hook = mount({
      canSend: true,
      inputRef: { current: field },
      keyboardHeight: 0,
      liveInputEnabled: true
    })
    hook.reportLiveInputScreenFocus(true)

    hook.armLiveInputKeyboardClaim()
    act(() => {
      vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
    })

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('does nothing, and does not throw, when the live field has already gone', () => {
    const inputRef: RefObject<TerminalLiveInputFocusTarget | null> = { current: liveField() }
    const hook = mount({ canSend: true, inputRef, keyboardHeight: 320, liveInputEnabled: true })
    hook.reportLiveInputScreenFocus(true)
    hook.handleLiveInputFocus()
    inputRef.current = null

    hook.handleLiveInputBlur()
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(LIVE_INPUT_KEYBOARD_SETTLE_MS)
      })
    ).not.toThrow()
    expect(console.warn).not.toHaveBeenCalled()
  })
})
