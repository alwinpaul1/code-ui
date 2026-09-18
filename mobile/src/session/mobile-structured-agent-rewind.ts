import { useCallback } from 'react'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { activeStructuredAgentSessionTurnId } from '../../../src/shared/structured-agent-session-projection'
import type { RpcClient } from '../transport/rpc-client'
import { pendingStructuredApproval, pendingStructuredQuestion } from './mobile-structured-agent-prompts'
import {
  requestStructuredAgentSessionMutation,
  retainStructuredSessionOperationId
} from './mobile-structured-agent-session-rpc'

/**
 * Rewind the conversation to an earlier user message, on the structured lane.
 *
 * Orca's `agentSession.rewind` (ce4a3a418, #19235; in the desktop from 1.4.205)
 * drops the named user message and everything after it, then resumes the
 * provider at the reply before it. It is CONVERSATION ONLY: the host wraps no
 * file restore, so files on the desktop stay as they are. The copy below says
 * so in plain words, and nothing here may imply otherwise.
 *
 * The reply type and the refusal reasons live in upstream's
 * `agent-session-rewind.ts`, which is not vendored (LOCAL-FILES.md); the
 * shapes here are copied from it and pinned by the test beside this file.
 */

/** The host's reply: which item it rewound to, and the journal epoch that replaced the old one. */
export type StructuredRewindResult = { itemId: string; epoch: string }

/** Whether the host will rewind THIS session, as `agentSession.options` reports it.
 *  A host that predates the field reports nothing, and nothing means no affordance. */
export type StructuredRewindSupport = { supported: true } | { supported: false; reason: string }

export type StructuredRewindOutcome =
  | { status: 'accepted'; epoch: string }
  | { status: 'rejected'; message: string }
  | { status: 'unknown'; message: string }

/** A Claude rewind kills and resumes the CLI child; the 15 s send budget does not fit that. */
const REWIND_TIMEOUT_MS = 60_000

const REFUSAL_PREFIX = 'agent_session_rewind:'

const NOT_SENT = 'Rewind not sent'
const DISCONNECTED = 'Rewind not sent (disconnected)'
const BUSY = 'The agent is still working. Wait for it to finish, then try again.'
const INVALID_TARGET = 'This message cannot be rewound to.'
const UNCONFIRMED = 'Rewind unconfirmed. Check the chat before trying again.'

/** Upstream's `AGENT_SESSION_REWIND_REASONS`, each with words a reader can act on. */
const REFUSAL_COPY: Record<string, string> = {
  'stale-epoch': 'The session moved on. Reload the chat and try again.',
  busy: BUSY,
  'invalid-target': INVALID_TARGET,
  unsupported: 'Rewind is not available for this session.',
  'history-not-paginated': 'Rewind is not available for this session.',
  'history-limit': 'There is too much history to rewind here.',
  'provider-refused': 'The agent refused the rewind. Nothing was changed.',
  'proof-mismatch': 'The desktop transcript did not match. Nothing was changed.'
}

export function parseStructuredRewindSupport(options: unknown): StructuredRewindSupport | null {
  const rewind: unknown = Reflect.get(Object(options ?? {}), 'rewind')
  if (rewind === null || typeof rewind !== 'object') {
    return null
  }
  const supported: unknown = Reflect.get(rewind, 'supported')
  if (supported === true) {
    return { supported: true }
  }
  const reason: unknown = Reflect.get(rewind, 'reason')
  return supported === false && typeof reason === 'string' && reason.length > 0
    ? { supported: false, reason }
    : null
}

function rewindRefusalReason(message: string): string | null {
  return message.startsWith(REFUSAL_PREFIX) ? message.slice(REFUSAL_PREFIX.length) : null
}

function isRewindTarget(items: readonly AgentJournalRenderItem[], itemId: string): boolean {
  const item = items.find((candidate) => candidate.itemId === itemId)
  return item?.body.kind === 'message' && item.body.role === 'user'
}

/** Same rule the composer's `/clear` and `/compact` apply before dispatching. */
function sessionBusy(items: readonly AgentJournalRenderItem[]): boolean {
  return (
    activeStructuredAgentSessionTurnId(items) !== null ||
    items.some((item) => pendingStructuredApproval(item) || pendingStructuredQuestion(item))
  )
}

