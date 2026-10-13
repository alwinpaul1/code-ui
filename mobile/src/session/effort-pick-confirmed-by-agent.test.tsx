// The model sheet's Effort row states the agent's effort, never the phone's pick.
//
// Reported 2026-10-13 on 0.9.131 (Claude Code 2.1.296, three screenshots): on a
// Claude tab that was working, the user opened the model sheet and picked High.
// The sheet's Effort row then read "High" while the composer pill, which reads
// the agent's status line, still read "Opus 5.5 Medium", and the effort never
// changed. No transcript of that day holds a mid-turn `/effort` row or a
// queue-operation for one: the command never ran in Claude, and the phone, which
// had counted the desktop's ack as the change, never noticed.
//
// These mount the chain the chat mounts: the session-option controller and the
// picker over it. `dispatchCommand` stands in for the send seam (its own suites
// cover the write); `live` is what the agent states (the beacon or the badge, as
// the controller's `reportedEffort`); `refreshHud` is the screen read; `queued`
// is what the HUD reads out of Claude's queue box.

import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { ThemeProvider } from '../theme/theme-context'
import { resetClaudeDiscoveryForTests } from './claude-model-discovery'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { EFFORT_PICK_CONFIRM_MS } from './native-chat-effort-pick'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import { resetMobileNativeChatSessionOptionRecordsForTests } from './use-mobile-native-chat-session-options'
import { setSheetFailureClockForTests } from './use-sheet-failure'

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
  ArrowLeft: 'ArrowLeft',
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

let live: { effort: string | null } = { effort: 'medium' }
let tab = 'tab-1'
let queued: string[] = []
let working = true
const dispatchCommand = vi.fn<(command: string) => Promise<MobileNativeChatSendOutcome>>()
const refreshHud = vi.fn(async () => undefined)
const banner = vi.fn<(message: string) => void>()

function Chat(): ReactElement | null {
  const { nativeChatSessionOptions } = useMobileNativeChatSessionOptionController({
    activeChatStructured: false,
    activeSessionTabId: tab,
    agent: 'claude',
    dispatchCommand: (command) => dispatchCommand(command),
    hostId: 'host',
    isTabChatView: () => true,
    isWorking: working,
    reportedModel: 'claude-opus-5-5',
    reportedModelLabel: 'Opus 5.5',
    reportedEffort: live.effort,
    reportedModelSource: 'live',
    terminalHandle: `term-${tab}`,
    queuedMessages: queued,
    structured,
    toggleTabChatView: noop,
    worktreeId: 'repo::/code/app',
    client,
    handleRef: { current: `term-${tab}` },
    deviceTokenRef: { current: 'device' },
    refreshHud,
    onFailure: banner
  })
  return nativeChatSessionOptions
    ? createElement(MobileNativeChatSessionOptionPickers, nativeChatSessionOptions)
    : null
}

let renderer: ReactTestRenderer | null = null

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mount(): Promise<void> {
  await act(async () => {
    renderer = create(<ThemeProvider initialPreference="light">{createElement(Chat)}</ThemeProvider>)
  })
  await flush()
}

async function rerender(): Promise<void> {
  await act(async () => {
    renderer!.update(<ThemeProvider initialPreference="light">{createElement(Chat)}</ThemeProvider>)
  })
  await flush()
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await flush()
}

function pressable(name: string): ReactTestInstance {
  return renderer!.root.find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith(name)
  )
}

function texts(node: ReactTestInstance): string[] {
  return node.findAllByType('Text' as never).map((text) => String(text.props.children))
}

function effortRow(label: string): ReactTestInstance {
  const row = renderer!.root
    .findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio')
    .find((candidate) => texts(candidate)[0] === label)
  if (!row) {
    throw new Error(`no effort row labelled ${label}`)
  }
  return row
}

function shownText(): string[] {
  return renderer!.root.findAllByType('Text' as never).map((text) => String(text.props.children))
}

async function press(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    node.props.onPress()
  })
  await flush()
}

/** Open the sheet, go to Effort, and pick `label`. */
async function pickEffort(label: string): Promise<void> {
  await press(pressable('Model, '))
  await press(pressable('Effort'))
  await press(effortRow(label))
}

