import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalLiveInputFocusTarget,
  TerminalLiveInputFocusTimerRef
} from './terminal-live-input'
import { clearKeyboardRelease } from '../session/keyboard-release'
import {
  LIVE_INPUT_KEYBOARD_CLAIM_MS,
  LIVE_INPUT_KEYBOARD_RETRY_MS,
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
  readonly canCompose?: boolean
  readonly commandInputRef?: RefObject<TerminalLiveInputFocusTarget | null>
  readonly inputRef: RefObject<TerminalLiveInputFocusTarget | null>
  readonly keyboardHeight: number
  readonly liveInputEnabled: boolean
}

type Handlers = ReturnType<typeof useTerminalLiveInputFocus>

const NO_COMMAND_FIELD: RefObject<TerminalLiveInputFocusTarget | null> = { current: null }
let renderer: ReactTestRenderer | null = null
let handlers: Handlers | null = null
const timerRef: TerminalLiveInputFocusTimerRef = { current: null }
const activeHandleRef = { current: 'term_claude' as string | null }

function Harness(props: Props): null {
  handlers = useTerminalLiveInputFocus({
    ...props,
    canCompose: props.canCompose ?? true,
    commandInputRef: props.commandInputRef ?? NO_COMMAND_FIELD,
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
  clearKeyboardRelease()
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
    expect(console.warn).toHaveBeenCalledWith(
      '[live-input] claimed an open keyboard no field held for the live field'
    )
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

// Reported 2026-10-14 on 0.9.141 (which carried the claim above): open a new
// terminal tab, type `claude`, and once Claude Code is up the keyboard is open
// but keys appear nowhere and no field shows a caret. The claim looked once,
// at the settle, and only for the live field. A new tab is still settling at
// that instant: its PTY handle lands (the tab cannot take keys yet), the field
// the keyboard came from still reads as focused for a moment, or the bar is
// the buffered command field. These cases are the terminal ending; the chat
// ending is in composer-keeps-keyboard-focus.test.tsx.
describe('a new terminal tab that starts Claude keeps typed keys in the box on screen', () => {
  const settle = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('takes the keyboard once the new tab can take keys, after the settle', () => {
    const field = liveField()
    const inputRef = { current: field }
    const hook = mount({ canSend: false, inputRef, keyboardHeight: 320, liveInputEnabled: true })
    hook.reportLiveInputScreenFocus(true)

    hook.armLiveInputKeyboardClaim()
    settle(LIVE_INPUT_KEYBOARD_SETTLE_MS + 200)
    expect(field.focus).not.toHaveBeenCalled()
    // The host names the tab's PTY (the session's field ref is one object).
    rerender({ canSend: true, inputRef, keyboardHeight: 320, liveInputEnabled: true })
    settle(LIVE_INPUT_KEYBOARD_RETRY_MS)

    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('takes the keyboard once the field it came from stops reading as focused', () => {
    const field = liveField()
    native.someFieldFocused = true // the unmounted field, still on React Native's record
    const hook = mount({
      canSend: true,
      inputRef: { current: field },
      keyboardHeight: 320,
      liveInputEnabled: true
    })
    hook.reportLiveInputScreenFocus(true)

    hook.armLiveInputKeyboardClaim()
    settle(LIVE_INPUT_KEYBOARD_SETTLE_MS + 300)
    native.someFieldFocused = false
    settle(LIVE_INPUT_KEYBOARD_RETRY_MS)

    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('gives the keyboard to the buffered command field when that is the bar on screen', () => {
    const live = liveField()
    const command = liveField()
    const hook = mount({
      canSend: true,
      commandInputRef: { current: command },
      inputRef: { current: live },
      keyboardHeight: 320,
      liveInputEnabled: false
    })
    hook.reportLiveInputScreenFocus(true)

    hook.armLiveInputKeyboardClaim()
    settle(LIVE_INPUT_KEYBOARD_SETTLE_MS)

    expect(command.focus).toHaveBeenCalledTimes(1)
    expect(live.focus).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      '[live-input] claimed an open keyboard no field held for the command field'
    )
  })

  it('never brings back a keyboard the app put away, however late keyboardDidHide is', () => {
    const field = liveField()
    const hook = mount({
      canSend: true,
      inputRef: { current: field },
      keyboardHeight: 320,
      liveInputEnabled: true
    })
    hook.reportLiveInputScreenFocus(true)

    hook.releaseLiveInputKeyboard()
    hook.armLiveInputKeyboardClaim()
    settle(LIVE_INPUT_KEYBOARD_CLAIM_MS + LIVE_INPUT_KEYBOARD_SETTLE_MS)

    expect(field.focus).not.toHaveBeenCalled()
  })

  it('stops looking when the window closes with no field mounted, leaving no timer behind', () => {
    const hook = mount({
      canSend: true,
      inputRef: { current: null },
      keyboardHeight: 320,
      liveInputEnabled: true
    })
    hook.reportLiveInputScreenFocus(true)

    hook.armLiveInputKeyboardClaim()
    settle(LIVE_INPUT_KEYBOARD_CLAIM_MS + LIVE_INPUT_KEYBOARD_SETTLE_MS)

    expect(vi.getTimerCount()).toBe(0)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('degenerate: a command field that cannot compose is never focused', () => {
    const command = liveField()
    const hook = mount({
      canCompose: false,
      canSend: true,
      commandInputRef: { current: command },
      inputRef: { current: null },
      keyboardHeight: 320,
      liveInputEnabled: false
    })
    hook.reportLiveInputScreenFocus(true)

    hook.armLiveInputKeyboardClaim()
    settle(LIVE_INPUT_KEYBOARD_CLAIM_MS + LIVE_INPUT_KEYBOARD_SETTLE_MS)

    expect(command.focus).not.toHaveBeenCalled()
  })
})