export async function dispatchStructuredRewind(args: {
  client: RpcClient | null
  sessionId: string | null
  enabled: boolean
  sessionKey: string
  itemId: string
  /** Read at call time: the fence and epoch the subscription last delivered, and the items. */
  state: { fence: number | null; epoch: string | null; items: readonly AgentJournalRenderItem[] }
  operationIds: Map<string, string>
}): Promise<StructuredRewindOutcome> {
  const { client, sessionId, enabled, sessionKey, itemId, state, operationIds } = args
  if (!client || !sessionId || !enabled || state.fence === null || state.epoch === null) {
    return { status: 'rejected', message: DISCONNECTED }
  }
  if (sessionBusy(state.items)) {
    return { status: 'rejected', message: BUSY }
  }
  if (!isRewindTarget(state.items, itemId)) {
    return { status: 'rejected', message: INVALID_TARGET }
  }
  const fields = { itemId, expectedEpoch: state.epoch }
  const key = `${sessionKey}:agentSession.rewind:${JSON.stringify(fields)}`
  const clientOperationId = retainStructuredSessionOperationId(
    operationIds,
    key,
    operationIds.get(key)
  )
  const result = await requestStructuredAgentSessionMutation<StructuredRewindResult>({
    client,
    method: 'agentSession.rewind',
    fingerprintMethod: 'agentSession.rewind',
    sessionId,
    expectedRuntimeFence: state.fence,
    fields,
    clientOperationId,
    timeoutMs: REWIND_TIMEOUT_MS
  })
  // The host keeps a durable record of a rewind it may have applied and replays
  // its outcome for the same operation id, so an unknown outcome keeps the id:
  // the retry asks about THIS rewind instead of running a second one.
  if (
    result.status === 'unknown' ||
    (result.status === 'refused' && rewindRefusalReason(result.message) === 'outcome-unknown')
  ) {
    return { status: 'unknown', message: UNCONFIRMED }
  }
  operationIds.delete(key)
  if (result.status === 'accepted') {
    return { status: 'accepted', epoch: result.value.epoch }
  }
  if (result.status === 'refused') {
    const reason = rewindRefusalReason(result.message)
    return {
      status: 'rejected',
      message: (reason !== null ? REFUSAL_COPY[reason] : undefined) ?? result.message
    }
  }
  return {
    status: 'rejected',
    message: result.message === 'Request not sent' ? NOT_SENT : result.message
  }
}

/** Binds the dispatcher to the session hook's live refs. Resolves true only on
 *  an accepted rewind; every other outcome is reported through `onError`. */
export function useMobileStructuredRewind(args: {
  client: RpcClient | null
  sessionId: string | null
  enabled: boolean
  sessionKey: string
  stateRef: {
    readonly current: {
      fence: number | null
      epoch: string | null
      items: readonly AgentJournalRenderItem[]
    }
  }
  operationIds: Map<string, string>
  onError: (message: string) => void
}): (itemId: string) => Promise<boolean> {
  const { client, sessionId, enabled, sessionKey, stateRef, operationIds, onError } = args
  return useCallback(
    async (itemId: string) => {
      const { fence, epoch, items } = stateRef.current
      const outcome = await dispatchStructuredRewind({
        client,
        sessionId,
        enabled,
        sessionKey,
        itemId,
        state: { fence, epoch, items },
        operationIds
      })
      if (outcome.status !== 'accepted') {
        onError(outcome.message)
      }
      return outcome.status === 'accepted'
    },
    [client, enabled, onError, operationIds, sessionId, sessionKey, stateRef]
  )
}

/** Bubbles the reader sees go: the tapped message and every one after it. Null
 *  when the tapped message is not in the list, so the sheet says "later
 *  messages" instead of a number it made up. */
export function countMessagesDroppedByRewind(
  folded: readonly NativeChatMessage[],
  messageId: string
): number | null {
  const index = folded.findIndex((message) => message.id === messageId)
  if (index === -1) {
    return null
  }
  return folded
    .slice(index)
    .filter((message) => message.role === 'user' || message.role === 'assistant').length
}

export function rewindConfirmCopy(count: number | null): { title: string; message: string } {
  const drops =
    count === null
      ? 'Drops this message and the later messages from the conversation.'
      : count === 1
        ? 'Drops 1 message from the conversation.'
        : `Drops ${count} messages from the conversation.`
  return {
    title: 'Rewind to this message?',
    message: `${drops} Conversation only; files stay as they are. To restore files too, use /rewind in the terminal.`
  }
}
