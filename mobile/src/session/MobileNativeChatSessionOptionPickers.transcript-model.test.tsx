import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { resetClaudeDiscoveryForTests } from './claude-model-discovery'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import { resetMobileNativeChatSessionOptionRecordsForTests } from './use-mobile-native-chat-session-options'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => 1
}))

// The composer's model pill on a Claude chat whose agent states no model — a
// Windows host, with no status line of the user's own (reported 2026-09-27:
// "it shows just 'model'"). The host's session scan said the last reply was
// written by claude-opus-5-5 (claude-transcript-model.ts).
const OPUS: ClaudeModelFallback = {
  kind: 'transcript',
  model: { model: 'claude-opus-5-5', label: 'Opus 5.5' }
}

const client = {
  sendRequest: async (): Promise<RpcResponse> => ({
    id: 'rpc',
    ok: false,
    error: { code: 'unavailable', message: 'not answered by this suite' }
  }),
  getState: () => 'connected',
  notifyForeground: () => undefined
} as unknown as RpcClient
const noop = (): void => undefined
const structured = {
  snapshot: [] as SessionOptionDescriptor[],
  pendingId: null,
  setOption: async () => false,
  invokeAction: async () => false
}

let transcriptModel: ClaudeModelFallback = OPUS
let live: { model: string | null; label: string | null } = { model: null, label: null }
const onModelSheetOpen = vi.fn()

function Chat(): ReactElement | null {
  const { nativeChatSessionOptions } = useMobileNativeChatSessionOptionController({
    activeChatStructured: false,
    activeSessionTabId: 'tab-1',
    agent: 'claude',
    dispatchCommand: async () => 'rejected',
    hostId: 'host-win',
    isTabChatView: () => true,
    isWorking: false,
    reportedModel: live.model,
    reportedModelLabel: live.label,
    reportedModelSource: live.model ? 'live' : 'launch',
    terminalHandle: 'term',
    transcriptModel,
    onModelSheetOpen,
    structured,
    toggleTabChatView: noop,
    worktreeId: 'repo-1::C:\\Users\\danny\\code\\app',
    client,
    handleRef: { current: 'term' },
    deviceTokenRef: { current: 'device' },
    refreshHud: async () => undefined,
    onFailure: noop
  })
  return nativeChatSessionOptions
    ? createElement(MobileNativeChatSessionOptionPickers, nativeChatSessionOptions)
    : null
}

let renderer: ReactTestRenderer | null = null

async function mount(scheme: 'light' | 'dark' = 'light'): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>{createElement(Chat)}</ThemeProvider>
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function modelPill(): ReactTestInstance {
  return renderer!.root.find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith('Model, ')
  )
}

function pillText(): ReactTestInstance {
  const [text] = modelPill().findAllByType('Text' as never)
  if (!text) {
    throw new Error('the pill draws no Text')
  }
  return text
}

/** The colour a flattened React Native style ends on: the last entry wins. */
function lastColour(style: unknown): string | undefined {
  let colour: string | undefined
  for (const entry of [style].flat(Infinity) as Array<Record<string, unknown> | null | undefined>) {
    const value = entry?.color ?? entry?.backgroundColor
    if (typeof value === 'string') {
      colour = value
    }
  }
  return colour
}

describe('the composer model pill on a Claude chat that states no model', () => {
  beforeEach(() => {
    resetMobileNativeChatSessionOptionRecordsForTests()
    resetClaudeDiscoveryForTests()
    transcriptModel = OPUS
    live = { model: null, label: null }
    onModelSheetOpen.mockClear()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'shows the model that answered on a Windows host with no status line, in %s',
    async (scheme, palette) => {
      await mount(scheme)

      expect(modelPill().props.accessibilityLabel).toBe('Model, Opus 5.5')
      expect(pillText().props.children).toBe('Opus 5.5')
      // Drawn in the theme's own tokens, not a fixed colour.
      expect(lastColour(pillText().props.style)).toBe(palette.textSecondary)
      const surface = modelPill().props.style as (state: { pressed: boolean }) => unknown
      expect(lastColour(surface({ pressed: false }))).toBe(palette.bgRaised)
    }
  )

  it('asks the host what answered when the user opens the model sheet', async () => {
    await mount()

    await act(async () => {
      modelPill().props.onPress()
    })

    expect(onModelSheetOpen).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findAllByType('BottomDrawer' as never)).toHaveLength(1)
  })

  it('still reads "Model" with no transcript reading, rather than inventing one', async () => {
    transcriptModel = { kind: 'none' }
    await mount()
    expect(pillText().props.children).toBe('Model')
  })

  it('lets the live pair win over the transcript', async () => {
    live = { model: 'claude-fable-5-1', label: 'Fable 5.1' }
    await mount()
    expect(pillText().props.children).toBe('Fable 5.1')
  })
})
