// S4 and S5 of docs/claude-app-parity-gaps.md, against the real draft store and the real send
// hook. S4: the outbox entry is written before the send gate, so a send the gate refuses because
// the desktop is unreachable is still sent later, by the app-wide drainer, instead of being lost
// to a notice. S5: a send refused before anything was written, with its words back in the
// composer, says so with a Retry, as the Claude app's snackbar does.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendWithOutcome = vi.fn()
vi.mock('./mobile-native-chat-send', () => ({
  sendMobileNativeChatMessageWithOutcome: (...args: unknown[]) => sendWithOutcome(...args),
  typeMobileNativeChatCommandWithOutcome: vi.fn(async () => 'accepted'),
  clearMobileNativeChatInput: vi.fn(async () => true),
  openMobileNativeChatSendBudget: () => Date.now() + 15_000,
  MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS: 15_000,
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS: 2_000
}))
vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))
vi.mock('./mobile-native-chat-screen-read', () => ({ readMobileNativeChatScreen: () => Promise.resolve(null) }))
vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async () => null),
  writeNativeChatDraft: vi.fn(async () => undefined)
}))

import {
  hydrateNativeChatOutbox,
  nativeChatOutboxEntries,
  nativeChatOutboxWritesSettled,
  resetNativeChatOutboxForTests
} from '../storage/native-chat-outbox'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { isOutboxSendLive, mountOutboxDrainer, publishOutboxChatRoute, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileStructuredNativeChatSendBridge } from './use-mobile-structured-native-chat-send-bridge'
import { parkRefusedComposerSend } from './native-chat-send-gate-outbox'
import type { MobileNativeChatSendErrorDetails } from './use-mobile-native-chat-send-error'

const DRAFT_KEY = 'host\0worktree\0tab'
const TEXT = 'deploy it'

