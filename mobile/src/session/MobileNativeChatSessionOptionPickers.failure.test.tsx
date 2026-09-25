// A pick that fails says so inside the drawer the user is looking at.
//
// The session-option picker is a BottomDrawer, and a BottomDrawer draws in its
// own native window (a Modal; mounted-bottom-drawer.tsx). A failed pick keeps
// the drawer open, and until 2026-09-25 its reason went only to the chat's
// banner or toast, which draw in the screen UNDER that window. So the user saw
// a row that did nothing, and a dead row looks exactly like a slow one: the
// reason turned up only after the drawer was closed, if its four seconds had
// not run out by then.
//
// These mount the real chain the chat mounts: the composer's send seam
// (use-mobile-native-chat-message-send.ts), the session-option controller with
// its Codex picker driver, and the picker, over a fake RPC client. The only
// thing standing in for the app is `screen`, the chat's own banner-or-toast
// reporter (nativeChatSendError.show).

import { createElement, useState, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { writeCodexModelList } from '../storage/codex-model-lists'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { resetClaudeDiscoveryForTests } from './claude-model-discovery'
import { resetCodexDiscoveryForTests } from './codex-model-discovery'
import { resetCodexTerminalLockForTests } from './codex-terminal-lock'
import { codexVisibleModelsKey, resetCodexVisibleModelsForTests } from './codex-visible-models'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import {
  resetMobileNativeChatSessionOptionRecordsForTests,
  type MobileNativeChatSessionOptionsController
} from './use-mobile-native-chat-session-options'

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
// The drawer's native window cannot mount here; a host element in its place
// keeps what the drawer holds findable, and what it does not. Its `onClose` is
// what Back, a backdrop tap and a swipe call once the hide animation ends.
const drawerHandle = vi.hoisted(() => ({ onClose: null as (() => void) | null }))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({
      visible,
      onClose,
      children
    }: {
      visible: boolean
      onClose: () => void
      children?: ReactNode
    }) => {
      drawerHandle.onClose = onClose
      return visible ? React.createElement('BottomDrawer', { visible }, children) : null
    }
  }
})
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => 1
}))

const BUSY = 'Another input is still being sent. Try again.'
const NOT_SENT = 'Message not sent'
const UNCONFIRMED = 'Command unconfirmed — check chat before retrying'
const GATE_REFUSED = 'Command not sent: the desktop terminal is not taking input from this phone yet'
const CODEX_APPROVAL_FIRST = 'Respond to the active Codex approval first'
const CODEX_UNREACHABLE = "Can't reach the Codex terminal right now"
const CODEX_PICK_UNCONFIRMED = 'Pick unconfirmed — check the Codex terminal before retrying'

// Codex idle at its prompt, as codex-picker-screen.test.ts reads it.
const CODEX_IDLE_SCREEN = ['• ok', '› Ask Codex to do anything', '  gpt-6-astra xhigh · ~/Project']

// A Codex approval as Codex draws it: the screenshot codex-terminal-permission.test.ts
// was written from. A model pick must not type into it.
const CODEX_APPROVAL_SCREEN = [
  'Would you like to run the following command?',
  '',
  'Environment: local',
  'Reason: May I run the full test suite, including the local WebSocket integration tests?',
  '',
  '  $ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
  '  3. No, and tell Codex what to do differently (esc)',
  '',
  'Press enter to confirm or esc to cancel'
]

type Agent = 'claude' | 'codex'
type Rpc = (method: string, params: unknown) => Promise<RpcResponse>

function reply(result: unknown): RpcResponse {
  return { id: 'rpc', ok: true, result, _meta: { runtimeId: 'host' } } as RpcResponse
}
function sendReply(accepted: boolean): RpcResponse {
  return reply({ send: { accepted } })
}
function refusedRpc(): RpcResponse {
  return { id: 'rpc', ok: false, error: { code: 'unavailable', message: 'no' } } as RpcResponse
}

