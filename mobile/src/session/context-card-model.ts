import type { ClaudeContextReport, ContextCategory, ContextDetailSection } from './claude-context-report'

/**
 * The Claude app's context card, as a model (com.anthropic.claude 1.261009.20): `ja20.g` builds it
 * from the session's `get_context_usage` (`y6a`: window, used, model, categories, MCP tools, memory
 * files, custom agents), `ja20.p` turns it into the segmented bar and `ja20.q` into the legend.
 * Here it is built from a `/context` table read off the screen (claude-context-report.ts).
 *
 *  - The bar is up to six named segments, largest category first. When the used rows (plus the
 *    autocompact buffer, if any) are more than six, the first five minus the buffer are named and the
 *    rest share one "other" segment. Deferred rows are never in the bar. A segment under half a
 *    percent of the bar (`q330.q`) is not drawn.
 *  - The bar's whole is the larger of the window and the sum of the rows drawn in it.
 *  - Each legend row is a name, a token figure (`q330.i`, one decimal, trailing zeros dropped) and a
 *    percent. The app computes the percent as tokens over the window to one decimal; Claude Code
 *    prints its own, which is what is shown when it printed one: it is the agent's word.
 *  - The comparator that orders the used rows (`y99`) did not decompile. The app's own sample data
 *    (`s5a`) lists them largest first, and that is the order used.
 *  - Colour slots 1 to 6 are the named segments in order, 7 is "other", 8 is the buffer and every
 *    deferred row, 9 is the free-space track (`l800.g`, `ja20.n`).
 *  - Only MCP tools, memory files and custom agents expand (`ja20.q`'s `r("mcp" | "memory" |
 *    "agents")`). Claude Code's Skills section is not part of the app's card and is left out.
 */

export type ContextColorSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type ContextBarSegment = { slot: ContextColorSlot; fraction: number }

export type ContextLegendRow = {
  name: string
  tokensLabel: string
  percentLabel: string
  slot: ContextColorSlot
}

export type ContextCardSection = {
  key: 'mcp' | 'memory' | 'agents'
  title: string
  /** The section's tokens, as printed in its summary or else the rows' sum; null when neither is known. */
  totalLabel: string | null
  /** Claude Code's own one-line summary ("147 tools · 631 tokens"), when it printed one. */
  summary: string | null
  rows: { name: string; tokensLabel: string | null }[]
}

export type ContextCard = {
  /** The figure beside the bar, 0 to 100 (`ja20.g`: min(100, round(used / window))). */
  displayPercent: number
  segments: ContextBarSegment[]
  legend: ContextLegendRow[]
  sections: ContextCardSection[]
  /** "32.8k of 1M tokens · Haiku 5.5" (`usage_context_window_tokens_caption`, then the model). */
  caption: string
  /** The bar's spoken form (`ccr_context_bar_usage_description`). */
  a11y: string
}

/** `q330.i(tokens, true)`: under 1,000 as is; else thousands, or millions from 1,000k, to one decimal
 *  with trailing zeros dropped. */
export function formatTokens(tokens: number): string {
  // `toFixed` rounds the double's exact value and takes the larger of two equal neighbours, which is
  // `BigDecimal(double).setScale(1, HALF_UP)` for a positive figure; Number() then drops "1.0"'s zero.
  const oneDecimal = (value: number): string => String(Number(value.toFixed(1)))
  if (tokens < 1000) {
    return String(tokens)
  }
  if (tokens >= 1_000_000_000) {
    return `${oneDecimal(tokens / 1e9)}B`
  }
  if (tokens >= 1_000_000) {
    const millions = Number(oneDecimal(tokens / 1e6))
    return millions >= 1000 ? `${oneDecimal(tokens / 1e9)}B` : `${millions}M`
  }
  const thousands = Number(oneDecimal(tokens / 1000))
  return thousands >= 1000 ? `${oneDecimal(tokens / 1e6)}M` : `${thousands}k`
}