describe('the sheet states the effort the agent confirmed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    let clock = 0
    setSheetFailureClockForTests(() => (clock += 2_000))
    resetMobileNativeChatSessionOptionRecordsForTests()
    resetClaudeDiscoveryForTests()
    live = { effort: 'medium' }
    tab = 'tab-1'
    queued = []
    working = true
    dispatchCommand.mockReset()
    dispatchCommand.mockResolvedValue('accepted')
    refreshHud.mockClear()
    banner.mockReset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    setSheetFailureClockForTests(null)
    vi.useRealTimers()
  })

  it('keeps reading Medium, marked as changing, while a High picked mid-turn waits for Claude', async () => {
    await mount()
    await pickEffort('High')

    expect(dispatchCommand).toHaveBeenCalledWith('/effort high')
    // The pill reads the agent; so does the sheet, and it says High is on its way.
    expect(pressable('Model, ').props.accessibilityLabel).toBe('Model, Opus 5.5 Medium')
    await press(pressable('Model, '))
    expect(pressable('Effort').props.accessibilityLabel).toBe('Effort, High…')
    await press(pressable('Effort'))
    expect(effortRow('Medium').props.accessibilityState.checked).toBe(true)
    expect(effortRow('High').props.accessibilityState.checked).toBe(false)
    expect(shownText()).toContain('Changing to High…')
    expect(shownText()).not.toContain('Sent to the agent — not confirmed')
  })

  it('reads the screen straight after the pick instead of waiting for the next poll', async () => {
    await mount()
    refreshHud.mockClear()
    await pickEffort('High')
    expect(refreshHud).toHaveBeenCalled()
    // And keeps looking while it waits, once a second, not once per 5 s poll.
    refreshHud.mockClear()
    await advance(3_000)
    expect(refreshHud.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('shows High as soon as Claude states it, with nothing said', async () => {
    await mount()
    await pickEffort('High')
    live = { effort: 'high' }
    await rerender()

    await press(pressable('Model, '))
    expect(pressable('Effort').props.accessibilityLabel).toBe('Effort, High')
    await press(pressable('Effort'))
    expect(effortRow('High').props.accessibilityState.checked).toBe(true)
    expect(shownText()).not.toContain('Changing to High…')
    await advance(EFFORT_PICK_CONFIRM_MS * 2)
    expect(banner).not.toHaveBeenCalled()
  })

  it('says once that the effort did not change when Claude never takes the pick', async () => {
    await mount()
    await pickEffort('High')
    // The drawer closed after the pick; Claude goes on stating Medium.
    await advance(EFFORT_PICK_CONFIRM_MS + 100)

    expect(banner).toHaveBeenCalledTimes(1)
    expect(banner).toHaveBeenCalledWith('Effort is still Medium: the agent did not take High. Try again.')
    await press(pressable('Model, '))
    expect(pressable('Effort').props.accessibilityLabel).toBe('Effort, Medium')
    // Said once: more time, more repaints of the same Medium, add nothing.
    await rerender()
    await advance(EFFORT_PICK_CONFIRM_MS * 2)
    expect(banner).toHaveBeenCalledTimes(1)
  })

  it('types the pick again when High is tapped after one Claude never took', async () => {
    await mount()
    await pickEffort('High')
    await advance(EFFORT_PICK_CONFIRM_MS + 100)
    dispatchCommand.mockClear()

    await pickEffort('High')
    expect(dispatchCommand).toHaveBeenCalledWith('/effort high')
  })

  it('says a pick Claude queued applies after it finishes, and waits for the turn without giving up', async () => {
    await mount()
    await pickEffort('High')
    // An older Claude Code puts `/effort` in its queue box mid-turn.
    queued = ['/effort high']
    await rerender()
    await press(pressable('Model, '))
    await press(pressable('Effort'))
    expect(shownText()).toContain('High applies after Claude finishes')

    await advance(EFFORT_PICK_CONFIRM_MS * 3)
    await rerender()
    expect(banner).not.toHaveBeenCalled()
    expect(shownText()).toContain('High applies after Claude finishes')

    // The turn ends, Claude runs its queue, and the status line says High.
    queued = []
    working = false
    live = { effort: 'high' }
    await rerender()
    expect(effortRow('High').props.accessibilityState.checked).toBe(true)
    await advance(EFFORT_PICK_CONFIRM_MS * 2)
    expect(banner).not.toHaveBeenCalled()
  })

  it('leaves Medium on the sheet, with nothing pending, when the pick is refused before typing', async () => {
    dispatchCommand.mockResolvedValue('rejected')
    await mount()
    await pickEffort('High')

    expect(effortRow('Medium').props.accessibilityState.checked).toBe(true)
    expect(shownText()).not.toContain('Changing to High…')
    await advance(EFFORT_PICK_CONFIRM_MS * 2)
    // The send seam said why it refused; the pick adds no second message.
    expect(banner).not.toHaveBeenCalled()
  })

  it('judges a pick when the user comes back to its tab, and says it there once', async () => {
    await mount()
    await pickEffort('High')
    // Another tab, whose agent states High already: no pick of its own there.
    tab = 'tab-2'
    live = { effort: 'high' }
    await rerender()
    await advance(EFFORT_PICK_CONFIRM_MS + 100)
    expect(banner).not.toHaveBeenCalled()

    // Back on the first tab, still Medium: the pick is given up there, once.
    tab = 'tab-1'
    live = { effort: 'medium' }
    await rerender()
    expect(banner).toHaveBeenCalledTimes(1)
    await press(pressable('Model, '))
    expect(pressable('Effort').props.accessibilityLabel).toBe('Effort, Medium')
  })
})
