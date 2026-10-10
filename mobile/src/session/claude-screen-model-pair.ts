import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { SessionCommandPair } from './claude-session-command-pair'
import type { ClaudeScreenModelStatement } from './claude-screen-model-statement'
import type { StartupFramePair } from './claude-startup-frame-pair'
import { modelsDiffer, type ClaudeModelFallback, type ScannedTranscriptModel } from './claude-transcript-model'
import { createPersistedMap } from './session-cache-persistence'

/**
 * What a Claude session last said about its model and effort ON SCREEN
 * (claude-screen-model-statement.ts reads the rows), kept per session id.
 *
 * Both statements come and go: a toast is up for about two seconds and a
 * spinner only while the model works, so the last of each is kept here and
 * persisted with the other session caches (one blob, fail-open both ways). A
 * missing record costs a pill, never a wrong one.
 *
 * ORDER. These are the newest statements the phone can see without a beacon,
 * so they lie over the startup frame, the transcript scan and the session's own
 * `/model` and `/effort` rows (tiers 3 to 5 in docs/mobile-agent-hud.md, "Model
 * and effort without a beacon"), each by when it was said:
 *
 * - Against a command row: each statement carries the key of the command pair
 *   the phone held when it was seen (`commandKey`). A command the phone did not
 *   hold then is newer, and wins. The key is compared, not the clocks: a row's
 *   time is the host's and a sighting is the phone's. One exception: a toast
 *   stands under a newer row that names no model (`/effort`), which takes the
 *   effort and leaves the toast's model; a row that names one (`modelAt`
 *   moved) replaces it.
 * - A statement is dated when a screen read SHOWS it, never when the pills'
 *   context changes: a `/effort` row that reaches the phone before the next
 *   poll must not re-date the spinner still on the last read (the caller notes
 *   each read once).
 * - A screen with no input box (a dialog, a picker) says nothing about the
 *   spinner, so it does not end the wait for the old turn after a toast.
 * - Against the startup frame: a frame read later (`readAt`, the phone's clock,
 *   like `seenAt`) is newer and wins: a new process painted it.
 * - Against the scan: a toast stands until a reply written after it (a row
 *   newer than the last reply the phone held when it saw the toast) is in the
 *   rows, and the scan was taken after that reply, and names another model:
 *   the same superseded rule as a `/model` row (`withSessionCommandPair`).
 *
 * A live beacon or badge is above all of it: these apply only where no live
 * pair speaks (the caller's `quiet`).
 *
 * The effort belongs to a model: it is kept with the model the pills showed
 * when it was read (`model`), and is dropped whenever the pair shows another.
 * A toast clears it: `Model set to` names no effort, and the effort before it
 * was the old model's (the "Opus Medium" rule, claude-session-command-pair.ts).
 * After a toast, an effort is taken only once a screen with no spinner has been
 * seen: a spinner still up from before the switch is the old model's request.
 */
export type ScreenModelRecord = {
  toast: {
    model: string
    label: string
    /** When the phone first saw it (its own clock). */
    seenAt: number
    commandKey: string | null
    /** The command pair's `modelAt` when it was seen (null: none named one). */
    commandModelAt: number | null
    /** The newest assistant row's time (the host's clock) the phone held when it
     *  saw the toast; null when it held none. */
    replyAt: number | null
  } | null
  effort: {
    effort: string
    /** The model id the pills showed when it was read; null when none. */
    model: string | null
    seenAt: number
    commandKey: string | null
  } | null
  /** A toast was seen and no screen without a spinner has been seen since. */
  awaitingTurnEnd: boolean
}

const records = createPersistedMap<ScreenModelRecord>({
  storageKey: 'codeui:chat-screen-model-statements',
  maxEntries: 32
})
const listeners = new Set<() => void>()
/** Per session, whether the last screen read showed a toast: a toast is up for
 *  several polls, and only its first sighting is a switch. Memory only. */
const toastShown = new Map<string, boolean>()

/** Read at app start with the other session caches; never rejects. */
export function hydrateScreenModelRecords(): Promise<void> {
  return records.hydrate().then(() => listeners.forEach((listener) => listener()))
}

/** Test-only: a fresh process, with storage left as it is. */
export function resetScreenModelRecordsForTests(): void {
  records.reset()
  listeners.clear()
  toastShown.clear()
}

export function peekScreenModelRecord(sessionId: string | null): ScreenModelRecord | null {
  return sessionId === null ? null : (records.get(sessionId) ?? null)
}

