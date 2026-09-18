import { createElement, Fragment } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import type { SubagentTranscriptRequest } from './subagent-transcript-store'

const fakes = vi.hoisted(() => ({
  client: null as RpcClient | null,
  lastConnectedAt: 1000 as number | null,
  /** The blur half of the screen's focus effect, captured so a test can blur. */
  blur: null as (() => void) | null
}))

vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    fakes.blur = effect() ?? null
  }
}))

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  StatusBar: 'StatusBar',
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 400, height: 800 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-reanimated', () => ({
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: <T,>(initial: T) => ({ value: initial }),
  useAnimatedStyle: <T,>(factory: () => T) => factory(),
  withSpring: (to: number) => to
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  Diamond: 'Diamond'
}))
// The list is a plain map here: what is under test is what the viewer asks
// the host for and what it says about the answer, not FlashList's windowing.
vi.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent
  }: {
    data: NativeChatMessage[]
    renderItem: (args: { item: NativeChatMessage; index: number }) => unknown
    ListHeaderComponent?: unknown
    ListFooterComponent?: unknown
    ListEmptyComponent?: unknown
  }) =>
    createElement(
      'FlashList',
      null,
      ListHeaderComponent as never,
      data.length === 0
        ? (ListEmptyComponent as never)
        : data.map((item, index) =>
            createElement(Fragment, { key: item.id }, renderItem({ item, index }) as never)
          ),
      ListFooterComponent as never
    )
}))
// The row itself is the parent chat's; here it only has to prove it was
// handed the subagent's turn.
vi.mock('./MobileNativeChatMessage', () => ({
  MobileNativeChatMessage: ({ message }: { message: NativeChatMessage }) =>
    createElement('Text', null, `row:${message.id}:${message.role}`)
}))
// The list edges pull in the agent icon, whose PNG requires Node cannot parse.
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../transport/host-client-hooks', () => ({
  useHostClient: () => ({ client: fakes.client, clientId: 'c1', state: 'connected' })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => fakes.lastConnectedAt
}))

import { MobileSubagentTranscriptModal, MobileSubagentTranscriptScreen } from './MobileSubagentTranscriptModal'
import {
  openSubagentTranscript,
  peekSubagentTranscript,
  resetSubagentTranscriptForTests
} from './subagent-transcript-store'

const SUBAGENT =
  '/Users/me/.claude/projects/-Users-me-Desktop-Project/5d877e39-1867-424f-86b5-c080713c1563/subagents/agent-a68211cb9358e29c3.jsonl'

function request(running = true): SubagentTranscriptRequest {
  return {
    running,
    target: {
      agent: 'claude',
      agentId: 'a68211cb9358e29c3',
      sessionId: 'agent-a68211cb9358e29c3',
      transcriptPath: SUBAGENT,
      title: 'Port the subagent viewer'
    }
  }
}

function message(id: string, role: NativeChatMessage['role'] = 'assistant'): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text: id }], timestamp: 1, source: 'transcript' }
}

type Rendered = { texts: string[]; colors: string[]; types: string[] }

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  const colors: string[] = []
  const types = new Set<string>()
  for (const node of renderer.root.findAll(() => true)) {
    if (typeof node.type === 'string') {
      types.add(node.type)
    }
    if (node.type !== 'Text') {
      continue
    }
    const children = node.props.children
    if (typeof children === 'string') {
      texts.push(children)
    }
    const style = node.props.style
    for (const entry of Array.isArray(style) ? style : [style]) {
      if (entry && typeof entry === 'object' && typeof entry.color === 'string') {
        colors.push(entry.color)
      }
    }
  }
  return { texts, colors, types: [...types] }
}

async function press(renderer: ReactTestRenderer, accessibilityLabel: string): Promise<void> {
  const target = renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === accessibilityLabel)
  if (!target) {
    throw new Error(`no pressable labelled "${accessibilityLabel}"`)
  }
  await act(async () => {
    target.props.onPress()
  })
}

