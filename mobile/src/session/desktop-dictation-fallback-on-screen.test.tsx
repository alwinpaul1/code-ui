import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

/**
 * Where desktop dictation lands when it cannot go where it was meant to, read off the real dock.
 *
 * 557c4233 kept the words of a failed live insert in the buffered command draft and toasted "kept in
 * the command box". While live input is on, MobileSessionCommandDock draws the live capture field
 * and the buffered "Type a command…" box is not mounted, so the words sat in hidden state under a
 * toast pointing at nothing, and came back unasked when live input was switched off (review,
 * 2026-09-30). Its tests checked a setInput mock and never the dock. These render the dock the user
 * is looking at, and hold the fallback to it: the words are in a field on screen or on the
 * clipboard, and the toast names the one they are in.
 */

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style },
  useColorScheme: () => 'dark'
}))
vi.mock('lucide-react-native', () => ({ ArrowUp: 'ArrowUp' }))
// The strip above the bar and the mic/attach buttons beside it: not where the words go.
vi.mock('./MobileSessionAccessoryStrip', () => ({ MobileSessionAccessoryStrip: () => null }))
vi.mock('./MobileTerminalInputActions', () => ({ MobileTerminalInputActions: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import {
  deliverSessionDesktopDictation,
  type DesktopDictationSession
} from '../dictation/place-dictation-transcript'
import { MobileSessionCommandDock } from './MobileSessionCommandDock'
import type { MobileSessionController } from './use-mobile-session-controller'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The session state the dock and the fallback both read, as the session hooks keep it. */
type World = {
  drafts: Record<string, string>
  activeHandleRef: { current: string | null }
  liveInputTerminalHandlesRef: { current: Set<string> }
  /** Filled by the dock's own ref callback while the buffered box is mounted. */
  commandInputRef: { current: unknown }
  fileTabOpen: boolean
  toasts: string[]
  clipboard: string[]
}

function world(active: string | null, liveHandles: string[]): World {
  return {
    drafts: {},
    activeHandleRef: { current: active },
    liveInputTerminalHandlesRef: { current: new Set(liveHandles) },
    commandInputRef: { current: null },
    fileTabOpen: false,
    toasts: [],
    clipboard: []
  }
}

/** useBufferedTerminalDrafts' setInput: it writes the ACTIVE handle's draft, and nothing without one. */
function setInputOf(w: World) {
  return (update: (current: string) => string): void => {
    const handle = w.activeHandleRef.current
    if (handle) {
      w.drafts[handle] = update(w.drafts[handle] ?? '')
    }
  }
}

function controllerFor(w: World): MobileSessionController {
  const handle = w.activeHandleRef.current
  const noop = () => undefined
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; every field the dock reads is set here.
  return {
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferedTerminalDraftState: { input: handle ? (w.drafts[handle] ?? '') : '', setInput: setInputOf(w) },
    autocompleteEnabled: false,
    liveInputCapture: '',
    dictationMode: 'toggle',
    bindCommandField: (node: unknown) => {
      w.commandInputRef.current = node
    },
    bindLiveInputField: noop,
    handleLiveInputChange: noop,
    handleLiveInputKeyPress: noop,
    submitLiveInput: noop,
    activeSessionTab: w.fileTabOpen ? { type: 'file', id: 'file-1' } : { type: 'terminal', id: 'tab-1' },
    canSend: true,
    canCompose: true,
    liveInputEnabled: handle ? w.liveInputTerminalHandlesRef.current.has(handle) : false,
    showNativeChat: false,
    dictation: { isStarting: false, isRecording: false, isProcessing: false },
    cancelDictation: noop,
    handleDictationToggle: noop,
    handleDictationPressIn: noop,
    handleDictationPressOut: noop,
    handleSend: async () => undefined,
    isAttaching: false,
    attachImage: async () => undefined,
    attachDocument: async () => undefined,
    activeMarkdownTab: null,
    activeFileTab: w.fileTabOpen ? { type: 'file', id: 'file-1' } : null,
    activeBrowserTab: null,
    keyboardLift: 0,
    nativeChatController: { viewResolved: true, chatViewSelected: false },
    showLoadingState: false
  } as unknown as MobileSessionController
}

let renderer: ReactTestRenderer | null = null
let warn: MockInstance<typeof console.warn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  warn.mockRestore()
})

function draw(w: World): void {
  const element = (
    <ThemeProvider initialPreference="dark">
      <MobileSessionCommandDock controller={controllerFor(w)} />
    </ThemeProvider>
  )
  act(() => {
    if (renderer) {
      renderer.update(element)
    } else {
      // A node for every host ref, so the dock's ref callbacks see mounts and unmounts.
      renderer = create(element, { createNodeMock: () => ({}) })
    }
  })
}

/** What the text fields on screen hold right now. */
function fieldsOnScreen(): string[] {
  return (renderer?.root.findAll((node) => String(node.type) === 'TextInput') ?? []).map((node) =>
    String(node.props.value ?? '')
  )
}

function deliver(
  w: World,
  args: {
    routeContext: { handle: string; liveInputEnabled: boolean }
    send?: () => Promise<boolean>
  }
): void {
  // Through the same session seam the dictation hook calls, with the refs the dock reads.
  const session: DesktopDictationSession = {
    ...w,
    dictationRouteContextRef: { current: args.routeContext },
    liveInputEnabled: args.routeContext.liveInputEnabled,
    flushPendingLiveInputBeforeExternalSend: async () => true,
    setInput: setInputOf(w),
    showToast: (message) => void w.toasts.push(message)
  }
  deliverSessionDesktopDictation(session, 'hello', {
    showNativeChat: false,
    setChatComposerText: () => {
      throw new Error('terminal dictation must not touch the chat composer')
    },
    sendLiveTerminalInput: args.send ?? (async () => false),
    copyToClipboard: async (text) => {
      w.clipboard.push(text)
    }
  })
  // Taken once: a later transcript cannot reuse the route this one started on.
  expect(session.dictationRouteContextRef.current).toBeNull()
}

/**
 * The words are somewhere the user can see or reach now, and the toast names that place: a field
 * the dock draws, or the clipboard. Never a draft the dock is not drawing.
 */
function expectReachable(w: World): void {
  const toast = w.toasts.at(-1) ?? ''
  const onScreen = fieldsOnScreen().some((value) => value.includes('hello'))
  if (/command box/i.test(toast)) {
    expect(onScreen, `"${toast}" but no field on screen holds the words`).toBe(true)
  } else if (/clipboard/i.test(toast)) {
    expect(w.clipboard).toEqual(['hello'])
  } else if (toast === 'Dictation inserted') {
    expect(onScreen, '"Dictation inserted" but no field on screen holds the words').toBe(true)
  } else {
    throw new Error(`toast names no place the words went: "${toast}"`)
  }
  const hidden = Object.values(w.drafts).some((draft) => draft.includes('hello')) && !onScreen
  expect(hidden, 'the words sit in a draft the dock is not drawing').toBe(false)
}

describe('desktop dictation the live terminal would not take, with the dock drawing the live field', () => {
  it('is on the clipboard, and the toast says so, not in a command box that is not on screen', async () => {
    const w = world('h1', ['h1'])
    draw(w)
    expect(w.commandInputRef.current).toBeNull()
    deliver(w, { routeContext: { handle: 'h1', liveInputEnabled: true } })
    await settle()
    draw(w)
    expectReachable(w)
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toMatch(/clipboard/i)
    expect(w.drafts.h1 ?? '').toBe('')
  })

  it('is in the command box the dock draws once live input was switched off during the send', async () => {
    const w = world('h1', ['h1'])
    draw(w)
    deliver(w, {
      routeContext: { handle: 'h1', liveInputEnabled: true },
      send: async () => {
        w.liveInputTerminalHandlesRef.current = new Set()
        draw(w)
        return false
      }
    })
    await settle()
    draw(w)
    expectReachable(w)
    expect(w.toasts).toEqual(['Dictation not inserted — kept in the command box'])
    expect(fieldsOnScreen()).toEqual(['hello'])
    expect(w.clipboard).toEqual([])
  })
})

describe('desktop dictation on the buffered route', () => {
  it('lands in the command box on screen with "Dictation inserted"', async () => {
    const w = world('h1', [])
    w.drafts.h1 = 'ls'
    draw(w)
    deliver(w, { routeContext: { handle: 'h1', liveInputEnabled: false } })
    await settle()
    draw(w)
    expectReachable(w)
    expect(w.toasts).toEqual(['Dictation inserted'])
    expect(fieldsOnScreen()).toEqual(['ls hello'])
    expect(w.clipboard).toEqual([])
  })

  it('is copied, not dropped, when a file tab was opened before the words came back', async () => {
    const w = world('h1', [])
    draw(w)
    // The tab switch clears the active handle (use-mobile-session-tab-switching.ts) and the dock
    // steps aside for the file, so setInput has nowhere to write and nothing draws the box.
    w.activeHandleRef.current = null
    w.fileTabOpen = true
    draw(w)
    deliver(w, { routeContext: { handle: 'h1', liveInputEnabled: false } })
    await settle()
    draw(w)
    expect(fieldsOnScreen()).toEqual([])
    expectReachable(w)
    expect(w.clipboard).toEqual(['hello'])
  })

  it('is copied, not hidden, when the user moved to a terminal with live input on', async () => {
    const w = world('h1', ['h2'])
    draw(w)
    w.activeHandleRef.current = 'h2'
    draw(w)
    deliver(w, { routeContext: { handle: 'h1', liveInputEnabled: false } })
    await settle()
    draw(w)
    expectReachable(w)
    expect(w.drafts.h2 ?? '').toBe('')
    expect(w.clipboard).toEqual(['hello'])
  })
})