const SEGMENT_FLOOR = 0.005
const SECTION_KEYS: Record<string, ContextCardSection['key']> = {
  'MCP tools': 'mcp',
  'Memory files': 'memory',
  'Custom agents': 'agents'
}

/** The named-colour slot of the used row at `index`: `ja20.n`. */
function namedSlot(index: number): ContextColorSlot {
  return index >= 5 ? 6 : ((index + 1) as ContextColorSlot)
}

function percentLabel(category: ContextCategory, windowTokens: number): string {
  if (category.kind === 'deferred') {
    return '—'
  }
  const percent = category.percent ?? (category.tokens / windowTokens) * 100
  return `${percent.toFixed(1)}%`
}

function sectionOf(section: ContextDetailSection): ContextCardSection | null {
  const key = SECTION_KEYS[section.title]
  if (key === undefined) {
    return null
  }
  const rows = section.rows.map((row) => ({
    name: row.name,
    tokensLabel: row.tokens === null ? null : `${row.approximate ? '~' : ''}${formatTokens(row.tokens)}`
  }))
  const summed = section.rows.some((row) => row.tokens !== null)
    ? section.rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
    : null
  const printed = section.summary === null ? null : /·\s+(\S+)\s+tokens$/.exec(section.summary)?.[1] ?? null
  return {
    key,
    title: section.title,
    totalLabel: printed ?? (summed === null ? null : formatTokens(summed)),
    summary: section.summary,
    rows
  }
}

export function buildContextCard(report: ClaudeContextReport): ContextCard {
  const used = report.categories
    .filter((category) => category.kind === 'used')
    .sort((a, b) => b.tokens - a.tokens)
  const buffer = report.categories.filter((category) => category.kind === 'buffer')
  const free = report.categories.filter((category) => category.kind === 'free')
  const deferred = report.categories
    .filter((category) => category.kind === 'deferred')
    .sort((a, b) => b.tokens - a.tokens)
  const hasBuffer = buffer.length > 0 ? 1 : 0
  const folds = used.length + hasBuffer > 6
  const named = folds ? 5 - hasBuffer : used.length
  const drawn = [...used, ...buffer, ...free].reduce((sum, category) => sum + category.tokens, 0)
  const whole = Math.max(report.windowTokens, drawn)
  const fractionOf = (tokens: number): number | null => {
    const fraction = whole > 0 ? tokens / whole : 0
    return fraction >= SEGMENT_FLOOR ? fraction : null
  }
  const segments: ContextBarSegment[] = []
  used.slice(0, named).forEach((category, index) => {
    const fraction = fractionOf(category.tokens)
    if (fraction !== null) {
      segments.push({ slot: namedSlot(index), fraction })
    }
  })
  if (folds) {
    const fraction = fractionOf(used.slice(named).reduce((sum, category) => sum + category.tokens, 0))
    if (fraction !== null) {
      segments.push({ slot: 7, fraction })
    }
  }
  for (const category of buffer) {
    const fraction = fractionOf(category.tokens)
    if (fraction !== null) {
      segments.push({ slot: 8, fraction })
    }
  }
  const row = (category: ContextCategory, slot: ContextColorSlot): ContextLegendRow => ({
    name: category.name,
    tokensLabel: formatTokens(category.tokens),
    percentLabel: percentLabel(category, report.windowTokens),
    slot
  })
  const legend = [
    ...used.map((category, index) => row(category, index >= named ? 7 : namedSlot(index))),
    ...buffer.map((category) => row(category, 8)),
    ...free.map((category) => row(category, 9)),
    ...deferred.map((category) => row(category, 8))
  ]
  const displayPercent = Math.min(100, Math.round((report.usedTokens / report.windowTokens) * 100))
  const tokens = `${formatTokens(report.usedTokens)} of ${formatTokens(report.windowTokens)} tokens`
  return {
    displayPercent,
    segments,
    legend,
    sections: report.sections.flatMap((section) => sectionOf(section) ?? []),
    caption: report.model === null ? tokens : `${tokens} · ${report.model}`,
    a11y: `${displayPercent}% of context window used`
  }
}