describe.each(['claude', 'codex'] as const)('a %s send the gate refuses before anything was written', (agent) => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  let linkState: 'connected' | 'disconnected' = 'disconnected'
  let dialog: string | null = null
  const notices: Array<{ message: string; details?: MobileNativeChatSendErrorDetails }> = []
  const unmounts: Array<() => void> = []

  function Probe(): null {
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: 'session',
      messages: [],
      launchDraft: null,
      chatActive: true,
      transcriptLoading: false,
      transcriptSettled: true
    })
    api = useMobileNativeChatMessageSend({
      client: { sendRequest: vi.fn(), getState: () => linkState, getLastConnectedAt: () => 1, notifyForeground: vi.fn() } as never,
      enabled: true,
      handleRef: { current: 'term' },
      deviceTokenRef: { current: 'device' },
      agentRef: { current: agent },
      commandSendRef: { current: () => {} },
      captureSendOrigin: drafts.captureSendOrigin,
      readSeededLaunchDraftSeed: () => null,
      clearDraftForSend: drafts.clearDraftForSend,
      restoreRejectedDraft: drafts.restoreRejectedDraft,
      showSendingEcho: drafts.showSendingEcho,
      acceptSend: drafts.acceptSend,
      holdUnconfirmedSend: drafts.holdUnconfirmedSend,
      onSendError: (message, details) => {
        notices.push(details ? { message, details } : { message })
      },
      refuseUnderDialog: async () => dialog
    })
    return null
  }

  /** Where this chat's sends go, as the chat controller publishes it, and the app-wide drainer
   *  mounted at the root: what lets the outbox send an entry with no chat on screen. */
  function drainerCanSendIt(): void {
    unmounts.push(mountOutboxDrainer())
    unmounts.push(
      publishOutboxChatRoute(DRAFT_KEY, {
        hostId: 'host',
        worktreeId: 'worktree',
        tabId: 'tab',
        lane: 'terminal',
        agent,
        sessionId: 'session',
        terminal: 'term',
        transcriptPath: null
      })
    )
  }

  /** Boxed: an async function that returned the send's promise would wait for it to settle. */
  async function typeAndSend(): Promise<{ pending: Promise<string> }> {
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    let pending!: Promise<string>
    await act(async () => {
      pending = api!.sendWithOutcome(TEXT)
      await vi.advanceTimersByTimeAsync(200)
    })
    return { pending }
  }

  async function outcomeOf({ pending }: { pending: Promise<string> }): Promise<string> {
    let outcome = ''
    let settled = false
    void pending.then(
      (value) => {
        outcome = value
        settled = true
      },
      (error: unknown) => {
        outcome = `threw: ${String(error)}`
        settled = true
      }
    )
    // In short acts, as the gate polls the link: React applies a render only when an act ends.
    for (let step = 0; step < 300 && !settled; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
    }
    return outcome
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    linkState = 'disconnected'
    dialog = null
    notices.length = 0
    sendWithOutcome.mockReset()
    sendWithOutcome.mockResolvedValue('accepted')
    resetMobileNativeChatTerminalWritesForTests()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await act(async () => {
      renderer = create(createElement(Probe))
    })
  })

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    for (const unmount of unmounts.splice(0)) {
      unmount()
    }
    vi.useRealTimers()
    await clearNativeChatDraftStores()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
  })

  it('writes the outbox entry while it waits for the link, with the words still in the composer', async () => {
    drainerCanSendIt()
    const pending = await typeAndSend()
    const [entry] = nativeChatOutboxEntries()
    expect(entry?.text).toBe(TEXT)
    expect(entry?.atGate).toBe(true)
    expect(drafts!.composerText).toBe(TEXT)
    await outcomeOf(pending)
  })

  it('leaves it in the outbox for the drainer when the desktop never came back, the box empty and its bubble drawn', async () => {
    drainerCanSendIt()
    const outcome = await outcomeOf(await typeAndSend())
    const [entry] = nativeChatOutboxEntries()
    expect(outcome).toBe('unknown')
    expect(entry?.text).toBe(TEXT)
    expect(entry?.atGate).toBeUndefined()
    expect(isOutboxSendLive(entry!.id)).toBe(false)
    expect(drafts!.composerText).toBe('')
    expect(drafts!.pending.map((item) => item.id)).toEqual([outboxEchoId(entry!.id)])
    expect(notices).toEqual([{ message: 'Message waits for your desktop: it is sent when the connection is back' }])
    expect(sendWithOutcome).not.toHaveBeenCalled()
  })

  it('does not leave a message the app was killed under while it waited for the link to be sent beside the words in the composer', async () => {
    drainerCanSendIt()
    const pending = await typeAndSend()
    await nativeChatOutboxWritesSettled()
    // The process dies here: what is on disk is all the next one has.
    resetNativeChatOutboxForTests()
    await hydrateNativeChatOutbox()
    expect(nativeChatOutboxEntries()).toEqual([])
    await outcomeOf(pending)
  })

  it('gives the words back with a Retry when nothing could send it later (S5)', async () => {
    const outcome = await outcomeOf(await typeAndSend())
    expect(outcome).toBe('rejected')
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(drafts!.composerText).toBe(TEXT)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.message).toMatch(/^Message not sent: /)
    expect(notices[0]!.details).toEqual({ retry: true })
  })

  it('parks a composer send the screen look refused in the outbox: box empty, bubble drawn, nothing lost', async () => {
    drainerCanSendIt()
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    let parked = false
    await act(async () => {
      parked = parkRefusedComposerSend({ text: TEXT, captureSendOrigin: drafts!.captureSendOrigin, clearDraftForSend: drafts!.clearDraftForSend, showSendingEcho: drafts!.showSendingEcho })
    })
    const [entry] = nativeChatOutboxEntries()
    expect(parked).toBe(true)
    expect(entry?.text).toBe(TEXT)
    expect(entry?.atGate).toBeUndefined()
    expect(isOutboxSendLive(entry!.id)).toBe(false)
    expect(drafts!.composerText).toBe('')
    expect(drafts!.pending.map((item) => item.id)).toEqual([outboxEchoId(entry!.id)])
  })

  it('does not park it when nothing could send it later: no entry, the words stay', async () => {
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    let parked = true
    await act(async () => {
      parked = parkRefusedComposerSend({ text: TEXT, captureSendOrigin: drafts!.captureSendOrigin, clearDraftForSend: drafts!.clearDraftForSend, showSendingEcho: drafts!.showSendingEcho })
    })
    expect(parked).toBe(false)
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(drafts!.composerText).toBe(TEXT)
  })

  it('offers a Retry when a dialog on the desktop refused it, with its words still in the composer (S5)', async () => {
    linkState = 'connected'
    dialog = 'Message not sent: answer the prompt on your desktop first'
    const outcome = await outcomeOf(await typeAndSend())
    expect(outcome).toBe('rejected')
    expect(nativeChatOutboxEntries()).toEqual([])
    expect(drafts!.composerText).toBe(TEXT)
    expect(notices).toEqual([{ message: dialog, details: { retry: true } }])
  })
})

