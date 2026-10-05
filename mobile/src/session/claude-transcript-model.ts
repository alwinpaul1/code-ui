/**
 * The model a Claude session last answered with, as Claude Code's own
 * transcript recorded it, for a session that states no model any other way.
 *
 * A Windows host gets no beacon flag (`hostTakesAgentHudFlag`), and a user with
 * no status line of their own paints no badge, so the pills had nothing to
 * say: the header showed nothing and the composer read "Model" (reported
 * 2026-09-27). Every assistant record in the transcript carries the model that
 * wrote it (`message.model`), which is the agent's own record, not a guess
 * from a name.
 *
 * The phone cannot read that record where it reads the chat: Orca's transcript
 * decoder drops `message.model` before the message reaches `nativeChat.*`
 * (transcript-line-decoders-claude.ts, origin/main 8d6fec597b), and Orca's
 * Claude hooks never set `agentStatus.model`. Orca's session scan keeps it:
 * `aiVault.listSessions` answers each session's `model` as the `message.model`
 * of the LAST assistant record in that session's own file
 * (session-scanner-primary-parsers.ts:159-168). Subagent transcripts are files
 * of their own, which that list does not include (Orca lists them on demand,
 * `listAiVaultSubagentSessionsInBackground`), so the session's row reads its
 * main file. The clean fix is upstream: see docs/mobile-model-from-transcript.md.
 */
import type { SessionCommandPair } from './claude-session-command-pair'
export type TranscriptModel = {
  /** The id the record carries, e.g. `claude-opus-5-5`. */
  model: string
  /** What the pill says: "Opus 5.5", or the id itself when it names no
   *  family this knows. */
  label: string
}

/** A reading, with how recent a transcript it speaks for (the phone's clock):
 *  claude-transcript-model-scan.ts says why that is not simply when it was
 *  asked for. */
export type ScannedTranscriptModel = TranscriptModel & { freshAsOf: number }

/** A model with its display name and effort, as both pills read it. */
export type ModelPillPair = { model: string | null; label: string | null; effort: string | null }

/** The model the pills fall back to when the agent itself says nothing. */
export type ClaudeModelFallback =
  | { kind: 'none' }
  | {
      kind: 'transcript'
      model: TranscriptModel
      /** The effort the session itself stated through `/model` or `/effort`
       *  (claude-session-command-pair.ts); absent: nobody has said. The
       *  transcript's own reading records none. */
      effort?: string | null
      /** How recent a transcript the model was read from (the phone's clock). */
      freshAsOf?: number
    }

// Claude Code's ids put the family first (`claude-opus-5-5`, with a date or a
// region around it on some routes); the 3.x line put the version first
// (`claude-3-5-haiku-20241022`). A one- or two-digit minor that is not the
// start of a date; a `-0` minor is how "Opus 4" is spelled.
const FAMILY_FIRST = /claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/i
const VERSION_FIRST = /claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)/i
const CLAUDE_ID = /claude-[a-z0-9]/i

