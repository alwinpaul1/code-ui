import type { NativeChatMessage, NativeChatTextBlock } from '../../../src/shared/native-chat-types'
import { claudeTranscriptModelName } from './claude-transcript-model'

/**
 * A matched Claude tab's refusal cards, as the Claude app 1.261013.20 draws them (G10).
 *
 * The events (Claude Code 2.1.300's SDK schemas; never captured live):
 *  - `system` `model_refusal_fallback`: the model refused and the turn was retried on another.
 *    The app's reducer (t5v.java:1076-1086, s8u.m) needs `original_model` and `fallback_model`,
 *    both non-blank, and makes a `RefusalFallbackNotice` (fxr), drawn by np30.d: a row "Switched
 *    to <fallback>" with "Why?" (a chevron; "Hide" once open, np30.c), which opens the body
 *    "<original> has specific safety measures that … Switched to <fallback>. Learn more" (np30.b,
 *    `ccr_refusal_fallback_notice_*`), then "Details: [<category>]" (ny30.c, `error_details_category`),
 *    and an "Edit and retry" button when the refused prompt can be rewound to.
 *  - `system` `model_refusal_no_fallback`: no retry ran. Needs `original_model` (t5v.java:1087-
 *    1112), a `RefusalPausedNotice` (jxr) drawn by op30.e: "**Session paused**: <body>" (the body
 *    per category, its `_rewindable` wording when "Edit and retry" is offered, op30.o), the
 *    details line, and the button.
 *  - the category (`api_refusal_category`, trimmed): `cyber`, `bio`, `frontier_llm`, or any other
 *    string (cxr); frontier_llm and others take the generic words.
 *  - `refused_user_message_uuid`: the rewind target. The app's `M` (t5v.java:1838) finds the
 *    lead's user message by that uuid and joins its text blocks with "\n": that is the composer's
 *    prefill; no message, or no text, means no target and no button.
 *
 * A model name is the pill's name for the id (`F4.c` in the app). A subagent's refusal (one with
 * `parent_tool_use_id`) stays out of the lead's chat, as every subagent event does here.
 *
 * An assistant event that ended with `stop_reason: "refusal"` and an `error` is only FLAGGED by the
 * app (t5v.java:771, `isHardBlockRefusal`), which pairs it with the paused card (ped.java); its
 * words are drawn as any reply's, so nothing here changes it.
 */

export type CcrRefusalCard = {
  kind: 'fallback' | 'paused'
  originalModel: string
  fallbackModel: string | null
  category: string | null
  refusedUuid: string | null
  /** The refused prompt's words (the edit-and-retry prefill); null when it cannot be found. */
  promptText: string | null
}

/** The help article the switch card's "Learn more" opens (bdx.a(16)). */
export const CCR_REFUSAL_LEARN_MORE_URL = 'https://support.claude.com/articles/15363606'

export const CCR_REFUSAL_COPY = {
  why: 'Why?', // ccr_refusal_fallback_notice_why
  hide: 'Hide', // ccr_refusal_fallback_notice_hide
  learnMore: 'Learn more', // ccr_refusal_fallback_notice_learn_more
  editAndRetry: 'Edit and retry' // ccr_refusal_edit_and_retry
} as const

const PRESENTATION = 'ccr-refusal:'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function modelName(id: string): string {
  return claudeTranscriptModelName(id) ?? id
}

/** The card a `system` refusal event draws, as one system row; none for any other event. */
export function decodeCcrRefusal(payload: Record<string, unknown>, uuid: string, timestamp: number | null): NativeChatMessage[] {
  const kind = payload.subtype === 'model_refusal_fallback' ? 'fallback' : payload.subtype === 'model_refusal_no_fallback' ? 'paused' : null
  const originalModel = text(payload.original_model)
  const fallbackModel = kind === 'fallback' ? text(payload.fallback_model) : null
  if (!kind || !originalModel || (kind === 'fallback' && !fallbackModel) || text(payload.parent_tool_use_id)) {
    return []
  }
  const card: CcrRefusalCard = {
    kind,
    originalModel,
    fallbackModel,
    category: text(payload.api_refusal_category)?.trim() ?? null,
    refusedUuid: text(payload.refused_user_message_uuid),
    promptText: null
  }
  return [{ id: uuid, role: 'system', blocks: [refusalBlock(card)], timestamp, source: 'transcript' }]
}