let rpc: Rpc = async () => refusedRpc()
const sendRequest = vi.fn((method: string, params: unknown) => rpc(method, params))
const client = {
  sendRequest,
  getState: () => 'connected',
  notifyForeground: () => undefined
} as unknown as RpcClient
const handleRef = { current: 'term' as string | null }
const deviceTokenRef = { current: 'device' as string | null }
const commandSendRef = { current: (_command: string) => undefined }
const noop = (): void => undefined
const captureSendOrigin = () => ({ draftKey: 'k', pendingKey: 'p' }) as never
const readSeededLaunchDraftSeed = () => null
const refreshHud = async (): Promise<unknown> => undefined
const isTabChatView = () => true
const structured = {
  snapshot: [] as SessionOptionDescriptor[],
  pendingId: null,
  setOption: async () => false,
  invokeAction: async () => false
}
// The chat's own banner-or-toast reporter, which draws under the drawer.
const screen = vi.fn<(message: string) => void>()

let agent: Agent = 'claude'
let reportedModel: string | null = 'sonnet'
// Whether the desktop terminal takes input from this phone (the input lease).
let inputReady = true
const agentRef = { current: agent as string | null }
// The tab the chat shows, and that tab's own banner-or-toast reporter. In the
// app the reporter is scoped: nativeChatSendError.show changes with the tab.
let tabId = 'tab-1'
let chatReport: (message: string) => void = screen
// The controller the chat last handed the picker, for a pick made without the
// drawer (Codex's typed `/model <slug>`, use-codex-chat-command-intercept.ts).
let lastController: MobileNativeChatSessionOptionsController | null = null

function Chat(): ReactElement | null {
  agentRef.current = agent
  const send = useMobileNativeChatMessageSend({
    client,
    enabled: inputReady,
    handleRef,
    deviceTokenRef,
    agentRef,
    commandSendRef,
    captureSendOrigin,
    readSeededLaunchDraftSeed,
    clearDraftForSend: noop,
    restoreRejectedDraft: noop,
    acceptSend: noop,
    holdUnconfirmedSend: noop,
    onSendError: chatReport
  })
  const { nativeChatSessionOptions } = useMobileNativeChatSessionOptionController({
    activeChatStructured: false,
    activeSessionTabId: tabId,
    agent,
    dispatchCommand: send.dispatchCommand,
    hostId: 'host-a',
    isTabChatView,
    isWorking: false,
    reportedModel,
    reportedModelSource: 'live',
    terminalHandle: 'term',
    structured,
    toggleTabChatView: noop,
    worktreeId: 'wt-1',
    client,
    handleRef,
    deviceTokenRef,
    refreshHud,
    onFailure: chatReport
  })
  lastController = nativeChatSessionOptions?.controller ?? null
  return nativeChatSessionOptions
    ? createElement(MobileNativeChatSessionOptionPickers, nativeChatSessionOptions)
    : null
}

let renderer: ReactTestRenderer | null = null

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mountChat(
  next: Agent,
  wrap: (child: ReactElement) => ReactElement = (child) => child
): Promise<void> {
  agent = next
  await act(async () => {
    renderer = create(wrap(createElement(Chat)))
  })
  // Discovery replies and persisted model lists land on later ticks.
  await settle()
  await settle()
}

/** Host tags are the strings the react-native mock above renders. */
function isHost(node: ReactTestInstance, tag: string): boolean {
  return (node.type as unknown) === tag
}

function texts(root: ReactTestInstance): string[] {
  return root.findAllByType('Text' as never).map((node) => String(node.props.children))
}

function drawer(): ReactTestInstance | null {
  return renderer!.root.findAllByType('BottomDrawer' as never)[0] ?? null
}

/** The Text that says `message`, wherever in the tree it is drawn. */
function said(message: string): ReactTestInstance[] {
  return renderer!.root
    .findAllByType('Text' as never)
    .filter((node) => node.props.children === message)
}

function isInside(node: ReactTestInstance, type: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isHost(parent, type)) {
      return true
    }
  }
  return false
}

function pressable(label: string): ReactTestInstance {
  const match = renderer!.root.find(
    (node) =>
      isHost(node, 'Pressable') &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith(label)
  )
  return match
}

function row(text: string): ReactTestInstance {
  const label = renderer!.root
    .findAllByType('Text' as never)
    .find((node) => node.props.children === text)
  if (!label) {
    throw new Error(`No row labeled ${text}; drawn: ${texts(renderer!.root).join(' | ')}`)
  }
  let parent = label.parent
  while (parent && !isHost(parent, 'Pressable')) {
    parent = parent.parent
  }
  if (!parent) {
    throw new Error(`No pressable row for ${text}`)
  }
  return parent
}

async function press(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    node.props.onPress()
  })
  await settle()
}

async function openDrawer(): Promise<void> {
  await press(pressable('Model'))
  expect(drawer()).not.toBeNull()
}

