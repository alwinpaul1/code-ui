import { parseNativeChatCommandEnvelope } from '../../../src/shared/native-chat-command-envelope'
import { createPersistedMap } from './session-cache-persistence'
import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * What a Claude session itself said about its model and effort: the latest of
 * its own answers to `/model`, `/effort` and `/fast`, and the harness's notice
 * of a fallback, read from rows the transcript already holds (Orca's reader
 * publishes them).
 *
 * This is the SESSION'S OWN word, not the settings file's and not a guess:
 * Claude Code prints what it set, "for this session only" included, which no
 * settings file records. It sits below the live beacon and the on-screen
 * badge, which state the pair on every repaint. See
 * `docs/mobile-agent-hud.md` ("Model and effort without a beacon").
 *
 * Wordings were read from the Claude Code 2.1.289 binary (strings and template
 * literals, 2026-10-05); only `Set model to` and `Set effort level to` without
 * a backticked level were seen in rows captured from a live session (2.1.278).
 * Everything else is MODELLED, not captured:
 *  - `Set model to \`X\`` + (` and saved as your default for new sessions` |
 *    ` for this session only`) + optional ` with \`<level>\` effort` (the level
 *    is wrapped in backticks, `Jb` in the binary; an unwrapped one is read too)
 *  - `Kept model as \`X\``
 *  - `Current model: \`X\`` + optional ` (this session only)` + optional
 *    ` (effort: <level>)`, from a bare `/model`
 *  - `<mode> Fast mode ON · model set to \`X\``, when `/fast` promoted the model
 *  - `Set effort level to <level> (<where saved>): <description>`
 *  - `Effort '<asked>' exceeds the cap for <model> …; set to '<level>' instead`
 *  - `Current effort level: <level> (<description>)`
 *  - `Effort level: auto (currently <level>)`
 *  - `Effort level set to auto …`: the level is not stated, so effort is null
 *  - `CLAUDE_CODE_EFFORT_LEVEL=<level> overrides this session …`
 *  - `… Effort stays <level>.` (Ultracode)
 *  - `Switched to X due to high demand for Y` / `… because Y is not available`
 *    / `… because Y returned an error …`: the harness's own notice, no envelope
 *
 * A command's output counts only as the row right after its own envelope
 * (`<command-name>/model|effort|fast</command-name>`): a prompt that merely
 * quotes the wording is the user's word, not the CLI's.
 *
 * A model change resets the effort to what its own output states, or to null:
 * the effort belongs to the model before it, and carrying it over is how "Opus
 * Medium" came to be drawn on an Opus xhigh session (2026-09-15).
 *
 * Rows further back than the chat has loaded are read too, once per session,
 * by claude-transcript-effort-probe.ts (2026-10-11), and filed here with
 * `rememberProbedSessionCommandPair`: Claude Code's own words in the session's
 * own file count as the agent's word, by the user's decision that day.
 *
 * What it cannot see: a model change that writes no parsed row (the alt+p
 * picker, the effort-step keys, a resume into a new process), and an effort
 * that no command set (the settings default a session starts with, which
 * Claude Code 2.1.296 writes into no transcript record). The caller orders
 * the pair against the transcript scan with `at` and `answeredAt`
 * (`withSessionCommandPair`).
 */
export type SessionCommandPair = {
  /** The model the latest model command named, as Claude spells it. */
  label: string | null
  effort: string | null
  /** When the row that set this pair was written (the host's clock). */
  at: number | null
  /** When the first assistant row after it was written, or null while none has
   *  come: a reply the model change could already show in the transcript. */
  answeredAt: number | null
  /** The model id an effort-only command was read under (the scan's model at
   *  the time), so a later scan naming another model can drop it. */
  boundModel?: string | null
  /** When the row that last NAMED a model was written (the host's clock); an
   *  effort-only row after it keeps it. Null when no row in the pair named one.
   *  Lets a later effort-only row be told from a new model command
   *  (claude-screen-model-pair.ts: a toast stands under the former only). */
  modelAt?: number | null
  /** When the PHONE first saw this command's row (its own clock), set by
   *  `sessionCommandPairFor`. The host's row time is never compared with the
   *  phone's clock; this is what orders a command against a beacon.
   *  -Infinity: nothing was held when it was first seen, so it is never newer. */
  seenAt?: number
}

const LEVEL = '(low|medium|high|xhigh|max)'
const STDOUT = /^\s*<local-command-stdout>([\s\S]*?)<\/local-command-stdout>\s*$/
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g
const COMMANDS = new Set(['model', 'effort', 'fast'])