describe('a structured-session send the gate refuses before anything was written', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let bridge: ReturnType<typeof useMobileStructuredNativeChatSendBridge> | null = null
  const notices: Array<{ message: string; details?: MobileNativeChatSendErrorDetails }> = []
  const sendStructured = vi.fn(async () => 'accepted' as const)
  const unmounts: Array<() => void> = []
  const client = { sendRequest: vi.fn(), getState: () => 'disconnected', getLastConnectedAt: () => 1, notifyForeground: vi.fn() }

  function Probe(): null {
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: 'session',
      messages: [],
      launchDraft: null,
      chatActive: true,
      transcriptLoading: false,
      transcriptSettled: true
    })
    bridge = useMobileStructuredNativeChatSendBridge({
      agent: 'claude',
      sendStructured,
      sendConditions: { client: client as never, sendable: true },
      captureSendOrigin: drafts.captureSendOrigin,
      clearDraftForSend: drafts.clearDraftForSend,
      acceptSend: drafts.acceptSend,
      holdUnconfirmedSend: drafts.holdUnconfirmedSend,
      restoreRejectedDraft: drafts.restoreRejectedDraft,
      showSendingEcho: drafts.showSendingEcho,
      onSendError: (message, details) => {
        notices.push(details ? { message, details } : { message })
      }
    })
    return null
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    notices.length = 0
    sendStructured.mockClear()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await act(async () => {
      renderer = create(createElement(Probe))
    })
  })

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    for (const unmount of unmounts.splice(0)) {
      unmount()
    }
    vi.useRealTimers()
    await clearNativeChatDraftStores()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
  })

  it('leaves it in the outbox for the drainer to send under its operation id when the desktop never came back', async () => {
    unmounts.push(mountOutboxDrainer())
    unmounts.push(
      publishOutboxChatRoute(DRAFT_KEY, {
        hostId: 'host',
        worktreeId: 'worktree',
        tabId: 'tab',
        lane: 'session',
        agent: 'claude',
        sessionId: 'session',
        terminal: null,
        transcriptPath: null
      })
    )
    await act(async () => {
      drafts!.setComposerText(TEXT)
    })
    let outcome = ''
    let settled = false
    await act(async () => {
      void bridge!.sendWithOutcome(TEXT).then((value) => {
        outcome = value
        settled = true
      })
    })
    for (let step = 0; step < 300 && !settled; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
    }
    const [entry] = nativeChatOutboxEntries()
    expect(outcome).toBe('unknown')
    expect(entry?.text).toBe(TEXT)
    expect(entry?.atGate).toBeUndefined()
    expect(drafts!.composerText).toBe('')
    expect(notices).toEqual([{ message: 'Message waits for your desktop: it is sent when the connection is back' }])
    expect(sendStructured).not.toHaveBeenCalled()
  })
})
