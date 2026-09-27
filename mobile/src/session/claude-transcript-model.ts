import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'

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
 * of their own, listed as separate rows with `subagent` set, so the parent's
 * row is the main chain. The clean fix is upstream: see
 * docs/mobile-model-from-transcript.md.
 */
export type TranscriptModel = {
  /** The id the record carries, e.g. `claude-opus-5-5`. */
  model: string
  /** What the pill says: "Opus 5.5", or the id itself when it names no
   *  family this knows. */
  label: string
}

/** A reading with the phone's own time of the scan that produced it. */
export type ScannedTranscriptModel = TranscriptModel & { scannedAt: number }

/** A model with its display name and effort, as both pills read it. */
export type ModelPillPair = { model: string | null; label: string | null; effort: string | null }

/** The model the pills fall back to when the agent itself says nothing. */
export type ClaudeModelFallback =
  | { kind: 'none' }
  | { kind: 'transcript'; model: TranscriptModel }
  /** The phone changed the model, and no scan yet covers a turn begun after it. */
  | { kind: 'pick'; model: string }

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
 * not a subagent transcript (which shares the parent's id) and not another
 * agent's. The rows stay `unknown` until read here, as the history screen's
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
 * A model the phone itself just picked stands until the host has been scanned
 * after the first turn that STARTED after the pick had ended (`settledAt`, the
 * phone's clock, as `scannedAt` is). Claude Code applies a `/model` sent
 * mid-turn only when that turn ends, so a reply written after the pick can
 * still be the old model's; only a turn begun after it says what the switch
 * did. Once such a scan exists, what it says is what answered, whether or not
 * the switch took — a refused switch does not leave the pill on the pick.
 */
export function resolveClaudeModelFallback(input: {
  liveModel: string | null
  transcript: ScannedTranscriptModel | null
  pick: { model: string; settledAt: number | null } | null
}): ClaudeModelFallback {
  const { liveModel, transcript, pick } = input
  if (liveModel) {
    return { kind: 'none' }
  }
  const answeredSincePick =
    transcript !== null && pick?.settledAt != null && transcript.scannedAt >= pick.settledAt
  if (pick && !answeredSincePick) {
    return { kind: 'pick', model: pick.model }
  }
  return transcript
    ? { kind: 'transcript', model: { model: transcript.model, label: transcript.label } }
    : { kind: 'none' }
}

function choiceLabel(
  snapshot: readonly SessionOptionDescriptor[] | undefined,
  value: string
): string | null {
  const model = snapshot?.find((descriptor) => descriptor.category === 'model')
  if (model?.kind.type !== 'select') {
    return null
  }
  return model.kind.choices.find((choice) => choice.value === value)?.label ?? null
}

/**
 * The pair the header pill reads: the live pair when there is one, else the
 * fallback. No effort ever comes with a fallback — the transcript does not
 * record one, and a pick's effort is the tracked record's, which the header
 * does not read (session-model-pill.ts).
 */
export function claudeModelPillPair(
  live: ModelPillPair,
  fallback: ClaudeModelFallback,
  snapshot?: readonly SessionOptionDescriptor[]
): ModelPillPair {
  if (live.model) {
    return live
  }
  switch (fallback.kind) {
    case 'transcript':
      return { model: fallback.model.model, label: fallback.model.label, effort: null }
    case 'pick':
      return {
        model: fallback.model,
        label:
          choiceLabel(snapshot, fallback.model) ??
          claudeTranscriptModelName(fallback.model) ??
          fallback.model,
        effort: null
      }
    case 'none':
      return live
    default: {
      const unhandled: never = fallback
      return unhandled
    }
  }
}