function refusalBlock(card: CcrRefusalCard): NativeChatTextBlock {
  const { headline, body } = ccrRefusalWords(card, { rewindable: false })
  // The text is what a reader that does not know the card shows (a copy, a notification).
  return { type: 'text', text: card.kind === 'fallback' ? headline : `${headline}: ${body}`, presentation: `${PRESENTATION}${JSON.stringify(card)}` }
}

/** The card a row's block carries, or null for any other block. */
export function ccrRefusalCardOf(block: NativeChatTextBlock): CcrRefusalCard | null {
  if (!block.presentation?.startsWith(PRESENTATION)) {
    return null
  }
  try {
    const card = JSON.parse(block.presentation.slice(PRESENTATION.length)) as CcrRefusalCard
    return (card.kind === 'fallback' || card.kind === 'paused') && typeof card.originalModel === 'string' ? card : null
  } catch {
    return null
  }
}

/** Every refusal card's prefill, read from the refused prompt's own row (the app's `M`). Rows
 *  that carry no card come back as they were. */
export function withRefusalPrompts(rows: readonly NativeChatMessage[]): NativeChatMessage[] {
  let prompts: Map<string, string> | null = null
  return rows.map((row) => {
    const block = row.role === 'system' && row.blocks.length === 1 && row.blocks[0]!.type === 'text' ? row.blocks[0]! : null
    const card = block ? ccrRefusalCardOf(block) : null
    if (!card?.refusedUuid) {
      return row
    }
    prompts ??= promptTexts(rows)
    const promptText = prompts.get(card.refusedUuid) ?? null
    return promptText === null ? row : { ...row, blocks: [refusalBlock({ ...card, promptText })] }
  })
}

function promptTexts(rows: readonly NativeChatMessage[]): Map<string, string> {
  const found = new Map<string, string>()
  for (const row of rows) {
    if (row.role !== 'user') {
      continue
    }
    const joined = row.blocks.flatMap((block) => (block.type === 'text' && !block.presentation ? [block.text] : [])).join('\n')
    if (joined.trim().length > 0) {
      found.set(row.id, joined)
    }
  }
  return found
}

const FALLBACK_BODY: Record<'cyber' | 'bio' | 'generic', (original: string, fallback: string) => string> = {
  cyber: (o, f) => `${o} has specific safety measures that flag messages with cybersecurity topics. Switched to ${f}.`,
  bio: (o, f) => `${o} has specific safety measures that flag messages with biology topics. Switched to ${f}.`,
  generic: (o, f) => `${o} has specific safety measures that flagged something in this message. Switched to ${f}.`
}

const PAUSED_TOPIC: Record<'cyber' | 'bio' | 'generic', string> = {
  cyber: 'sensitive cybersecurity topics',
  bio: 'sensitive biology topics',
  generic: 'sensitive topics'
}

function categoryKey(category: string | null): 'cyber' | 'bio' | 'generic' {
  return category === 'cyber' ? 'cyber' : category === 'bio' ? 'bio' : 'generic'
}

/** The card's words. `rewindable`: "Edit and retry" is offered, which picks the paused body's
 *  `_rewindable` wording (op30.o). */
export function ccrRefusalWords(card: CcrRefusalCard, options: { rewindable: boolean }): { headline: string; body: string; details: string | null } {
  const original = modelName(card.originalModel)
  const key = categoryKey(card.category)
  const details = card.category ? `Details: [${card.category}]` : null
  if (card.kind === 'fallback') {
    const fallback = modelName(card.fallbackModel ?? '')
    return { headline: `Switched to ${fallback}`, body: FALLBACK_BODY[key](original, fallback), details }
  }
  const next = options.rewindable
    ? 'You can edit your prompt and try again, or switch to a different model.'
    : 'To continue, switch to a different model or continue by editing your prompt on web or desktop.'
  return { headline: 'Session paused', body: `${original}’s safety measures flagged this message for ${PAUSED_TOPIC[key]}. ${next}`, details }
}
