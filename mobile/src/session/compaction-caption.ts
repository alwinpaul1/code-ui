// The caption of the Claude app's compaction divider (com.anthropic.claude 1.261009.20).
//
//  - Which words: `t330.h` (t330.java:477-500) over `alt.b` (alt.java:18-23), from the
//    `CompactionDivider` event's `pre_tokens` and `post_tokens` (k23.java:1245-1255):
//      pre over post         -> "Compacted conversation · saved <pre - post> token(s)"
//      pre at or under post, pre over zero -> "Compacted conversation · from <pre> token(s)"
//      anything else         -> "Compacted conversation"
//    A pre figure with no post figure drops the pair (k23.java:1247-1252), so it is the plain words.
//  - The plurals are `ccr_context_compacted_saved_tokens` and `_from_tokens` (res plurals.xml:91-98);
//    English "one" is exactly 1.
//  - The number is `q330.i(n, false)` (q330.java:1761-1779): under 1,000 the plain integer; from
//    there `r(n / 1000)` with a "k", `r(n / 1e6)` with an "M" when the thousands reach 1000, and the
//    same step up to "B". `r` is one decimal, HALF_UP (q330.java:2074), and nothing is trimmed, so
//    1,000 reads "1.0k". `Number.prototype.toFixed` rounds the exact binary value half up, as
//    `new BigDecimal(double).setScale(1, HALF_UP)` does.
//  - A count outside 0..2147483647 is logged and dropped (k23.java:26-29).

export const COMPACTION_CAPTION = 'Compacted conversation'

export type CompactionTokens = { preTokens?: number | null; postTokens?: number | null }

const MAX_COUNT = 2147483647

function oneDecimal(value: number): string {
  return value.toFixed(1)
}

/** `q330.i(n, false)`. */
export function compactionTokenCount(count: number): string {
  if (count >= 1_000_000_000) {
    return `${oneDecimal(count / 1e9)}B`
  }
  if (count >= 1_000_000) {
    const millions = oneDecimal(count / 1e6)
    return Number(millions) >= 1000 ? `${oneDecimal(count / 1e9)}B` : `${millions}M`
  }
  if (count < 1000) {
    return String(count)
  }
  const thousands = oneDecimal(count / 1000)
  return Number(thousands) >= 1000 ? `${oneDecimal(count / 1e6)}M` : `${thousands}k`
}

function tokens(count: number, many: string, one: string): string {
  return count === 1 ? one : many
}

/** The divider's words for the counts the event carried. */
export function compactionCaption({ preTokens, postTokens }: CompactionTokens): string {
  if (preTokens == null || postTokens == null) {
    return COMPACTION_CAPTION
  }
  if (preTokens > postTokens) {
    const saved = preTokens - postTokens
    return `${COMPACTION_CAPTION} · saved ${compactionTokenCount(saved)} ${tokens(saved, 'tokens', 'token')}`
  }
  if (preTokens > 0) {
    return `${COMPACTION_CAPTION} · from ${compactionTokenCount(preTokens)} ${tokens(preTokens, 'tokens', 'token')}`
  }
  return COMPACTION_CAPTION
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined
}

/** The counts of a `compact_boundary` event's metadata: `pre_tokens` / `post_tokens` as the stream
 *  carries them, `preTokens` / `postTokens` as the transcript record writes them. A figure that is
 *  not a whole count in range is left out. */
export function readCompactionTokens(metadata: unknown): CompactionTokens {
  if (typeof metadata !== 'object' || metadata === null) {
    return {}
  }
  const record = metadata as Record<string, unknown>
  const pre = count(record.pre_tokens) ?? count(record.preTokens)
  const post = count(record.post_tokens) ?? count(record.postTokens)
  return {
    ...(pre === undefined ? {} : { preTokens: pre }),
    ...(post === undefined ? {} : { postTokens: post })
  }
}

const CAPTION_PATTERN = /^Compacted conversation(?: · (?:saved|from) \d+(?:\.\d)?[kMB]? tokens?)?$/

/** The caption a compaction block may carry, or the plain words: the decoder writes the whole
 *  caption into the block, and a notice from another source with its own prose is never drawn in
 *  place of it. */
export function compactionCaptionOf(blockText: string): string {
  const text = blockText.trim()
  return CAPTION_PATTERN.test(text) ? text : COMPACTION_CAPTION
}