/** Where a failed pick's message was drawn: inside the drawer, or not at all. */
function expectSaidInDrawer(message: string): void {
  const nodes = said(message)
  expect(nodes.map((node) => isInside(node, 'BottomDrawer'))).toEqual([true])
}

beforeEach(async () => {
  resetMobileNativeChatSessionOptionRecordsForTests()
  resetMobileNativeChatTerminalWritesForTests()
  resetMobileNativeChatStaleInputForTests()
  resetClaudeDiscoveryForTests()
  resetCodexDiscoveryForTests()
  resetCodexVisibleModelsForTests()
  resetCodexTerminalLockForTests()
  await AsyncStorage.clear()
  screen.mockReset()
  sendRequest.mockClear()
  reportedModel = 'sonnet'
  inputReady = true
  rpc = async () => refusedRpc()
  tabId = 'tab-1'
  chatReport = screen
  drawerHandle.onClose = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('a Claude pick that fails says so inside the open drawer', () => {
  it('says a model pick turned away by a busy terminal inside the drawer, not under it', async () => {
    await mountChat('claude')
    await openDrawer()
    // An image paste or a paced answer is mid-way through its writes.
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)

    await press(row('Opus'))

    // Nothing went out, the drawer is still open, and it says why.
    expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain('terminal.send')
    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(BUSY)
    // Said once, where it can be seen; the banner under the drawer stays quiet.
    expect(screen).not.toHaveBeenCalled()
  })

  // The send gate (mobile-native-chat-send-readiness.ts) refuses a command at
  // once while the terminal is not taking input, and says why on the banner
  // unless the pick brought its own reporter.
  it('says a model pick the send gate turned away inside the drawer', async () => {
    inputReady = false
    await mountChat('claude')
    await openDrawer()

    await press(row('Opus'))

    expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain('terminal.send')
    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(GATE_REFUSED)
    expect(screen).not.toHaveBeenCalled()
  })

  it('says a model pick whose keys the host refused inside the drawer', async () => {
    rpc = async (method) => (method === 'terminal.send' ? sendReply(false) : refusedRpc())
    await mountChat('claude')
    await openDrawer()

    await press(row('Opus'))

    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(NOT_SENT)
    expect(screen).not.toHaveBeenCalled()
  })

  it('clears the failure on the next pick', async () => {
    await mountChat('claude')
    await openDrawer()
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)
    await press(row('Opus'))
    expectSaidInDrawer(BUSY)

    releaseMobileNativeChatTerminalWrite('term')
    // The next pick's keys are held in flight; the old reason must not sit over it.
    rpc = () => new Promise<RpcResponse>(() => undefined)
    await press(row('Opus'))
    expect(said(BUSY)).toEqual([])
  })

  it('clears the failure when the drawer closes, and does not repeat it on the banner', async () => {
    await mountChat('claude')
    await openDrawer()
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)
    await press(row('Opus'))
    expectSaidInDrawer(BUSY)

    await press(pressable('Close picker'))
    expect(drawer()).toBeNull()
    await openDrawer()

    expect(said(BUSY)).toEqual([])
    // The user read it in the drawer; closing it is not a second failure.
    expect(screen).not.toHaveBeenCalled()
  })

  it("says a pick that fails after the drawer closed on the chat's banner", async () => {
    let refuse: ((response: RpcResponse) => void) | null = null
    rpc = (method) =>
      method === 'terminal.send'
        ? new Promise<RpcResponse>((resolve) => {
            refuse = resolve
          })
        : Promise.resolve(refusedRpc())
    await mountChat('claude')
    await openDrawer()
    await press(row('Opus'))
    // Closed while the pick is still on its way.
    await press(pressable('Close picker'))
    expect(drawer()).toBeNull()

    await act(async () => {
      refuse!(sendReply(false))
    })
    await settle()

    expect(said(NOT_SENT)).toEqual([])
    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(NOT_SENT)
  })

  // Back, a backdrop tap and a swipe close the drawer only once its hide
  // animation ends, so a failure can land in a drawer that is already leaving.
  it('keeps a failure that lands while the drawer is being dismissed', async () => {
    let refuse: ((response: RpcResponse) => void) | null = null
    rpc = (method) =>
      method === 'terminal.send'
        ? new Promise<RpcResponse>((resolve) => {
            refuse = resolve
          })
        : Promise.resolve(refusedRpc())
    await mountChat('claude')
    await openDrawer()
    await press(row('Opus'))

    // The user has swiped the drawer away; it is animating out when the pick fails.
    await act(async () => {
      refuse!(sendReply(false))
    })
    await settle()
    await act(async () => {
      drawerHandle.onClose!()
    })
    await settle()

    expect(drawer()).toBeNull()
    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(NOT_SENT)
  })

  it("says a pick's failure on its own tab's banner after the chat moved to another tab", async () => {
    const otherTab = vi.fn<(message: string) => void>()
    let refuse: ((response: RpcResponse) => void) | null = null
    rpc = (method) =>
      method === 'terminal.send'
        ? new Promise<RpcResponse>((resolve) => {
            refuse = resolve
          })
        : Promise.resolve(refusedRpc())
    await mountChat('claude')
    await openDrawer()
    await press(row('Opus'))
    await press(pressable('Close picker'))

    // The composer, and the picker in it, stay mounted across a tab switch.
    tabId = 'tab-2'
    chatReport = otherTab
    await act(async () => {
      renderer!.update(createElement(Chat))
    })
    await settle()
    await act(async () => {
      refuse!(sendReply(false))
    })
    await settle()

    // Tab 1's own reporter, which sends it to the toast once tab 1 is not shown.
    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(NOT_SENT)
    expect(otherTab).not.toHaveBeenCalled()
  })

  it("keeps a pick's failure out of another tab's open drawer", async () => {
    const otherTab = vi.fn<(message: string) => void>()
    let refuse: ((response: RpcResponse) => void) | null = null
    rpc = (method) =>
      method === 'terminal.send'
        ? new Promise<RpcResponse>((resolve) => {
            refuse = resolve
          })
        : Promise.resolve(refusedRpc())
    await mountChat('claude')
    await openDrawer()
    await press(row('Opus'))
    await press(pressable('Close picker'))
    tabId = 'tab-2'
    chatReport = otherTab
    await act(async () => {
      renderer!.update(createElement(Chat))
    })
    await settle()
    await openDrawer()

    await act(async () => {
      refuse!(sendReply(false))
    })
    await settle()

    expect(said(NOT_SENT)).toEqual([])
    expect(screen).toHaveBeenCalledWith(NOT_SENT)
    expect(otherTab).not.toHaveBeenCalled()
  })

  it("hands an unconfirmed effort pick to the chat's banner once it closes the drawer", async () => {
    await mountChat('claude')
    await openDrawer()
    await press(row('Effort'))
    const [unpicked] = renderer!.root.findAll(
      (node) =>
        isHost(node, 'Pressable') &&
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityState?.checked === false
    )
    // The line clear lands; the command's own write loses its ack.
    let writes = 0
    rpc = async (method) => {
      if (method !== 'terminal.send') {
        return refusedRpc()
      }
      writes += 1
      if (writes === 1) {
        return sendReply(true)
      }
      throw markRpcDeliveryUnknown(new Error('Connection closed'))
    }

    await press(unpicked!)

    // The pick counts as sent (it usually landed), so the drawer closes, and the
    // one word it has goes where the user will see it.
    expect(drawer()).toBeNull()
    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(UNCONFIRMED)
  })
})

