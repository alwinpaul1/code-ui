import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeReconcileText } from '../session/mobile-native-chat-draft-reconcile'
import { captureSendBoundary } from '../session/mobile-native-chat-pending-echo'
import { mobileNativeChatScopeKey } from '../session/mobile-native-chat-scope-key'
import type { MobileSessionTab, SessionTabsResult } from '../session/mobile-session-route-types'
import type { NativeChatOutboxEntry, NativeChatOutboxRoute } from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import type { HostCredentialStatus } from '../transport/types'
import type { SessionReplyFailure } from './session-reply-failure'
import { canReplyToAgent } from './session-reply-notification'

/**
 * A reply typed into a session's notification, sent through the chat outbox.
 *
 * The outbox (docs/mobile-chat-outbox.md) is where the phone's own composer puts a message the
 * moment its box empties, and where an app-wide drainer sends it from, with the evidence rules that
 * keep a message from being typed twice and a link that is down from losing it. A notification's
 * reply has no chat on screen and nothing else to rest on, so it takes that road: the words are
 * written to the outbox FIRST, with the route a chat would stamp for the tab (host, worktree, tab,
 * agent, session, terminal, transcript, the prompt the tab last reported) and the boundary the
 * transcript stood at (so an earlier identical message is never mistaken for this one landing), and
 * marked `unwritten`, as a message the outbox is handed before anything was typed is.
 *
 * What a lost link costs: the send, never the words. With no link the entry is written with no
 * route, keyed to the tab's composer; the drainer cannot send it (it has no session to send to), the
 * chat does when it is next opened, which is what the banner's "Tap to open" says. The route is read
 * from the host over the link the banner arrived on; if that cannot be done, nothing was lost.
 *
 * Not offered for a session whose banner carries no pane (a structured agent session): the outbox's
 * terminal lane is the one this sends through (session-reply-notification.ts).
 */

export type SessionReplyIo = {
  now: () => number
  /** A new outbox entry's id, as the composer makes one (`newOutboxSendId`). */
  newId: () => string
  /** The structured-session operation id the entry carries (`structuredSessionOperationId`). */
  newOperationId: () => string
  /** The link to the host, the UI's or the background watcher's; null when there is none. */
  resolveClient: (hostId: string) => RpcClient | null
  /** What the phone knows of the host's pairing: used only to say why a send could not be made. */
  hostCredential: (hostId: string) => Promise<HostCredentialStatus | null>
  readTabs: (client: RpcClient, worktreeId: string) => Promise<SessionTabsResult | null>
  /** One settled snapshot of the session's transcript, or null when none came in time. */
  readTranscript: (
    client: RpcClient,
    session: { agent: string; sessionId: string; transcriptPath: string | null }
  ) => Promise<NativeChatMessage[] | null>
  /** Appends the entry to the outbox; true once it is on disk, false when it could not be. */
  writeEntry: (entry: NativeChatOutboxEntry) => Promise<boolean>
}

export type SessionReplyOutcome =
  | { kind: 'queued' }
  /** `kept`: the words are in the outbox for the chat, whatever the line says. */
  | { kind: 'failed'; failure: SessionReplyFailure; kept: boolean }
  | { kind: 'not-a-reply' }

type Target = { hostId: string; worktreeId: string; tabId: string }

function readString(box: object, key: string): string | null {
  const value: unknown = Reflect.get(box, key)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Where a banner's reply goes: host, worktree and the tab its pane belongs to (a pane key is
 *  `<tabId>:<leafId>`, notification-routing.ts). */
function readTarget(data: unknown): Target | null {
  if (data == null || typeof data !== 'object') {
    return null
  }
  const hostId = readString(data, 'hostId')
  const worktreeId = readString(data, 'worktreeId')
  const paneKey = readString(data, 'paneKey')
  const tabId = paneKey?.split(':')[0]
  return hostId && worktreeId && tabId ? { hostId, worktreeId, tabId } : null
}

type TerminalTab = Extract<MobileSessionTab, { type: 'terminal' }>

/** Why a send could not be made with no link: what the phone knows of the host's pairing. */
async function failureWithoutLink(io: SessionReplyIo, hostId: string): Promise<SessionReplyFailure> {
  try {
    const status = await io.hostCredential(hostId)
    if (status === 'missing') {
      return 'needs-reauth'
    }
    return status === 'temporarily-unavailable' ? 'device-locked' : 'generic'
  } catch {
    return 'generic'
  }
}