const SET_MODEL = /^Set model to `([^`]+)`/
const KEPT_MODEL = /^Kept model as `([^`]+)`/
const CURRENT_MODEL = /^Current model: (?:`([^`]+)`|([^\n(]+?))(?= \(|\n|$)/
const FAST_PROMOTED = /^.{0,4}?Fast mode ON · model set to `([^`]+)`/
const WITH_EFFORT = new RegExp(`\\bwith \`?${LEVEL}\`? effort\\b`)
const CURRENT_EFFORT = new RegExp(`\\(effort: ${LEVEL}\\)`)
const EFFORT_RULES: readonly RegExp[] = [
  new RegExp(`^Set effort level to ${LEVEL}\\b`),
  new RegExp(`^Effort '[^']*' exceeds the cap[^;]*; set to '${LEVEL}' instead`),
  new RegExp(`^Current effort level: ${LEVEL}\\b`),
  new RegExp(`^Effort level: auto \\(currently ${LEVEL}\\b`),
  new RegExp(`^CLAUDE_CODE_EFFORT_LEVEL=${LEVEL}\\b.*overrides this session`),
  new RegExp(`\\bEffort stays ${LEVEL}\\b`)
]
const EFFORT_AUTO = /^Effort level set to auto\b/
const FALLBACK = /^Switched to `?([^`\n]+?)`? (?:due to high demand for|because) /

function textOf(message: NativeChatMessage): string {
  return message.blocks.filter(isTextBlock).map((block) => block.text).join('')
}

/** True when `message` is the user's envelope for /model, /effort or /fast. */
function isModelCommandEnvelope(message: NativeChatMessage | undefined): boolean {
  if (!message || message.role !== 'user') {
    return false
  }
  const envelope = parseNativeChatCommandEnvelope(textOf(message))
  return envelope !== null && COMMANDS.has(envelope.name.replace(/^\//, ''))
}

type Change = { label: string | null; effort: string | null; keepEffortOf?: 'same-or-none' } | { effortOnly: string | null }

function readOutput(body: string, held: { label: string | null; effort: string | null } | null): Change | null {
  const kept = KEPT_MODEL.exec(body)?.[1]?.trim()
  if (kept) {
    // "Kept" changes nothing: the effort stands when it was this model's, or
    // was set before any model was named (an /effort-only row).
    const same = held !== null && (held.label === null || held.label === kept)
    return { label: kept, effort: same ? held.effort : null }
  }
  const set = SET_MODEL.exec(body)?.[1]?.trim()
  if (set) {
    return { label: set, effort: WITH_EFFORT.exec(body)?.[1] ?? null }
  }
  const current = CURRENT_MODEL.exec(body)
  const currentName = (current?.[1] ?? current?.[2])?.trim()
  if (currentName) {
    return { label: currentName, effort: CURRENT_EFFORT.exec(body)?.[1] ?? null }
  }
  const promoted = FAST_PROMOTED.exec(body)?.[1]?.trim()
  if (promoted) {
    return { label: promoted, effort: null }
  }
  const effort = EFFORT_RULES.map((rule) => rule.exec(body)?.[1]).find((level) => level !== undefined)
  if (effort) {
    return { effortOnly: effort }
  }
  return EFFORT_AUTO.test(body) ? { effortOnly: null } : null
}

export function sessionCommandPair(messages: readonly NativeChatMessage[]): SessionCommandPair | null {
  let pair = null as SessionCommandPair | null
  let pairIndex = -1
  messages.forEach((message, index) => {
    let change: Change | null = null
    if (message.role === 'user' || message.role === 'system') {
      const body = STDOUT.exec(textOf(message))?.[1]?.replace(ANSI, '').trim()
      if (body && isModelCommandEnvelope(messages[index - 1])) {
        change = readOutput(body, pair)
      }
    }
    if (change === null && message.role === 'system') {
      // The harness's own notice of a fallback: a `system` row only. Assistant
      // text that happens to open with "Switched to X because" is the model's
      // prose, never the harness's (review N1, 2026-10-05).
      const fallback = FALLBACK.exec(textOf(message).replace(ANSI, '').trim())?.[1]?.trim()
      change = fallback ? { label: fallback, effort: null } : null
    }
    if (change === null) {
      return
    }
    pairIndex = index
    pair =
      'effortOnly' in change
        ? { label: pair?.label ?? null, effort: change.effortOnly, at: message.timestamp, answeredAt: null, modelAt: pair?.modelAt ?? null }
        : { label: change.label, effort: change.effort, at: message.timestamp, answeredAt: null, modelAt: message.timestamp }
  })
  if (pair === null) {
    return null
  }
  const answer = messages.slice(pairIndex + 1).find((message) => message.role === 'assistant')
  return { ...(pair as SessionCommandPair), answeredAt: answer?.timestamp ?? null }
}

const lastPairBySession = createPersistedMap<SessionCommandPair>({
  storageKey: 'codeui:chat-model-command-pairs',
  maxEntries: 32
})

/** Read at app start with the other session caches; never rejects. */
export function hydrateSessionCommandPairs(): Promise<void> {
  return lastPairBySession.hydrate()
}

/**
 * File a pair read from rows OLDER than the chat's window (the transcript
 * probe, claude-transcript-effort-probe.ts) as if it had been seen there.
 * Nothing is replaced that is as new or newer, by the host's row time. It is
 * marked never seen after a beacon (`seenAt` -Infinity): a row dug out of the
 * past cannot outrank a live beacon. Returns whether it was filed.
 */
export function rememberProbedSessionCommandPair(
  sessionId: string,
  pair: SessionCommandPair,
  boundModel: string | null
): boolean {
  const held = lastPairBySession.get(sessionId)
  if (held && held.at !== null && (pair.at === null || held.at >= pair.at)) {
    return false
  }
  lastPairBySession.set(sessionId, {
    ...pair,
    ...(pair.label === null ? { boundModel } : {}),
    seenAt: Number.NEGATIVE_INFINITY
  })
  return true
}

/** Test-only: a fresh process, with storage left as it is. */
export function resetSessionCommandPairCacheForTests(): void {
  lastPairBySession.reset()
}

/**
 * `sessionCommandPair` over the loaded rows, with the last pair read for that
 * session kept in memory. The chat loads about 40 rows and a reconnect
 * replaces them, so a `/model` typed further back would otherwise vanish and
 * the pill with it. Kept across a relaunch too, as the other session caches are
 * (session-cache-persistence.ts: one blob, fail-open both ways), so a session
 * left for another project or a killed app shows its last pair on return until
 * a newer source replaces it. A missing cache costs a pill, never a wrong one.
 */
export function sessionCommandPairFor(
  sessionId: string | null,
  messages: readonly NativeChatMessage[],
  scanModelId: string | null = null
): SessionCommandPair | null {
  let fresh = sessionCommandPair(messages)
  if (fresh !== null && fresh.label === null) {
    // An effort-only command is bound to the model the scan read when it was
    // first seen, and keeps that binding while it stays in the rows.
    const held = sessionId === null ? undefined : lastPairBySession.get(sessionId)
    fresh = { ...fresh, boundModel: held && held.at === fresh.at ? held.boundModel : scanModelId }
  }
  if (sessionId === null) {
    return fresh
  }
  const held = lastPairBySession.get(sessionId)
  let pair = fresh
  if (pair !== null) {
    // A command is "newer than the beacon" only when the phone SAW it appear:
    // it was held before, and this one differs. With nothing held (first view
    // on this device, evicted, a failed hydrate) its first sighting says
    // nothing about when it was written, so it can never outrank a beacon: a
    // late pair is acceptable, a wrong one is not (review R1, 2026-10-05). A
    // stored `seenAt` of -Infinity comes back from JSON as null, and a record
    // from before the field has none; both stay "never".
    const sameAsHeld = held !== undefined && held.at === pair.at && held.label === pair.label && held.effort === pair.effort
    const heldSeen = typeof held?.seenAt === 'number' ? held.seenAt : Number.NEGATIVE_INFINITY
    pair = { ...pair, seenAt: held === undefined ? Number.NEGATIVE_INFINITY : sameAsHeld ? heldSeen : Date.now() }
  }
  if (pair !== null && held && held.at !== null && pair.at !== null && held.at > pair.at) {
    // Rows older than the pair already kept (a cached page shown first).
    pair = held
  }
  if (pair === null && held) {
    // The command is no longer in the rows; later rows may still tell when it
    // was answered.
    const answer =
      held.answeredAt === null && held.at !== null
        ? messages.find(
            (message) => message.role === 'assistant' && message.timestamp !== null && message.timestamp > held.at!
          )
        : undefined
    pair = answer?.timestamp != null ? { ...held, answeredAt: answer.timestamp } : held
  }
  if (pair !== null && JSON.stringify(pair) !== JSON.stringify(held)) {
    lastPairBySession.set(sessionId, pair)
  }
  return pair
}