describe('a Codex pick that fails says so inside the open drawer', () => {
  async function seedCodexModels(slugs: string[]): Promise<void> {
    await writeCodexModelList(
      'visible',
      codexVisibleModelsKey('host-a', 'wt-1'),
      slugs.map((slug, index) => ({
        slug,
        description: '',
        isDefault: index === 0,
        isCurrent: false
      }))
    )
  }

  it('says a model pick turned away by an open approval inside the drawer', async () => {
    await seedCodexModels(['gpt-6-astra', 'gpt-5.6-sol'])
    reportedModel = 'gpt-6-astra'
    rpc = async (method) =>
      method === 'terminal.read' ? reply({ terminal: { tail: CODEX_APPROVAL_SCREEN } }) : refusedRpc()
    await mountChat('codex')
    await openDrawer()

    await press(row('gpt-5.6-sol'))

    // Nothing was typed into the approval.
    expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain('terminal.send')
    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(CODEX_APPROVAL_FIRST)
    expect(screen).not.toHaveBeenCalled()
  })

  // The driver reads Codex's screen and types into it over plain RPCs, and a
  // rejected one threw straight out of the pick: no message anywhere, and an
  // unhandled rejection behind a row that did nothing.
  it('says a model pick whose screen read was rejected could not reach Codex', async () => {
    await seedCodexModels(['gpt-6-astra', 'gpt-5.6-sol'])
    reportedModel = 'gpt-6-astra'
    rpc = async (method) => {
      if (method === 'terminal.read') {
        throw new Error('Connection closed')
      }
      return refusedRpc()
    }
    await mountChat('codex')
    await openDrawer()

    await press(row('gpt-5.6-sol'))

    // Nothing was typed, so nothing on the desktop changed.
    expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain('terminal.send')
    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(CODEX_UNREACHABLE)
    expect(screen).not.toHaveBeenCalled()
  })

  // The user is told the link failed. If something else threw (a parser
  // fault), the log line is the only place that says what it was.
  it('logs what threw out of a Codex pick', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await seedCodexModels(['gpt-6-astra', 'gpt-5.6-sol'])
    reportedModel = 'gpt-6-astra'
    rpc = async (method) => {
      if (method === 'terminal.read') {
        throw new Error('Connection closed')
      }
      return refusedRpc()
    }
    await mountChat('codex')
    await openDrawer()

    await press(row('gpt-5.6-sol'))

    expect(warn).toHaveBeenCalledWith('[codex-picker] pick threw', 'Connection closed')
    warn.mockRestore()
  })

  it("says a model pick whose keys' ack was lost mid-drive is unconfirmed", async () => {
    await seedCodexModels(['gpt-6-astra', 'gpt-5.6-sol'])
    reportedModel = 'gpt-6-astra'
    rpc = async (method) => {
      if (method === 'terminal.read') {
        return reply({ terminal: { tail: CODEX_IDLE_SCREEN } })
      }
      if (method === 'terminal.send') {
        throw markRpcDeliveryUnknown(new Error('Connection closed'))
      }
      return refusedRpc()
    }
    await mountChat('codex')
    await openDrawer()

    await press(row('gpt-5.6-sol'))

    // `/model` may have reached Codex, so its picker may be open on the desktop.
    expect(sendRequest.mock.calls.map(([method]) => method)).toContain('terminal.send')
    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(CODEX_PICK_UNCONFIRMED)
    expect(screen).not.toHaveBeenCalled()
  })

  it("says a typed /model whose screen read was rejected on the chat's banner", async () => {
    await seedCodexModels(['gpt-6-astra', 'gpt-5.6-sol'])
    reportedModel = 'gpt-6-astra'
    rpc = async (method) => {
      if (method === 'terminal.read') {
        throw new Error('Connection closed')
      }
      return refusedRpc()
    }
    await mountChat('codex')

    // No drawer, no reporter: the composer's typed command lands here.
    let applied: boolean | undefined
    await act(async () => {
      applied = await lastController!.setOption('model', 'gpt-5.6-sol')
    })

    expect(applied).toBe(false)
    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(CODEX_UNREACHABLE)
  })

  it("says a rejected read on the chat's banner when the drawer closed first", async () => {
    await seedCodexModels(['gpt-6-astra', 'gpt-5.6-sol'])
    reportedModel = 'gpt-6-astra'
    let reject: ((error: Error) => void) | null = null
    rpc = (method) =>
      method === 'terminal.read'
        ? new Promise<RpcResponse>((_resolve, rejectRead) => {
            reject = rejectRead
          })
        : Promise.resolve(refusedRpc())
    await mountChat('codex')
    await openDrawer()
    await press(row('gpt-5.6-sol'))
    await press(pressable('Close picker'))

    await act(async () => {
      reject!(new Error('Connection closed'))
    })
    await settle()

    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(CODEX_UNREACHABLE)
  })

  it('says the failure of the only row in a one-model drawer', async () => {
    await seedCodexModels(['gpt-5.6-sol'])
    // Codex has not named its model yet, so the one row is not the current one.
    reportedModel = null
    rpc = async (method) =>
      method === 'terminal.read' ? reply({ terminal: { tail: CODEX_APPROVAL_SCREEN } }) : refusedRpc()
    await mountChat('codex')
    await openDrawer()
    expect(
      renderer!.root.findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'radio')
    ).toHaveLength(1)

    await press(row('gpt-5.6-sol'))

    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(CODEX_APPROVAL_FIRST)
    expect(screen).not.toHaveBeenCalled()
  })
})

