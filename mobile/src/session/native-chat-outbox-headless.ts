import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import { statusCopyMayBeCut } from './agent-status-prompts'
import { claudeComposerLive } from './claude-composer-screen'
import { codexComposerLive } from './codex-composer-screen'
import { readSendUnderDialogRefusal } from './mobile-native-chat-dialog-guard'
import {
  findLandedImagePreviewEchoes,
  normalizeReconcileText
} from './mobile-native-chat-draft-reconcile'
import { newNativeChatFeedToken } from './mobile-native-chat-feed-token'
import { pasteMobileNativeChatImagePaths } from './mobile-native-chat-image-send'
import { settleAfterImagePaste } from './mobile-native-chat-image-send-settle'
import { readMobileNativeChatScreen } from './mobile-native-chat-screen-read'
import { openMobileNativeChatSendBudget } from './mobile-native-chat-send'
import { CLEAR_NOT_WRITTEN, writeChatSend } from './mobile-native-chat-send-write'
import { healMobileNativeChatStaleInput, mobileNativeChatInputResidue } from './mobile-native-chat-stale-input'
import {
  acquireMobileNativeChatTerminalWriteForSend,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'
import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'
import { sessionTabsListRead } from './mobile-session-read-operations'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'
import { queueRowIsPendingSend } from './mobile-terminal-queued-messages'
import { outboxEntryLanding } from './native-chat-outbox-recovery-plan'
import type { OutboxDrainObservation, OutboxSendOutcome } from './native-chat-outbox-drain-plan'
import { INPUT_STILL_HOLDS_TEXT } from './mobile-native-chat-verified-clear'

/**
 * How the app-wide drainer (native-chat-outbox-drainer.ts) looks at and sends an entry with no
 * chat on screen: everything a chat screen would otherwise have told it is read from the host.
 *
 * A structured session needs no look (native-chat-outbox-session-send.ts): every attempt carries
 * the entry's one operation id, and the host's ledger answers a repeat with the first attempt's
 * result, so a resend can never post the message twice.
 *
 * A terminal has no such id, so before it types anything it needs evidence the message did not
 * arrive, and a moment when typing is safe. It reads, in order:
 *
 * 1. the worktree's tab list: the tab still there, its terminal today, the session it runs (a
 *    session the tab's own agent says it moved to is not the one the message was written for),
 *    whether its last hook prompt changed to the message's words since it left, and whether the
 *    agent works;
 * 2. the session's transcript: the message's row after the boundary it left at, or for a photo
 *    a row naming one of the desktop paths it pasted;
 * 3. the screen: no dialog, the agent's own input box, nothing typed in it at the desk, and a
 *    queue box it can read that does not hold the message.
 *
 * Any of them that cannot be read is "not now", never "not there".
 */

/** How long one read of the drainer's waits before it counts as no reading. */
export const OUTBOX_HEADLESS_READ_MS = 8_000
/** Transcript rows read for the landing check: far past the chat's first page, so the boundary
 *  a message left at is still in the read after a long turn. */
export const OUTBOX_HEADLESS_TRANSCRIPT_LIMIT = 200

type TerminalTab = Extract<MobileSessionTab, { type: 'terminal' }>

function findTab(result: SessionTabsResult, entry: NativeChatOutboxEntry): TerminalTab | null {
  const route = entry.route!
  const terminals = result.tabs.filter((tab): tab is TerminalTab => tab.type === 'terminal')
  return (
    terminals.find((tab) => tab.id === route.tabId) ??
    (route.terminal ? terminals.find((tab) => tab.terminal === route.terminal) : undefined) ??
    null
  )
}

async function readTabs(client: RpcClient, worktreeId: string): Promise<SessionTabsResult | null> {
  try {
    const response = await sessionTabsListRead.request(
      client,
      { worktree: worktreeId },
      { timeoutMs: OUTBOX_HEADLESS_READ_MS, failWhenDisconnected: true }
    )
    if (!response.ok) {
      return null
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reply is the session tab snapshot (session-read-reply-schema.ts reads it as unknown); every field used below is checked where it is read.
    const result = sessionTabsListRead.interpret(response) as SessionTabsResult | null
    return result && Array.isArray(result.tabs) ? result : null
  } catch {
    return null
  }
}

function wordsMatch(entry: NativeChatOutboxEntry, prompt: string): boolean {
  const copy = normalizeReconcileText(prompt)
  return copy !== '' && (copy === entry.normalizedText || (statusCopyMayBeCut(prompt) && entry.normalizedText.startsWith(copy)))
}

/**
 * Whether the tab's last hook prompt is this message's receipt: its words, and not the prompt the
 * tab already had when the message left (`route.promptBefore`). No time stamp is used: the
 * status's `updatedAt` is its delivery clock, which every tool ping and every relay reconnect
 * restamps, and a later state of an earlier turn carries that turn's prompt with a fresh
 * `startedAt` (Opus review of 4efae5746: a repeated "continue" was retired unsent). With no
 * prompt-before known, no prompt is trusted, and the transcript decides.
 */
export function promptIsReceiptOf(entry: NativeChatOutboxEntry, prompt: string | undefined): boolean {
  const before = entry.route?.promptBefore
  if (!prompt || before === undefined) { return false }
  // A photo with no caption: its copy is chips alone, numbered anew, so a chips-only prompt other
  // than the one the tab had when it left is a new photo prompt.
  const chipsOnly = /\[Image\s+#\d+\]/.test(prompt) && prompt.replace(/\[Image\s+#\d+\]/g, '').trim() === ''
  if (entry.normalizedText === '') { return entry.hasAttachments === true && chipsOnly && prompt !== before }
  return wordsMatch(entry, prompt) && (before === null || before === '' || !wordsMatch(entry, before))
}

/** Words left on the agent's input line by an earlier try of this same message (its words, or
 *  only its photo chips): the send's own clear takes them, so they are no one else's typing.
 *  Chips count as its own only up to the photos it carries: a text entry has none, and a
 *  screenshot pasted at the desk is someone's input (re-review of 978156bf9). */
export function inputHoldsOnlyItsOwn(entry: NativeChatOutboxEntry, draft: string): boolean {
  const chips = draft.match(/\[Image #\d+\]/g)?.length ?? 0
  if (chips > (entry.attachments?.length ?? 0)) {
    return false
  }
  const rest = draft.replace(/\[Image #\d+\]/g, ' ').trim()
  if (rest === '') {
    return true
  }
  return normalizeReconcileText(rest) === entry.normalizedText || queueRowIsPendingSend(entry.text, rest)
}

/** One snapshot of a session's transcript, or null when none came in time. */
export function readTranscriptOnce(
  client: RpcClient,
  input: { agent: string; sessionId: string; transcriptPath: string | null }
): Promise<NativeChatMessage[] | null> {
  return new Promise((resolve) => {
    let done = false
    let unsubscribe: () => void = () => {}
    const finish = (messages: NativeChatMessage[] | null): void => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timer)
      // A frame can arrive inside the subscribe call itself, before it returns its unsubscribe.
      queueMicrotask(() => unsubscribe())
      resolve(messages)
    }
    const timer = setTimeout(() => finish(null), OUTBOX_HEADLESS_READ_MS)
    try {
      unsubscribe = client.subscribe(
        'nativeChat.subscribe',
        {
          agent: input.agent,
          sessionId: input.sessionId,
          limit: OUTBOX_HEADLESS_TRANSCRIPT_LIMIT,
          subscriptionId: newNativeChatFeedToken(input.agent, input.sessionId),
          capabilities: { transcriptPending: 1 },
          ...(input.transcriptPath ? { transcriptPath: input.transcriptPath } : {})
        },
        (raw) => {
          const frame = (raw ?? {}) as { type?: unknown; messages?: unknown; pending?: unknown; error?: unknown }
          if (frame.type === 'error' || frame.type === 'end' || typeof frame.error === 'string') {
            finish(null)
            return
          }
          // A pending snapshot has no file behind it yet: not a settled read.
          if (frame.type === 'snapshot' && frame.pending !== true && Array.isArray(frame.messages)) {
            finish(frame.messages as NativeChatMessage[])
          }
        }
      )
      if (done) {
        unsubscribe()
      }
    } catch {
      finish(null)
    }
  })
}

/** Whether the transcript shows a photo entry's row: one naming a desktop path it pasted. */
function photoRowLanded(entry: NativeChatOutboxEntry, messages: readonly NativeChatMessage[]): boolean {
  // No photos: findLandedImagePreviewEchoes skips an entry with no previews.
  const attachments = entry.attachments ?? []
  return (
    findLandedImagePreviewEchoes(messages, [
      {
        id: entry.id,
        text: entry.text,
        images: attachments.map((item) => item.previewUri),
        imagePaths: attachments.map((item) => item.path),
        expectedOccurrence: entry.baselineOccurrences + 1,
        baselineTailMessageId: entry.baselineTailMessageId,
        sentAt: entry.createdAt,
        // Only the path rule: a photo row is told by the paths it names, never guessed.
        baselineResolved: false
      }
    ]).length > 0
  )
}

function sessionMovedOn(entry: NativeChatOutboxEntry, tab: TerminalTab): boolean {
  const route = entry.route!
  const status = tab.agentStatus
  const current = status?.providerSession?.id
  // Only the tab's own agent naming another session: a nested agent's status (another
  // agent run from this one's shell) names its own, and says nothing about this chat.
  return Boolean(
    current &&
      route.sessionId &&
      current !== route.sessionId &&
      (status?.agentType === undefined || status.agentType === route.agent)
  )
}

/** What the drainer needs to know before it sends a terminal entry (see the header). */
export async function observeTerminalOutboxEntry(
  client: RpcClient,
  entry: NativeChatOutboxEntry
): Promise<OutboxDrainObservation> {
  const route = entry.route
  if (!route || route.lane !== 'terminal' || !route.agent || !route.sessionId) {
    return { kind: 'busy' }
  }
  const tabs = await readTabs(client, route.worktreeId)
  if (!tabs) {
    return { kind: 'busy' }
  }
  const tab = findTab(tabs, entry)
  if (!tab) {
    return { kind: 'tab-gone' }
  }
  if (sessionMovedOn(entry, tab)) {
    return { kind: 'session-changed' }
  }
  if (promptIsReceiptOf(entry, tab.agentStatus?.prompt)) {
    return { kind: 'landed' }
  }
  const state = tab.agentStatus?.state
  if (!tab.terminal || state === 'working' || state === 'blocked' || state === 'waiting') {
    return { kind: 'busy' }
  }
  const transcriptPath =
    route.transcriptPath ??
    (tab.agentStatus?.providerSession?.id === route.sessionId
      ? (tab.agentStatus.providerSession.transcriptPath ?? null)
      : null)
  const messages = await readTranscriptOnce(client, { agent: route.agent, sessionId: route.sessionId, transcriptPath })
  if (!messages) {
    return { kind: 'busy' }
  }
  if (photoRowLanded(entry, messages)) {
    return { kind: 'landed' }
  }
  const landing = outboxEntryLanding(entry, messages, [])
  if (landing === 'landed') {
    return { kind: 'landed' }
  }
  if (landing === 'unsure') {
    return { kind: 'unsure' }
  }
  const screen = await readMobileNativeChatScreen({
    client,
    terminal: tab.terminal,
    deadline: Date.now() + OUTBOX_HEADLESS_READ_MS
  })
  if (!screen) {
    return { kind: 'busy' }
  }
  const boxLive = route.agent === 'codex' ? codexComposerLive(screen.lines) : claudeComposerLive(screen.lines)
  // Words typed at the desk: the send's clear would wipe them. Its own words, left by an earlier
  // try, are not someone's typing: left alone they held the entry here for a day.
  const ownLeftover = screen.draft.trim() !== '' && inputHoldsOnlyItsOwn(entry, screen.draft)
  if (!boxLive || (screen.draft.trim() !== '' && !ownLeftover)) {
    return { kind: 'busy' }
  }
  const queue = queueBoxReadFromScreen(screen.lines, route.agent, screen.draft)
  if (queue.entries.some((drawn) => queueRowIsPendingSend(entry.text, drawn))) {
    // Waiting in the agent's own queue: it goes when the turn ends.
    return { kind: 'landed' }
  }
  // Text on Claude's input line hides its queue hint, so a line holding only this message's own
  // leftover reads as no box at all. Claude takes its queue when a turn ends, so with the tab
  // saying its agent is done there is none to hold the message.
  const queueUnseenButDone = ownLeftover && !queue.readable && state === 'done' && queue.entries.length === 0
  if ((!queue.readable && !queueUnseenButDone) || queue.entries.length > 0) {
    return { kind: 'busy' }
  }
  return { kind: 'clear', terminal: tab.terminal }
}

/** Types a terminal entry again: its photos' paths first, then its words, with the same checks a
 *  composer send makes (the dialog look, the stale-input heal, Claude's check that it took them).
 *  'not-now' is a refusal before anything was typed (it costs the entry no attempt); 'rejected'
 *  may have left something on the input line, never submitted. */
export async function sendTerminalOutboxEntry(
  client: RpcClient,
  entry: NativeChatOutboxEntry,
  terminal: string
): Promise<OutboxSendOutcome> {
  const agent = entry.route?.agent ?? null
  const owner = acquireMobileNativeChatTerminalWriteForSend(terminal)
  if (!owner) {
    // Another sequence (a composer send, an answer) is typing into it: not now.
    return 'not-now'
  }
  try {
    let deadline = openMobileNativeChatSendBudget()
    // One more look at the desk's input now the terminal is ours: someone may have started
    // typing there since the drainer's look, and the clear below would take their words.
    const now = await readMobileNativeChatScreen({ client, terminal, deadline })
    if (!now || (now.draft.trim() !== '' && !inputHoldsOnlyItsOwn(entry, now.draft))) {
      return 'not-now'
    }
    const leftoverOwn = now.draft.trim() !== ''
    const refusal = await readSendUnderDialogRefusal({ client, terminal, agent, deadline, requireComposer: true })
    if (refusal) {
      return 'not-now'
    }
    if (!(await healMobileNativeChatStaleInput({ client, terminal, deviceToken: null, deadline }))) {
      return 'not-now'
    }
    const text = entry.text.trimEnd()
    const paths = (entry.attachments ?? []).map((item) => item.path)
    if (paths.length > 0) {
      const pasted = await pasteMobileNativeChatImagePaths({
        client,
        agent,
        terminal,
        deviceToken: null,
        imagePaths: paths,
        followedByText: text.length > 0,
        deadline
      })
      if (!pasted) {
        return 'rejected'
      }
      const settled = await settleAfterImagePaste({
        client,
        terminal,
        agent,
        expected: paths.length,
        deadline,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      })
      if (settled.refusal) {
        // The paths are on the input line and nothing was submitted. The drainer's next look
        // takes chips alone on the line as this message's own (inputHoldsOnlyItsOwn), and that
        // try's paste clears them first (its leading Ctrl+U).
        return 'rejected'
      }
      deadline = settled.textDeadline
    }
    const written = await writeChatSend({
      agent,
      client,
      terminal,
      text,
      hasImages: paths.length > 0,
      syncComposer: true,
      classification: 'chat',
      typesCodexCommand: false,
      seed: null,
      residue: mobileNativeChatInputResidue(terminal),
      deadline,
      deviceToken: null,
      receipts: () => []
    })
    if (written.kind === 'stopped') {
      // A clear that did not go typed none of the words; Claude declining them did.
      // A clear that could not take this message's OWN leftover will never take it: that costs an
      // attempt, or it would loop for a day (re-review of 978156bf9).
      const untyped =
        written.message === CLEAR_NOT_WRITTEN || (written.message === INPUT_STILL_HOLDS_TEXT && !leftoverOwn)
      return untyped && paths.length === 0 ? 'not-now' : 'rejected'
    }
    return written.outcome
  } finally {
    releaseMobileNativeChatTerminalWrite(terminal, owner)
  }
}