function familyName(family: string, major: string, minor: string | undefined): string {
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}`
  return minor && minor !== '0' ? `${name}.${minor}` : name
}

/**
 * The pill's name for a Claude model id, or null for an id that is not a
 * Claude model at all — Claude Code's `<synthetic>` (the model it records on
 * a reply it wrote itself, such as an API error), an empty string, another
 * vendor's id.
 *
 * A Claude id whose family this does not know is shown as the id itself
 * rather than hidden: it is still the agent's own record of what answered,
 * and a model released after this table would otherwise leave the pill blank
 * for exactly the sessions that use it.
 */
export function claudeTranscriptModelName(id: string): string | null {
  const trimmed = id.trim()
  if (!CLAUDE_ID.test(trimmed)) {
    return null
  }
  const familyFirst = FAMILY_FIRST.exec(trimmed)
  if (familyFirst) {
    return familyName(familyFirst[1]!, familyFirst[2]!, familyFirst[3])
  }
  const versionFirst = VERSION_FIRST.exec(trimmed)
  if (versionFirst) {
    return familyName(versionFirst[3]!, versionFirst[1]!, versionFirst[2])
  }
  return trimmed
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/**
 * This session's reading from a host session list, or null.
 *
 * Only the row for exactly this session id: never the newest session in the
 * folder, which would state a model this tab never ran. Only Claude's own row,
 * not another agent's, and never a subagent transcript's row (which shares the
 * parent's id); `listSessions` does not list those today, and one that ever
 * reaches this list is skipped all the same. The rows stay `unknown` until read here, as the history screen's
 * reader leaves them (agent-history-reply-schema.ts); one that cannot be read
 * is skipped rather than failing the list.
 */
export function transcriptModelForSession(
  rows: readonly unknown[],
  sessionId: string
): TranscriptModel | null {
  for (const entry of rows) {
    const row = record(entry)
    if (row?.agent !== 'claude' || row.sessionId !== sessionId || row.subagent) {
      continue
    }
    const model = typeof row.model === 'string' ? row.model.trim() : ''
    const label = claudeTranscriptModelName(model)
    return label === null ? null : { model, label }
  }
  return null
}

/**
 * Which model the pills state when there is no live pair.
 *
 * The live pair — the beacon, or the badge on the user's own status line —
 * always wins; this is only what stands in for it.
 *
 * After a model pick of the phone's own the answer is nothing, until the host
 * has been scanned after the first turn that STARTED after the pick had ended
 * (`settledAt`, the phone's clock, as `freshAsOf` is). Not the pick: a picked
 * record is not the agent's word, and showing one is how "Fable Medium" came to
 * be drawn on an Opus session (2026-09-18). Not the transcript's earlier
 * reading either, which the switch may have replaced. And not a reply that
 * merely came after the pick: Claude Code applies a `/model` sent mid-turn only
 * when that turn ends, so the rest of that turn is still the old model. Once a
 * turn begun after the pick has been scanned, what it says is what answered,
 * whether or not the switch took.
 */
export function resolveClaudeModelFallback(input: {
  liveModel: string | null
  transcript: ScannedTranscriptModel | null
  /** The phone's own last pick in this chat, if any. */
  pick: { settledAt: number | null } | null
}): ClaudeModelFallback {
  const { liveModel, transcript, pick } = input
  if (liveModel || !transcript) {
    return { kind: 'none' }
  }
  if (pick && (pick.settledAt === null || transcript.freshAsOf < pick.settledAt)) {
    return { kind: 'none' }
  }
  return {
    kind: 'transcript',
    model: { model: transcript.model, label: transcript.label },
    freshAsOf: transcript.freshAsOf
  }
}

/**
 * The pair the header pill reads: the live pair when there is one, else the
 * transcript's reading. No effort ever comes with the transcript's reading,
 * which records none.
 */
export function claudeModelPillPair(
  live: ModelPillPair,
  fallback: ClaudeModelFallback
): ModelPillPair {
  if (live.model || fallback.kind === 'none') {
    return live
  }
  return { model: fallback.model.model, label: fallback.model.label, effort: fallback.effort ?? null }
}

/**
 * The fallback with what the session itself said through `/model`, `/effort`,
 * `/fast` and the harness's fallback notice laid over it. Used only when there
 * is no live pair: the beacon and the badge are applied by the caller first and
 * always win.
 *
 * - A model command names the model: its own word beats a scan that predates
 *   it. The effort is the one its output stated, or null; never the effort of
 *   the model before it.
 * - An effort-only command belongs to the model it was read under
 *   (`boundModel`), else to the model the scan reads.
 * - SUPERSEDED: a model can change with no row the phone parses (the alt+p
 *   picker, the effort-step keys, a resume into a new process). When a reply
 *   came after the command (`answeredAt`), the scan was taken after that reply
 *   (`freshAsOf`) and it names another model, the scan is newer and the command
 *   is dropped, effort included. Without a reply after it, nothing could have
 *   changed the model and the command stands. Row times are the host's clock and
 *   `freshAsOf` the phone's, the same skew `resolveClaudeModelFallback` accepts.
 * - A label this cannot map to an id (`Opus 4.8.5`) is not guessed at.
 */
export function withSessionCommandPair(
  fallback: ClaudeModelFallback,
  command: SessionCommandPair | null
): ClaudeModelFallback {
  if (!command) {
    return fallback
  }
  const commandId = command.label === null ? (command.boundModel ?? null) : claudeIdFromLabel(command.label)
  if (command.label !== null && commandId === null) {
    return fallback
  }
  if (
    fallback.kind === 'transcript' &&
    commandId !== null &&
    modelsDiffer(fallback.model.model, commandId) &&
    command.answeredAt !== null &&
    fallback.freshAsOf !== undefined &&
    command.answeredAt <= fallback.freshAsOf
  ) {
    return fallback
  }
  if (command.label !== null && commandId !== null) {
    return {
      kind: 'transcript',
      model: { model: commandId, label: claudeTranscriptModelName(commandId) ?? command.label },
      effort: command.effort
    }
  }
  if (fallback.kind === 'transcript') {
    return { ...fallback, effort: command.effort }
  }
  return fallback
}

function modelsDiffer(a: string, b: string): boolean {
  return (claudeTranscriptModelName(a) ?? a) !== (claudeTranscriptModelName(b) ?? b)
}

/** `Opus 5.5` back to `claude-opus-5-5`, the id the host lists; a Claude id is
 *  its own. A trailing note the CLI adds (`(1M context)`, `(default)`) is not
 *  part of the model. Null for anything else. */
export function claudeIdFromLabel(label: string): string | null {
  const bare = label.trim().replace(/\s*\([^)]*\)\s*$/, '')
  if (/^claude-[a-z0-9]/i.test(bare)) {
    return bare.replace(/\[.*\]$/, '')
  }
  const match = /^(fable|mythos|opus|sonnet|haiku) (\d+)(?:\.(\d{1,2}))?$/i.exec(bare)
  return match ? `claude-${match[1]!.toLowerCase()}-${match[2]}${match[3] === undefined ? '' : `-${match[3]}`}` : null
}
