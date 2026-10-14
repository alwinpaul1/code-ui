/**
 * Claude Code's `/context` table, read off the screen.
 *
 * The Claude app draws a context card from `get_context_usage` (com.anthropic.claude 1.261009.20,
 * `s5a`, model `y6a`): a segmented bar, "N of M tokens", and the expandable MCP tools, memory files
 * and custom agents. Code UI has no session registered with Anthropic to ask, and may not draw in the
 * user's terminal (root CLAUDE.md), so it never runs `/context`. It reads the table when the user (or
 * the phone's own composer) has already run it, which Claude Code paints like this:
 *
 *   ❯ /context
 *     ⎿  Context Usage
 *        ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛀ ⛀ ⛀ ⛶ …   Haiku 5.5
 *        ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ …   claude-haiku-5-5
 *        ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ …   32.8k/1m tokens (3%)
 *        ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ …   Estimated usage by category
 *        ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ …   ⛁ System prompt: 5k tokens (0.5%)
 *        …
 *        ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ …   ⛶ Free space: 934.2k (93.4%)
 *                                 ⛝ Autocompact buffer: 33k tokens (3.3%)
 *
 *        Auto-compact window: 1m tokens
 *
 *        MCP tools · /mcp (loaded on-demand)
 *        └ 147 tools · 631 tokens
 *
 * Verified against Claude Code 2.1.300 (macOS, 2026-10-14) at 130, 110, 80 and 48 columns and with
 * `/context all`, which adds the rows under each section (fixtures/claude-context-2.1.300/). The
 * rows wrap with the pane: at 80 columns "⛁ System tools: 23.8k tokens" puts its "(2.4%)" on the next
 * line, and at 48 nearly every row does.
 *
 * Refusing over guessing (root CLAUDE.md, "Agent screen parsing"): nothing is returned unless the
 * "Context Usage" heading, the "used/window tokens" totals and a Free space row are all on the
 * screen, and the categories add up to the window. A table scrolled half off the pane, or with a row
 * whose name wrapped away, would draw a bar that is wrong, and a missing bar only annoys.
 *
 * `/context all` lists the on-demand MCP tools by name alone and the skills with an estimate
 * ("~480 tokens"); those are kept as printed, tokens null or approximate.
 *
 * No per-file rows are read for Memory files: 2.1.300 paints the category row and no section for it
 * (checked with a 2.5 KB CLAUDE.md and a CLAUDE.local.md in the project, `/context` and
 * `/context all`). A build that does paint one is read by the same section rule.
 */

export type ContextCategoryKind = 'used' | 'free' | 'buffer' | 'deferred'

export type ContextCategory = {
  name: string
  tokens: number
  /** The percent Claude Code printed beside the row, or null when it printed none. */
  percent: number | null
  kind: ContextCategoryKind
}

export type ContextDetailRow = {
  name: string
  /** Null for a row Claude Code gives no figure (an on-demand MCP tool). */
  tokens: number | null
  /** "~480 tokens": an estimate, drawn with its tilde. */
  approximate: boolean
}

export type ContextDetailSection = {
  /** "MCP tools", "Memory files", "Custom agents" or "Skills". */
  title: string
  /** What follows the title's dot: "/mcp (loaded on-demand)", ".claude/agents/". */
  hint: string | null
  /** "147 tools · 631 tokens", as printed, when the table gave one. */
  summary: string | null
  rows: ContextDetailRow[]
}

export type ClaudeContextReport = {
  model: string | null
  modelId: string | null
  usedTokens: number
  windowTokens: number
  usedPercent: number | null
  categories: ContextCategory[]
  sections: ContextDetailSection[]
}

/** What one screen read found: the table, and whether that read was the first of the watch (a table
 *  already on screen when the phone began to look was painted at an unknown time). */
export type ContextReportRead = { report: ClaudeContextReport; firstRead: boolean }

/** A table the phone is holding for a session, with when it saw it painted; null `readAt` when it
 *  was already on screen as the watch began, so how old it is stays unsaid. */
export type ContextBreakdown = { report: ClaudeContextReport; readAt: number | null }

const COUNT = /^~?(\d+(?:\.\d+)?)([kKmM]?)$/

/** "631", "5k", "23.8k", "1m", "~480" as a number of tokens; null for anything else. */
export function parseTokenCount(text: string): number | null {
  const match = COUNT.exec(text.trim().replace(/,/g, ''))
  if (!match) {
    return null
  }
  const unit = match[2]!.toLowerCase()
  const scale = unit === 'k' ? 1000 : unit === 'm' ? 1_000_000 : 1
  return Math.round(Number(match[1]) * scale)
}