export function subscribeScreenModelRecords(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The command pair as a key, null when there is none. A pair read from rows
 *  older than the chat's window (`probed`) keys as none too: it was written
 *  before anything on screen, so a statement noted before it was filed still
 *  stands over it (review of 1bd638852, 2026-10-11). */
export function sessionCommandPairKey(command: SessionCommandPair | null): string | null {
  return command === null || command.probed === true ? null : JSON.stringify([command.at, command.label, command.effort])
}

/** The newest assistant row's time in `messages` (the host's clock), or null. */
export function lastReplyAt(messages: readonly NativeChatMessage[] | undefined): number | null {
  let latest: number | null = null
  for (const message of messages ?? []) {
    if (message.role === 'assistant' && message.timestamp != null && (latest === null || message.timestamp > latest)) {
      latest = message.timestamp
    }
  }
  return latest
}

/**
 * Keep what one screen read of this session said. `context` is what the phone
 * held at that moment: the command pair's key, the model the pills showed, and
 * the newest reply.
 */
export function noteScreenModelStatement(
  sessionId: string | null,
  statement: ClaudeScreenModelStatement | null,
  context: { commandKey: string | null; commandModelAt: number | null; model: string | null; replyAt: number | null },
  now: number = Date.now()
): void {
  if (sessionId === null || statement === null) {
    return
  }
  const held = records.get(sessionId) ?? { toast: null, effort: null, awaitingTurnEnd: false }
  let next = held
  const shownBefore = toastShown.get(sessionId) === true
  toastShown.set(sessionId, statement.toast !== null)
  if (statement.toast !== null && !shownBefore) {
    next = {
      toast: {
        ...statement.toast,
        seenAt: now,
        commandKey: context.commandKey,
        commandModelAt: context.commandModelAt,
        replyAt: context.replyAt
      },
      effort: null,
      awaitingTurnEnd: true
    }
  }
  if (statement.composer && !statement.spinner && next.awaitingTurnEnd) {
    next = { ...next, awaitingTurnEnd: false }
  }
  if (statement.effort !== null && statement.toast === null && !next.awaitingTurnEnd) {
    const effort = next.effort
    if (effort === null || effort.effort !== statement.effort || effort.model !== context.model || effort.commandKey !== context.commandKey) {
      next = { ...next, effort: { effort: statement.effort, model: context.model, seenAt: now, commandKey: context.commandKey } }
    }
  }
  if (next !== held) {
    records.set(sessionId, next)
    listeners.forEach((listener) => listener())
  }
}

/**
 * The fallback with what the screen said laid over it (the order is in the
 * record's comment). `fallback` already carries the frame, the scan and the
 * command rows; `context` is what the phone holds now.
 */
export function withScreenModelStatements(
  fallback: ClaudeModelFallback,
  record: ScreenModelRecord | null,
  context: {
    command: SessionCommandPair | null
    frame: StartupFramePair | null
    transcript: ScannedTranscriptModel | null
    messages: readonly NativeChatMessage[] | undefined
  }
): ClaudeModelFallback {
  if (record === null) {
    return fallback
  }
  const { command } = context
  const commandKey = sessionCommandPairKey(command)
  const frameAt = context.frame?.readAt ?? null
  const afterFrame = (statement: { seenAt: number }) => frameAt === null || frameAt <= statement.seenAt
  const stands = (statement: { seenAt: number; commandKey: string | null }) =>
    statement.commandKey === commandKey && afterFrame(statement)
  let result = fallback
  let toastAt: number | null = null
  const toast = record.toast
  // A newer command that names no model: the toast's model stands, the row's effort with it.
  const effortRowSince =
    toast !== null && command !== null && toast.commandKey !== commandKey && (command.modelAt ?? null) === (toast.commandModelAt ?? null)
  if (toast !== null && (stands(toast) || (effortRowSince && afterFrame(toast))) && !toastSuperseded(toast, context.transcript, context.messages)) {
    result = { kind: 'transcript', model: { model: toast.model, label: toast.label }, effort: effortRowSince ? command.effort : null }
    toastAt = toast.seenAt
  }
  const effort = record.effort
  if (
    effort !== null &&
    effort.model !== null &&
    result.kind === 'transcript' &&
    stands(effort) &&
    (toastAt === null || toastAt <= effort.seenAt) &&
    !modelsDiffer(effort.model, result.model.model)
  ) {
    result = { ...result, effort: effort.effort }
  }
  return result
}

function toastSuperseded(
  toast: NonNullable<ScreenModelRecord['toast']>,
  transcript: ScannedTranscriptModel | null,
  messages: readonly NativeChatMessage[] | undefined
): boolean {
  if (transcript === null || !modelsDiffer(transcript.model, toast.model)) {
    return false
  }
  const answer = (messages ?? []).find(
    (message) =>
      message.role === 'assistant' && message.timestamp != null && (toast.replyAt === null || message.timestamp > toast.replyAt)
  )
  return answer?.timestamp != null && answer.timestamp <= transcript.freshAsOf
}
