import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 0.9.132 (2026-10-13, screen recording): "Opens in desktop and flashes and
 * changes to mobile." Opening the Code UI worktree painted the cached tab
 * strip at once, before the host named Terminal 1's PTY. For those frames the
 * terminal bar drew the state of NO terminal: the display-mode key showed the
 * phone glyph (labelled "Switch to phone mode", so the tab read as desktop
 * mode) and the bar was the buffered "Type a command…" box. When the handle
 * landed the key flipped to the monitor glyph (phone mode) and the bar to the
 * live "Tap to type" field. Both flips were wrong-state frames, not loading.
 *
 * Before the handle, the bar draws the shape the tab opens in — phone mode
 * (a tab's display mode is 'auto' until the host says otherwise) and the live
 * field (every terminal defaults to live input) — dimmed, since there is
 * nothing to type into yet. Read off the real dock and key strip.
 */

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style },
  useColorScheme: () => 'dark'
}))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronsRight: 'ChevronsRight',
  Keyboard: 'Keyboard',
  Monitor: 'Monitor',
  Plus: 'Plus',
  Smartphone: 'Smartphone'
}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: () => undefined }))
vi.mock('./MobileTerminalInputActions', () => ({ MobileTerminalInputActions: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { MobileSessionCommandDock } from './MobileSessionCommandDock'
import type { MobileSessionController } from './use-mobile-session-controller'

type Pane = {
  /** The PTY the host named for the tab, or null before it has. */
  activeHandle: string | null
  liveHandles: string[]
  modes: Array<[string, 'auto' | 'phone' | 'desktop']>
}

function controllerFor(pane: Pane): MobileSessionController {
  const noop = () => undefined
  const { activeHandle } = pane
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; every field the dock and its strip read is set here.
  return {
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferedTerminalDraftState: { input: '', setInput: noop },
    autocompleteEnabled: false,
    liveInputCapture: '',
    dictationMode: 'toggle',
    bindCommandField: noop,
    bindLiveInputField: noop,
    handleLiveInputChange: noop,
    handleLiveInputKeyPress: noop,
    submitLiveInput: noop,
    activeSessionTab: { type: 'terminal', id: 'tab-ag::leaf-1' },
    activeHandle,
    // As use-mobile-session-terminal-runtime derives them: nothing to send to without a handle.
    canSend: activeHandle != null,
    canCompose: activeHandle != null,
    liveInputEnabled: activeHandle ? pane.liveHandles.includes(activeHandle) : false,
    terminalModes: new Map(pane.modes),
    canPaste: false,
    customKeys: [],
    visibleBuiltInAccessoryKeys: [],
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
    activeFileTab: null,
    activeBrowserTab: null,
    keyboardLift: 0,
    nativeChatController: { viewResolved: true, chatViewSelected: false },
    showLoadingState: false,
    toggleDisplayMode: noop,
    toggleLiveInput: noop,
    handleAccessoryKey: noop,
    dismissSoftwareKeyboard: noop,
    stopAccessoryRepeat: noop,
    startAccessoryRepeat: noop,
    didAccessoryRepeatFire: () => false,
    handlePaste: noop,
    setShowCustomKeyModal: noop,
    setDeleteKeyTarget: noop
  } as unknown as MobileSessionController
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function draw(pane: Pane, scheme: 'light' | 'dark'): ReactTestInstance {
  const element = (
    <ThemeProvider initialPreference={scheme}>
      <MobileSessionCommandDock controller={controllerFor(pane)} />
    </ThemeProvider>
  )
  act(() => {
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element, { createNodeMock: () => ({}) })
    }
  })
  return renderer!.root
}

/** What the bar says about the tab: its mode key's label and glyph, and the input it draws. */
function bar(root: ReactTestInstance) {
  const modeKey = root.find(
    (node) => String(node.type) === 'Pressable' && /Switch to (phone|desktop) mode/.test(String(node.props.accessibilityLabel))
  )
  const glyph = modeKey.findAll((node) => String(node.type) === 'Monitor' || String(node.type) === 'Smartphone')[0]
  const field = root.findAll((node) => String(node.type) === 'TextInput')[0]
  return {
    modeLabel: String(modeKey.props.accessibilityLabel),
    glyph: String(glyph?.type),
    placeholder: String(field?.props.placeholder),
    fieldEditable: Boolean(field?.props.editable)
  }
}

describe.each(['light', 'dark'] as const)('opening a terminal tab in a %s session', (scheme) => {
  it('draws phone mode and the live bar before the host names the pane, never desktop mode then a flip', () => {
    const before = bar(draw({ activeHandle: null, liveHandles: [], modes: [] }, scheme))
    expect(before).toEqual({
      modeLabel: 'Switch to desktop mode',
      glyph: 'Monitor',
      placeholder: 'Tap to type',
      fieldEditable: false
    })

    // The handle lands: the bar keeps its shape and only wakes up.
    const after = bar(draw({ activeHandle: 'pty-antigravity', liveHandles: ['pty-antigravity'], modes: [] }, scheme))
    expect(after).toEqual({ ...before, fieldEditable: true })
  })

  it('still draws what a pane the host put in desktop mode, with buffered input, actually is', () => {
    const pane = bar(
      draw({ activeHandle: 'pty-claude', liveHandles: [], modes: [['pty-claude', 'desktop']] }, scheme)
    )
    expect(pane).toMatchObject({ modeLabel: 'Switch to phone mode', glyph: 'Smartphone', placeholder: 'Type a command…' })
  })
})
