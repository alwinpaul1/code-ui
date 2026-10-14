import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeReconcileText } from '../session/mobile-native-chat-draft-reconcile'
import { mobileNativeChatScopeKey } from '../session/mobile-native-chat-scope-key'
import { outboxEntryDrainable } from '../session/native-chat-outbox-sends'
import { createOutboxDrainer } from '../session/native-chat-outbox-drainer'
import type { MobileSessionTab, SessionTabsResult } from '../session/mobile-session-route-types'
import {
  changeNativeChatOutbox,
  nativeChatOutboxEntries,
  resetNativeChatOutboxForTests,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import { replyToSessionFromNotification, type SessionReplyIo } from './session-reply-response'

const connected = { getState: () => 'connected' } as unknown as RpcClient
const offline = { getState: () => 'disconnected' } as unknown as RpcClient

const DATA = {
  source: 'agent-task-complete',
  hostId: 'host-1',
  worktreeId: 'wt-1',
  notificationId: 'agent:wt-1:tab-1%3Aleaf-1:123',
  paneKey: 'tab-1:leaf-1'
}

function terminalTab(overrides: Record<string, unknown> = {}): MobileSessionTab {
  return {
    type: 'terminal',
    id: 'tab-1',
    leafId: 'leaf-1',
    title: 'claude',
    status: 'ready',
    terminal: 'term-9',
    isActive: true,
    agentStatus: {
      agentType: 'claude',
      state: 'done',
      prompt: 'add the retry budget',
      providerSession: { id: 'sess-1', transcriptPath: '/home/u/.claude/projects/x/sess-1.jsonl' }
    },
    ...overrides
  } as unknown as MobileSessionTab
}

const tabsOf = (...tabs: MobileSessionTab[]): SessionTabsResult =>
  ({ worktree: 'wt-1', snapshotVersion: 1, tabs, activeTabId: 'tab-1', activeTabType: 'terminal' }) as SessionTabsResult

const userRow = (id: string, text: string): NativeChatMessage =>
  ({ id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 1 }) as unknown as NativeChatMessage

function io(overrides: Partial<SessionReplyIo> = {}): SessionReplyIo {
  let counter = 0
  return {
    now: () => 1_000,
    newId: () => `send-1000-${++counter}`,
    newOperationId: () => 'op-fixed',
    resolveClient: () => connected,
    hostCredential: async () => 'ready',
    readTabs: async () => tabsOf(terminalTab()),
    readTranscript: async () => [userRow('m1', 'earlier'), userRow('m2', 'thanks, one more thing')],
    writeEntry: async (entry) => changeNativeChatOutbox((current) => [...current, entry]),
    ...overrides
  }
}

const REPLY = 'thanks, one more thing'

beforeEach(() => {
  resetNativeChatOutboxForTests()
})

// An inline Reply on a session's notification (the Claude app's, n530.java:775-792), sent through
// the chat outbox the phone's own composer uses (docs/mobile-chat-outbox.md): the words are written
// to the durable outbox FIRST, with the tab's route and the transcript boundary a chat would stamp,
// and the app-wide drainer sends them under the outbox's own evidence rules. A link that is down
// costs the send, never the words.

describe('a reply typed into a finished session’s notification', () => {
  it('is written to the outbox with the route a chat would stamp for that tab', async () => {
    const outcome = await replyToSessionFromNotification({ userText: REPLY, data: DATA, io: io() })
    expect(outcome).toEqual({ kind: 'queued' })
    const [entry] = nativeChatOutboxEntries()
    expect(entry).toMatchObject({
      id: 'send-1000-1',
      draftKey: mobileNativeChatScopeKey('host-1', 'wt-1', 'tab-1'),
      pendingKey: `${mobileNativeChatScopeKey('host-1', 'wt-1', 'tab-1')}\0sess-1`,
      text: REPLY,
      normalizedText: normalizeReconcileText(REPLY),
      createdAt: 1_000,
      autoAttempts: 0,
      unwritten: true,
      route: {
        hostId: 'host-1',
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        lane: 'terminal',
        agent: 'claude',
        sessionId: 'sess-1',
        terminal: 'term-9',
        transcriptPath: '/home/u/.claude/projects/x/sess-1.jsonl',
        promptBefore: 'add the retry budget'
      }
    })
    expect(entry!.operationId).toBeTruthy()
  })

  it('stamps where the transcript stood, so an identical earlier message is not taken for it landing', async () => {
    await replyToSessionFromNotification({ userText: REPLY, data: DATA, io: io() })
    const [entry] = nativeChatOutboxEntries()
    // One earlier user row already says the same words: this one is the second.
    expect(entry).toMatchObject({ baselineOccurrences: 1, baselineTailMessageId: 'm2', baselineResolved: true })
  })

  it('is one the drainer takes, and sends, with nothing on screen', async () => {
    await replyToSessionFromNotification({ userText: REPLY, data: DATA, io: io() })
    const [entry] = nativeChatOutboxEntries()
    expect(outboxEntryDrainable(entry!)).toBe(true)

    const send = vi.fn(async () => 'accepted' as const)
    const drainer = createOutboxDrainer({
      now: () => 10 * 60_000,
      connectedClient: () => connected,
      observe: async () => ({ kind: 'clear', terminal: 'term-9' }),
      send,
      setTimer: () => () => undefined,
      log: () => undefined
    })
    drainer.kick()
    await drainer.idle()
    drainer.stop()
    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls[0] as unknown as [RpcClient, NativeChatOutboxEntry])[1]).toMatchObject({ text: REPLY })
    // Sent and retired: nothing is left to send twice.
    expect(nativeChatOutboxEntries()).toHaveLength(0)
  })

  it('keeps the words as typed and trims what surrounds them', async () => {
    await replyToSessionFromNotification({ userText: `  ${REPLY}\n`, data: DATA, io: io() })
    expect(nativeChatOutboxEntries()[0]?.text).toBe(REPLY)
  })

  it('still queues when the transcript cannot be read, the boundary marked unresolved', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ readTranscript: async () => null })
    })
    expect(outcome).toEqual({ kind: 'queued' })
    expect(nativeChatOutboxEntries()[0]).toMatchObject({ baselineResolved: false, baselineOccurrences: 0 })
  })

  it('reads the agent from the tab’s launch when its status has not said', async () => {
    const tab = terminalTab({ agentStatus: { providerSession: { id: 'sess-1' } }, launchAgent: 'codex' })
    await replyToSessionFromNotification({ userText: REPLY, data: DATA, io: io({ readTabs: async () => tabsOf(tab) }) })
    expect(nativeChatOutboxEntries()[0]?.route).toMatchObject({ agent: 'codex', sessionId: 'sess-1' })
  })
})