const COUNT_SOURCE = String.raw`~?[\d.,]+[kKmM]?`
/** The grid glyphs, the legend's own marker, and the "⎿" in front of the heading. */
const LEAD = /^[\s⎿⛁⛀⛶⛝]+/u
const HEADING = /^Context Usage$/
const TOTALS = new RegExp(String.raw`^(${COUNT_SOURCE})\s*/\s*(${COUNT_SOURCE})\s+tokens\s*\((\d{1,3})%\)$`)
const MODEL_ID = /^(claude-[\w.-]+)$/
const LEGEND_START = /^Estimated usage by category$/
const LEGEND_ROW = new RegExp(String.raw`^(.+?):\s*(${COUNT_SOURCE})(?:\s+tokens?)?(?:\s*\(([\d.]+)%\))?$`)
const WRAPPED_PERCENT = /^(?:tokens?\s+)?\(([\d.]+)%\)$/
const SECTION_HEADER = /^(MCP tools|Memory files|Custom agents|Skills)\s+·\s*(.*)$/
const SUMMARY_ROW = new RegExp(String.raw`^\d+\s+(?:tools?|agents?|skills?|files?)\s+·\s+${COUNT_SOURCE}\s+tokens$`)
const NAMED_ROW = new RegExp(String.raw`^(.+?):\s*(${COUNT_SOURCE})\s+tokens$`)
const TREE_ROW = /^[├└]\s+(.*)$/u
/** The table is indented under "⎿ "; anything flush to the left after it is the conversation again. */
const BLOCK_INDENT = 5

function kindOf(name: string): ContextCategoryKind {
  if (/^free space$/i.test(name)) {
    return 'free'
  }
  if (/^auto-?compact buffer$/i.test(name)) {
    return 'buffer'
  }
  return /\(deferred\)$/i.test(name) ? 'deferred' : 'used'
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function detailRow(content: string): ContextDetailRow {
  const named = NAMED_ROW.exec(content)
  if (!named) {
    return { name: content, tokens: null, approximate: false }
  }
  return {
    name: named[1]!,
    tokens: parseTokenCount(named[2]!),
    approximate: named[2]!.startsWith('~')
  }
}

export function readClaudeContextReport(lines: readonly string[]): ClaudeContextReport | null {
  let heading = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (HEADING.test((lines[index] ?? '').replace(LEAD, ''))) {
      heading = index
      break
    }
  }
  if (heading === -1) {
    return null
  }
  let model: string | null = null
  let modelId: string | null = null
  let totals: { used: number; window: number; percent: number } | null = null
  const categories: ContextCategory[] = []
  const sections: ContextDetailSection[] = []
  let phase: 'top' | 'legend' | 'after' = 'top'
  let section: ContextDetailSection | null = null
  const body = (line: string | undefined): string => (line ?? '').replace(LEAD, '').trimEnd()
  for (let index = heading + 1; index < lines.length; index += 1) {
    const original = lines[index] ?? ''
    if (original.trim() !== '' && indentOf(original) < BLOCK_INDENT) {
      break
    }
    const text = body(original)
    if (phase === 'top') {
      if (LEGEND_START.test(text)) {
        phase = 'legend'
        continue
      }
      const stated = TOTALS.exec(text)
      if (stated) {
        const used = parseTokenCount(stated[1]!)
        const window = parseTokenCount(stated[2]!)
        if (used !== null && window !== null && window > 0) {
          totals = { used, window, percent: Number(stated[3]) }
        }
      } else if (MODEL_ID.test(text)) {
        modelId ??= text
      } else if (text !== '' && model === null) {
        model = text
      }
      continue
    }
    if (phase === 'legend') {
      if (original.trim() === '') {
        phase = 'after'
        continue
      }
      if (text === '') {
        continue
      }
      const row = LEGEND_ROW.exec(text)
      if (!row) {
        continue
      }
      let percent = row[3]
      if (percent === undefined) {
        // The percent can wrap onto the next row ("(2.4%)", or "tokens (0.1%)" when the row broke
        // before the word).
        const next = WRAPPED_PERCENT.exec(body(lines[index + 1]))
        if (next) {
          percent = next[1]
          index += 1
        }
      }
      const tokens = parseTokenCount(row[2]!)
      if (tokens !== null) {
        categories.push({
          name: row[1]!,
          tokens,
          percent: percent === undefined ? null : Number(percent),
          kind: kindOf(row[1]!)
        })
      }
      continue
    }
    const header = SECTION_HEADER.exec(text)
    if (header) {
      section = { title: header[1]!, hint: header[2]!.trim() === '' ? null : header[2]!.trim(), summary: null, rows: [] }
      sections.push(section)
      continue
    }
    const tree = TREE_ROW.exec(text)
    if (tree && section) {
      if (SUMMARY_ROW.test(tree[1]!)) {
        section.summary = tree[1]!
      } else {
        section.rows.push(detailRow(tree[1]!))
      }
    }
  }
  if (!totals || categories.length === 0 || !categories.some((category) => category.kind === 'free')) {
    return null
  }
  // A whole table adds up: the used rows, the buffer and the free space fill the window, give or take
  // the rounding of each printed figure. A row lost to a wrapped name leaves a gap far wider.
  const filled = categories
    .filter((category) => category.kind !== 'deferred')
    .reduce((sum, category) => sum + category.tokens, 0)
  if (Math.abs(filled - totals.window) > 100 * categories.length) {
    return null
  }
  return {
    model,
    modelId,
    usedTokens: totals.used,
    windowTokens: totals.window,
    usedPercent: totals.percent,
    categories,
    sections
  }
}