function route(target: Target, tab: TerminalTab): NativeChatOutboxRoute {
  const status = tab.agentStatus
  return {
    hostId: target.hostId,
    worktreeId: target.worktreeId,
    tabId: target.tabId,
    lane: 'terminal',
    agent: status?.agentType ?? tab.launchAgent ?? null,
    sessionId: status?.providerSession?.id ?? null,
    terminal: tab.terminal,
    transcriptPath: status?.providerSession?.transcriptPath ?? null,
    // What the tab's hooks last reported, so only a prompt that CHANGED to these words is read as
    // their receipt (native-chat-outbox-headless.ts, promptIsReceiptOf). Left out when the status
    // carries none, as the chat leaves it out: "no prompt known" must not become "the tab had none",
    // or any prompt that matches would be trusted as the receipt.
    ...(typeof status?.prompt === 'string' ? { promptBefore: status.prompt } : {})
  }
}

export async function replyToSessionFromNotification(args: {
  userText: string | null
  data: unknown
  io: SessionReplyIo
}): Promise<SessionReplyOutcome> {
  const { io } = args
  const text = (args.userText ?? '').trim()
  const target = readTarget(args.data)
  if (text === '' || !target) {
    return { kind: 'not-a-reply' }
  }
  const draftKey = mobileNativeChatScopeKey(target.hostId, target.worktreeId, target.tabId)
  if (!draftKey) {
    return { kind: 'not-a-reply' }
  }
  const normalizedText = normalizeReconcileText(text)
  const entryBase: NativeChatOutboxEntry = {
    id: io.newId(),
    draftKey,
    pendingKey: null,
    text,
    normalizedText,
    baselineOccurrences: 0,
    baselineTailMessageId: null,
    baselineResolved: false,
    createdAt: io.now(),
    operationId: io.newOperationId(),
    autoAttempts: 0,
    // Handed to the outbox before anything was typed: until an automatic send of it starts, it
    // cannot have landed, whatever the transcript shows.
    unwritten: true
  }

  // The words are kept first, whatever else goes wrong: this is what a lost link costs nothing of.
  const keep = async (entry: NativeChatOutboxEntry): Promise<boolean> => {
    try {
      return await io.writeEntry(entry)
    } catch {
      return false
    }
  }
  const keptWithoutRoute = async (failure: SessionReplyFailure): Promise<SessionReplyOutcome> => ({
    kind: 'failed',
    failure,
    kept: await keep(entryBase)
  })

  const client = io.resolveClient(target.hostId)
  if (!client || client.getState() !== 'connected') {
    return keptWithoutRoute(await failureWithoutLink(io, target.hostId))
  }

  let tabs: SessionTabsResult | null = null
  try {
    tabs = await io.readTabs(client, target.worktreeId)
  } catch {
    tabs = null
  }
  if (!tabs) {
    return keptWithoutRoute('generic')
  }
  const tab = tabs.tabs.find((candidate) => candidate.id === target.tabId)
  if (!tab || tab.type !== 'terminal') {
    // The tab is gone from the desktop (or was never a terminal): there is no chat to keep the words
    // in, and the session cannot take a message.
    return { kind: 'failed', failure: 'refused', kept: false }
  }
  const tabRoute = route(target, tab)
  if (tabRoute.agent && !canReplyToAgent(tabRoute.agent)) {
    // The banner may not have known the agent; the tab does, and the outbox's drainer reads only
    // Claude's and Codex's composers. A message for another agent would wait behind a banner that
    // said it was sent.
    return { kind: 'failed', failure: 'refused', kept: false }
  }
  if (!tabRoute.agent || !tabRoute.sessionId || !tabRoute.terminal) {
    // The tab exists but runs no session the phone can name yet (or has no terminal handle): the
    // drainer has nowhere to send it, so it waits in the chat's outbox.
    return keptWithoutRoute('generic')
  }
  let messages: NativeChatMessage[] | null = null
  try {
    messages = await io.readTranscript(client, {
      agent: tabRoute.agent,
      sessionId: tabRoute.sessionId,
      transcriptPath: tabRoute.transcriptPath
    })
  } catch {
    messages = null
  }
  const boundary = messages ? captureSendBoundary(messages, normalizedText) : null
  const entry: NativeChatOutboxEntry = {
    ...entryBase,
    pendingKey: `${draftKey}\0${tabRoute.sessionId}`,
    route: tabRoute,
    baselineOccurrences: boundary?.baselineOccurrences ?? 0,
    baselineTailMessageId: boundary?.baselineTailMessageId ?? null,
    baselineResolved: boundary !== null,
    ...(boundary && boundary.markersBefore !== undefined ? { markersBefore: boundary.markersBefore } : {})
  }
  return (await keep(entry)) ? { kind: 'queued' } : { kind: 'failed', failure: 'generic', kept: false }
}