describe('a reply typed while the link is lost', () => {
  it.each([
    ['no client at all', { resolveClient: () => null }],
    ['a client that is not connected', { resolveClient: () => offline }]
  ])('keeps the words in the outbox for the tab, with %s', async (_label, override) => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io(override as Partial<SessionReplyIo>)
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: true })
    const [entry] = nativeChatOutboxEntries()
    expect(entry).toMatchObject({
      text: REPLY,
      draftKey: mobileNativeChatScopeKey('host-1', 'wt-1', 'tab-1'),
      unwritten: true
    })
    // No route could be read, so the drainer leaves it for the chat, which opens on a tap of the banner.
    expect(entry!.route).toBeUndefined()
    expect(outboxEntryDrainable(entry!)).toBe(false)
  })

  it('says the pairing needs setting up again when the host’s credential is missing', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ resolveClient: () => null, hostCredential: async () => 'missing' })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'needs-reauth', kept: true })
  })

  it('says the device was locked when the phone’s secure storage could not be read', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ resolveClient: () => null, hostCredential: async () => 'temporarily-unavailable' })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'device-locked', kept: true })
  })

  it('says it could not send, plainly, when the credential cannot be asked about', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({
        resolveClient: () => null,
        hostCredential: async () => {
          throw new Error('keychain locked')
        }
      })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: true })
  })

  it('keeps the words when the tab list cannot be read over a link that is up', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ readTabs: async () => null })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: true })
    expect(nativeChatOutboxEntries()[0]).toMatchObject({ text: REPLY })
    expect(nativeChatOutboxEntries()[0]!.route).toBeUndefined()
  })

  it('keeps the words when reading the tab list throws', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({
        readTabs: async () => {
          throw new Error('relay dropped')
        }
      })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: true })
    expect(nativeChatOutboxEntries()).toHaveLength(1)
  })

  it('keeps the words for the chat when the tab runs no session the phone knows', async () => {
    const tab = terminalTab({ agentStatus: { agentType: 'claude', state: 'done' } })
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ readTabs: async () => tabsOf(tab) })
    })
    // The drainer has no transcript to look in and no session to send to; the chat sees it through.
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: true })
    expect(outboxEntryDrainable(nativeChatOutboxEntries()[0]!)).toBe(false)
  })

  it('says so, and not that they are kept, when the outbox cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ writeEntry: async () => false })
    })
    warn.mockRestore()
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: false })
  })

  it('says so when writing the outbox throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({
        writeEntry: async () => {
          throw new Error('disk full')
        }
      })
    })
    warn.mockRestore()
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: false })
  })
})