describe("a failed pick's message is drawn in the theme's own danger colour", () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('in %s', async (scheme, palette) => {
    await mountChat('claude', (child) => (
      <ThemeProvider initialPreference={scheme}>{child}</ThemeProvider>
    ))
    await openDrawer()
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)

    await press(row('Opus'))

    const [message] = said(BUSY)
    expect(message).toBeDefined()
    const style = [message!.props.style].flat(Infinity) as Array<{ color?: string } | null>
    const colors = style.map((entry) => entry?.color).filter((color) => color !== undefined)
    expect(colors.at(-1)).toBe(palette.danger)
    // Announced when it appears, like the chat's own send-failure banner.
    expect(message!.props.accessibilityRole).toBe('alert')
  })
})

describe('the drawer, whatever lane it drives', () => {
  const MODEL: SessionOptionDescriptor = {
    id: 'model',
    label: 'Model',
    category: 'model',
    kind: {
      type: 'select',
      currentValue: 'sonnet',
      choices: [
        { value: 'sonnet', label: 'Sonnet 5' },
        { value: 'opus', label: 'Opus 4.8' }
      ]
    },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  }

  async function mountPicker(
    snapshot: SessionOptionDescriptor[],
    lane: Pick<MobileNativeChatSessionOptionsController, 'setOption' | 'invokeAction'>
  ): Promise<void> {
    const controller: MobileNativeChatSessionOptionsController = {
      snapshot,
      pendingId: null,
      ...lane,
      recordCommand: noop
    }
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatSessionOptionPickers, {
          controller,
          isWorking: false,
          reportFailure: screen
        })
      )
    })
    await openDrawer()
  }

  // The structured lane refuses on the host (agentSession.setOption), and its
  // controller is handed to the picker as it is; the picker must give every
  // lane the same place to say why.
  it('hands each pick a reporter and draws what it says inside the drawer', async () => {
    const setOption = vi.fn<MobileNativeChatSessionOptionsController['setOption']>(
      async (_id, _value, report) => {
        report?.('The host refused that model')
        return false
      }
    )
    await mountPicker([MODEL], { setOption, invokeAction: async () => false })

    await press(row('Opus 4.8'))

    expect(setOption).toHaveBeenCalledWith('model', 'opus', expect.any(Function))
    expectSaidInDrawer('The host refused that model')
    expect(screen).not.toHaveBeenCalled()
  })

  // The one row an agent-picker model shows: it types the agent's own `/model`.
  it("says why the agent-picker row did not open the agent's picker, inside the drawer", async () => {
    const invokeAction = vi.fn<MobileNativeChatSessionOptionsController['invokeAction']>(
      async (_id, report) => {
        report?.(BUSY)
        return false
      }
    )
    await mountPicker(
      [
        {
          ...MODEL,
          kind: { type: 'select', choices: [] },
          valueSource: 'unknown',
          action: { type: 'agent-picker' }
        }
      ],
      { setOption: async () => false, invokeAction }
    )

    await press(row('Choose in agent picker…'))

    expect(invokeAction).toHaveBeenCalledWith('model', expect.any(Function))
    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(BUSY)
    expect(screen).not.toHaveBeenCalled()
  })

  // The agent-picker row flips the tab to its terminal view when it lands, and
  // an ack-lost one says so on the way: the word and the unmount of the chat,
  // picker and all, reach React in the same render.
  it('hands a failure said in the render that unmounts the picker to the chat', async () => {
    let hide: () => void = noop
    function Host(): ReactElement | null {
      const [shown, setShown] = useState(true)
      hide = () => setShown(false)
      return shown
        ? createElement(MobileNativeChatSessionOptionPickers, {
            controller: {
              snapshot: [
                {
                  ...MODEL,
                  kind: { type: 'select', choices: [] },
                  valueSource: 'unknown',
                  action: { type: 'agent-picker' }
                }
              ],
              pendingId: null,
              setOption: async () => false,
              invokeAction: async (_id, report) => {
                report?.(UNCONFIRMED)
                hide()
                return true
              },
              recordCommand: noop
            },
            isWorking: false,
            reportFailure: screen
          })
        : null
    }
    await act(async () => {
      renderer = create(createElement(Host))
    })
    await openDrawer()

    await press(row('Choose in agent picker…'))

    expect(renderer!.toJSON()).toBeNull()
    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(UNCONFIRMED)
  })
})
