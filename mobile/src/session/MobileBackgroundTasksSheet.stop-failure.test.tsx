// A background task's Stop that fails says so inside the sheet.
//
// The Background tasks sheet is a BottomDrawer, which draws in its own native
// window (mounted-bottom-drawer.tsx). The task row keeps its Stop until the
// host says the task ended, and until 2026-09-25 the reason a Stop failed went
// only to the chat's banner, which draws under that window. The same defect
// the session-option drawer had (MobileNativeChatSessionOptionPickers.failure.test.tsx),
// fixed the same way. These mount the real structured session over a fake RPC
// client and the real sheet; `screen` stands in for the chat's own
// banner-or-toast reporter (nativeChatSendError.show).

import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSessionBackgroundTaskState,
  AgentSessionSubscribeEvent
} from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined)
  }
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Animated: {
    View: 'AnimatedView',
    createAnimatedComponent: (c: unknown) => c,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({}),
    sequence: () => ({})
  },
  Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
// The drawer's native window cannot mount here; a host element in its place
// keeps what the sheet holds findable, and what it does not.
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    // The header is drawn by the drawer too, pinned above the list.
    BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, header, children) : null
  }
})
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Sparkles: 'Sparkles',
  Square: 'Square',
  Terminal: 'Terminal',
  X: 'X'
}))

const REFUSED = 'That task is not running any more'
const UNCONFIRMED = 'Stop unconfirmed — check chat before retrying'
const TAB = 'host-a\0wt-1\0tab-1'

// The one task the host lists, and the only row with a Stop.
const ROSTER: AgentSessionBackgroundTaskState = {
  state: 'monitoring',
  supportsTaskStop: true,
  tasks: [{ id: 'task-live', kind: 'agent', description: 'Audit the release notes', state: 'working' }],
  settledTasks: []
}

function ok(result: unknown) {
  return { ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function snapshotEvent(): AgentSessionSubscribeEvent {
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence: 3,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence: 3,
      direction: 'tail',
      items: [],
      removedItemIds: [],
      submissions: [],
      window: { oldest: null, newest: null, nextCursor: { epoch: 'epoch-1', sequence: 0 } },
      liveCursor: { epoch: 'epoch-1', sequence: 0 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

describe("a background task's Stop that fails says so inside the sheet", () => {
  let renderer: ReactTestRenderer | null = null
  let listener: ((value: unknown) => void) | null = null
  let cancelReply: () => Promise<unknown> = async () => ok({})
  let sheetOpen = true
  let scheme: 'light' | 'dark' = 'light'
  // The chat's own banner-or-toast reporter, which draws under the sheet.
  const screen = vi.fn<(message: string) => void>()
  const sendRequest = vi.fn()
  const subscribe = vi.fn((_method: string, _params: unknown, onData: (value: unknown) => void) => {
    listener = onData
    return vi.fn()
  })
  const client = { sendRequest, subscribe } as unknown as RpcClient

  function Tab(): ReactElement {
    const session = useMobileStructuredAgentSession({
      client,
      sessionId: 'session-1',
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected: true,
      agent: 'claude',
      onSendError: screen
    } as never)
    return (
      <ThemeProvider initialPreference={scheme}>
        <MobileBackgroundTasksSheet
          visible={sheetOpen}
          messages={[]}
          agent="claude"
          hostBackgroundTasks={ROSTER}
          onStopTask={session.stopBackgroundTask}
          reportStopFailure={screen}
          scopeKey={TAB}
          onClose={() => undefined}
        />
      </ThemeProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sheetOpen = true
    scheme = 'light'
    cancelReply = async () => ok({})
    sendRequest.mockImplementation(async (method: string) => {
      if (method === 'agentSession.options') {
        return ok({ models: [], current: {} })
      }
      if (method === 'agentSession.cancel') {
        return cancelReply()
      }
      return ok({})
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    listener = null
  })

  async function mountTab(): Promise<void> {
    act(() => {
      renderer = create(createElement(Tab))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotEvent()))
  }

  function isHost(node: ReactTestInstance, tag: string): boolean {
    return (node.type as unknown) === tag
  }

  function said(message: string): ReactTestInstance[] {
    return renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.children === message)
  }

  function expectSaidInSheet(message: string): void {
    const inside = said(message).map((node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (isHost(parent, 'BottomDrawer')) {
          return true
        }
      }
      return false
    })
    expect(inside).toEqual([true])
  }

  async function pressStop(): Promise<void> {
    const stop = renderer!.root.find(
      (node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === 'Stop Audit the release notes'
    )
    await act(async () => {
      stop.props.onPress()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  function cancels() {
    return sendRequest.mock.calls.filter(([method]) => method === 'agentSession.cancel')
  }

  it('says a Stop the host refused inside the sheet, not under it', async () => {
    cancelReply = async () =>
      ok({ ok: false, refusal: { code: 'agent_session_conflict', message: REFUSED } })
    await mountTab()

    await pressStop()

    expect(cancels()).toHaveLength(1)
    expectSaidInSheet(REFUSED)
    // Said once, where it can be seen; the banner under the sheet stays quiet.
    expect(screen).not.toHaveBeenCalled()
  })

  it('says a Stop whose ack was lost is unconfirmed, inside the sheet', async () => {
    cancelReply = async () => {
      throw markRpcDeliveryUnknown(new Error('Connection closed'))
    }
    await mountTab()

    await pressStop()

    expectSaidInSheet(UNCONFIRMED)
    expect(screen).not.toHaveBeenCalled()
  })

  it('clears the failure on the next Stop', async () => {
    cancelReply = async () =>
      ok({ ok: false, refusal: { code: 'agent_session_conflict', message: REFUSED } })
    await mountTab()
    await pressStop()
    expectSaidInSheet(REFUSED)

    // The next Stop is still on its way; the old reason must not sit over it.
    cancelReply = () => new Promise(() => undefined)
    await pressStop()

    expect(said(REFUSED)).toEqual([])
  })

  it("says a Stop that fails after the sheet closed on the chat's banner", async () => {
    let refuse: ((value: unknown) => void) | null = null
    cancelReply = () =>
      new Promise((resolve) => {
        refuse = resolve
      })
    await mountTab()
    await pressStop()
    sheetOpen = false
    await act(async () => {
      renderer!.update(createElement(Tab))
    })

    await act(async () => {
      refuse!(ok({ ok: false, refusal: { code: 'agent_session_conflict', message: REFUSED } }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(REFUSED)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)("draws a failed Stop's reason in the %s theme's danger colour", async (next, palette) => {
    scheme = next
    cancelReply = async () =>
      ok({ ok: false, refusal: { code: 'agent_session_conflict', message: REFUSED } })
    await mountTab()

    await pressStop()

    const [message] = said(REFUSED)
    expect(message).toBeDefined()
    const style = [message!.props.style].flat(Infinity) as Array<{ color?: string } | null>
    const colors = style.map((entry) => entry?.color).filter((color) => color !== undefined)
    expect(colors.at(-1)).toBe(palette.danger)
    expect(message!.props.accessibilityRole).toBe('alert')
  })
})