describe('a reply to a session that cannot take messages', () => {
  it('is refused, and nothing is queued, when the tab is gone from the desktop', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ readTabs: async () => tabsOf(terminalTab({ id: 'other-tab' })) })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'refused', kept: false })
    expect(nativeChatOutboxEntries()).toHaveLength(0)
  })

  it('is refused when the tab list is empty', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ readTabs: async () => tabsOf() })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'refused', kept: false })
  })

  it('is refused when the pane’s tab is not a terminal', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({
        readTabs: async () =>
          tabsOf({ type: 'file', id: 'tab-1', title: 'a.ts', filePath: '/a.ts', relativePath: 'a.ts', isDirty: false, isActive: true } as unknown as MobileSessionTab)
      })
    })
    expect(outcome).toEqual({ kind: 'failed', failure: 'refused', kept: false })
  })

  it('is refused for a terminal that has not got its handle yet', async () => {
    const outcome = await replyToSessionFromNotification({
      userText: REPLY,
      data: DATA,
      io: io({ readTabs: async () => tabsOf(terminalTab({ terminal: null, status: 'pending-handle' })) })
    })
    // Kept for the chat rather than refused: the tab exists, it is only not ready.
    expect(outcome).toEqual({ kind: 'failed', failure: 'generic', kept: true })
  })
})

describe('a tap that is not a reply', () => {
  it.each([[null], [''], ['  \n ']])('queues nothing for the words %j', async (userText) => {
    expect(await replyToSessionFromNotification({ userText, data: DATA, io: io() })).toEqual({ kind: 'not-a-reply' })
    expect(nativeChatOutboxEntries()).toHaveLength(0)
  })

  it.each([
    ['no data', null],
    ['no host', { ...DATA, hostId: undefined }],
    ['no worktree', { ...DATA, worktreeId: undefined }],
    ['no pane', { ...DATA, paneKey: undefined }],
    ['a pane with no tab in it', { ...DATA, paneKey: ':leaf-1' }],
    ['data that is not an object', 'banner']
  ])('queues nothing for %s', async (_label, data) => {
    expect(await replyToSessionFromNotification({ userText: REPLY, data, io: io() })).toEqual({ kind: 'not-a-reply' })
    expect(nativeChatOutboxEntries()).toHaveLength(0)
  })
})

describe('two replies to the same banner', () => {
  it('are two messages, each with its own id, as two presses of the composer are', async () => {
    await replyToSessionFromNotification({ userText: REPLY, data: DATA, io: io() })
    await replyToSessionFromNotification({ userText: REPLY, data: DATA, io: io({ newId: () => 'send-1000-second' }) })
    expect(nativeChatOutboxEntries().map((entry) => entry.id)).toEqual(['send-1000-1', 'send-1000-second'])
  })
})