describe('the subagent transcript viewer', () => {
  let renderer: ReactTestRenderer | null = null
  let emit: (frame: unknown) => void = () => {}
  let subscribe: ReturnType<typeof vi.fn>
  let sendRequest: ReturnType<typeof vi.fn>
  const onClose = vi.fn()

  beforeEach(() => {
    resetNativeChatTranscriptCacheForTests()
    onClose.mockReset()
    subscribe = vi.fn((_method: string, _params: unknown, onData: (frame: unknown) => void) => {
      emit = onData
      return () => {}
    })
    sendRequest = vi.fn(async () => ({ ok: true, result: { messages: [], hasMore: false } }))
    fakes.client = { subscribe, sendRequest, getState: () => 'connected' } as unknown as RpcClient
    fakes.lastConnectedAt = 1000
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount(scheme: 'light' | 'dark' = 'light', req = request()): Promise<void> {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileSubagentTranscriptScreen, {
            request: req,
            hostId: 'host-a',
            worktreeId: 'wt-a',
            onClose
          })
        )
      )
    })
  }

  it("subscribes to the subagent's own file under its own key, never the parent's session id", async () => {
    await mount()
    expect(subscribe).toHaveBeenCalledTimes(1)
    const [method, params] = subscribe.mock.calls[0] as [string, Record<string, unknown>]
    expect(method).toBe('nativeChat.subscribe')
    expect(params).toMatchObject({
      agent: 'claude',
      sessionId: 'agent-a68211cb9358e29c3',
      transcriptPath: SUBAGENT,
      capabilities: { transcriptPending: 1 }
    })
    expect(params.sessionId).not.toContain('5d877e39')
  })

  it('says nothing has been written yet while the file is absent, with no error card', async () => {
    await mount()
    act(() => emit({ type: 'snapshot', messages: [], hasMore: false, pending: true }))
    const { texts } = readTree(renderer!)
    expect(texts).toContain('Nothing written yet')
    expect(texts.some((text) => /could not|failed|error/i.test(text))).toBe(false)
  })

  it("renders the agent's turns read-only, with no composer", async () => {
    await mount()
    act(() =>
      emit({
        type: 'snapshot',
        messages: [message('u1', 'user'), message('a1'), message('t1', 'tool')],
        hasMore: false
      })
    )
    const { texts, types } = readTree(renderer!)
    expect(texts).toContain('Port the subagent viewer')
    expect(texts).toContain('Subagent · Running')
    // Every row the host sent, in transcript order once the inverted list is read back.
    expect(texts.filter((text) => text.startsWith('row:'))).toEqual([
      'row:t1:tool',
      'row:a1:assistant',
      'row:u1:user'
    ])
    expect(types).not.toContain('TextInput')
    expect(texts).not.toContain('Nothing written yet')
  })

  it('names a finished agent as finished in the header', async () => {
    await mount('light', request(false))
    expect(readTree(renderer!).texts).toContain('Subagent · Finished')
  })

  it('pages earlier history under the same subagent key', async () => {
    await mount()
    act(() => emit({ type: 'snapshot', messages: [message('a1')], hasMore: true, beforeOffset: 500 }))
    await press(renderer!, 'Load earlier messages')
    expect(sendRequest).toHaveBeenCalledTimes(1)
    const [method, params] = sendRequest.mock.calls[0] as [string, Record<string, unknown>]
    expect(method).toBe('nativeChat.readSession')
    expect(params).toMatchObject({
      agent: 'claude',
      sessionId: 'agent-a68211cb9358e29c3',
      transcriptPath: SUBAGENT,
      beforeOffset: 500
    })
  })

  it('names a failed read inline and re-subscribes once the relay reconnects, not per render', async () => {
    await mount()
    act(() => emit({ type: 'error', message: 'socket closed' }))
    expect(readTree(renderer!).texts).toContain('socket closed')
    expect(subscribe).toHaveBeenCalledTimes(1)
    // A render on the same connection is not a retry.
    await act(async () => renderer?.update(
      createElement(
        ThemeProvider,
        { initialPreference: 'light' },
        createElement(MobileSubagentTranscriptScreen, {
          request: request(),
          hostId: 'host-a',
          worktreeId: 'wt-a',
          onClose
        })
      )
    ))
    expect(subscribe).toHaveBeenCalledTimes(1)
    // A NEW connection is.
    fakes.lastConnectedAt = 2000
    await act(async () => renderer?.update(
      createElement(
        ThemeProvider,
        { initialPreference: 'light' },
        createElement(MobileSubagentTranscriptScreen, {
          request: request(),
          hostId: 'host-a',
          worktreeId: 'wt-a',
          onClose
        })
      )
    ))
    expect(subscribe).toHaveBeenCalledTimes(2)
  })

  it('closes from the header', async () => {
    await mount()
    await press(renderer!, 'Back to background tasks')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // An RN Modal is a native overlay the screen's focus does not gate. Push a
  // second session screen (the notification route can, across hosts) and a
  // viewer left open would keep its subscription and paint over the new
  // screen. Losing focus closes it; so does leaving the screen for good.
  it('closes when the session screen loses focus, so it cannot paint over the next screen', async () => {
    resetSubagentTranscriptForTests()
    fakes.blur = null
    openSubagentTranscript(request().target, true)
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileSubagentTranscriptModal, { hostId: 'host-a', worktreeId: 'wt-a' })
        )
      )
    })
    expect(renderer!.root.findAllByType('Modal')).toHaveLength(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(fakes.blur).not.toBeNull()
    await act(async () => {
      fakes.blur?.()
    })
    expect(peekSubagentTranscript()).toBeNull()
    expect(renderer!.root.findAllByType('Modal')).toHaveLength(0)
  })

  it('does not reopen on the next screen after the one it was opened on unmounts', async () => {
    resetSubagentTranscriptForTests()
    openSubagentTranscript(request().target, true)
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileSubagentTranscriptModal, { hostId: 'host-a', worktreeId: 'wt-a' })
        )
      )
    })
    act(() => renderer?.unmount())
    renderer = null
    expect(peekSubagentTranscript()).toBeNull()
  })

  it('paints from the theme in dark mode too, not a hardcoded palette', async () => {
    await mount('light')
    act(() => emit({ type: 'snapshot', messages: [], hasMore: false, pending: true }))
    const light = readTree(renderer!)
    act(() => renderer?.unmount())
    renderer = null
    await mount('dark')
    act(() => emit({ type: 'snapshot', messages: [], hasMore: false, pending: true }))
    const dark = readTree(renderer!)
    expect(dark.texts).toEqual(light.texts)
    expect(light.colors).toContain(lightColors.text)
    expect(dark.colors).toContain(darkColors.text)
    expect(light.colors).not.toContain(darkColors.text)
    expect(dark.colors).not.toContain(lightColors.text)
  })
})
