// The model sheet's two pages, as the Claude app lays them out: the newest
// model of each family on the first page (Fable, Opus, Sonnet, Haiku, each with
// a one-line tagline), and every other row the agent listed behind "More
// models".
//
// Claude Code's `list_models` rows do not name their version in one place.
// Captured on 2.1.282 (fixtures/claude-list-models-2.1.282.jsonl): the alias
// rows are labelled bare ("Sonnet", "Haiku") and state the version only in the
// description ("Sonnet 5 · Efficient for routine tasks"); `opus` is labelled
// "Opus 5.5" with a description of "Custom Opus model (eu.anthropic…)"; the
// pinned rows carry it in the id (`eu.anthropic.claude-opus-4-8[1m]`). So the
// version is read from the label, then the description, then the id. The
// static seed carries no version at all and is laid out by family alone.
//
// Claude Code 2.1.295 (captured 2026-10-09, fixtures/claude-list-models-
// 2.1.295.jsonl) labels every row with its version ("Sonnet 5.5") and gives
// the first-page rows the Claude app's own taglines as descriptions ("For your
// toughest challenges"), so the sheet says what the agent says. An older
// description that names a model ("Sonnet 5 · Efficient for routine tasks",
// "Custom Opus model (eu.anthropic…)") is not a tagline, and the family's
// 2.1.295 line stands in for it.
//
// Only Claude's list is laid out (the caller says whose list it is): OMP
// labels its rows "Claude Opus 4.5" and tells same-named rows apart only by
// the provider in the description, which the second page does not draw. A
// Claude list whose rows name no family still gets no layout.
import type { SessionOptionSelectChoice } from '../../../src/shared/native-chat-session-options'

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const
type Family = (typeof FAMILIES)[number]

const FAMILY_NAME: Record<Family, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku'
}

/** Claude Code 2.1.295's own descriptions of its first-page rows, for lists
 *  whose descriptions are not taglines (older builds, the static seed). */
const FAMILY_TAGLINE: Record<Family, string> = {
  fable: 'For your toughest challenges',
  opus: 'For complex work and everyday tasks',
  sonnet: 'Most efficient for simpler tasks',
  haiku: 'Fastest for quick answers'
}

export type ModelSheetLayout = {
  /** One row per family, newest first-page model, with its tagline. */
  featured: SessionOptionSelectChoice[]
  /** Every other row, by family then newest version, without descriptions. */
  more: SessionOptionSelectChoice[]
}

type ParsedRow = {
  choice: SessionOptionSelectChoice
  index: number
  family: Family | null
  /** [major, minor], or null when nothing states it. */
  version: [number, number] | null
  longContext: boolean
  /** A bare family alias (`opus`): Claude Code's name for that family's newest. */
  alias: boolean
}

const NAMED_VERSION = /\b(fable|opus|sonnet|haiku)\s+(\d{1,2})(?:\.(\d{1,2}))?\b/i
const ID_VERSION = /claude-(fable|opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?(?![\d.])/i
const FAMILY_WORD = /\b(fable|opus|sonnet|haiku)\b/i

function familyOf(text: string | undefined): Family | null {
  const match = text ? FAMILY_WORD.exec(text) : null
  return match ? (match[1]!.toLowerCase() as Family) : null
}

function versionFrom(
  pattern: RegExp,
  text: string | undefined,
  family: Family
): [number, number] | null {
  const match = text ? pattern.exec(text) : null
  if (!match || match[1]!.toLowerCase() !== family) {
    return null
  }
  return [Number(match[2]), match[3] === undefined ? 0 : Number(match[3])]
}

function parseRow(choice: SessionOptionSelectChoice, index: number): ParsedRow {
  const family = familyOf(choice.label) ?? familyOf(choice.description) ?? familyOf(choice.value)
  const version = family
    ? (versionFrom(NAMED_VERSION, choice.label, family) ??
      versionFrom(NAMED_VERSION, choice.description, family) ??
      versionFrom(ID_VERSION, choice.value, family))
    : null
  // Why the id alone: the running row is relabelled with the agent's own name
  // before it gets here (nameModelRowsFromAgent), and a status line names a 1M
  // session "Opus 5.5 (1M context)" on the `opus` alias. A label-read 1M sent
  // the running alias to the second page (review, 2026-10-09).
  const longContext = /\[1m\]/i.test(choice.value)
  const alias = family !== null && choice.value.toLowerCase() === family
  return { choice, index, family, version, longContext, alias }
}

function taglineOf(row: ParsedRow): string {
  const own = row.choice.description?.trim()
  return own && !FAMILY_WORD.test(own) ? own : FAMILY_TAGLINE[row.family!]
}

function compareVersions(a: [number, number] | null, b: [number, number] | null): number {
  if (!a || !b) {
    return a ? 1 : b ? -1 : 0
  }
  return a[0] - b[0] || a[1] - b[1]
}

function versionText(version: [number, number]): string {
  return version[1] === 0 ? String(version[0]) : `${version[0]}.${version[1]}`
}

function displayLabel(row: ParsedRow): string {
  // A label that already names a version is the agent's, kept as written:
  // the renamed running row ("Opus 4.8.5") must not be cut to "Opus 4.8".
  if (!row.family || !row.version || /\d/.test(row.choice.label)) {
    return row.choice.label
  }
  const name = `${FAMILY_NAME[row.family]} ${versionText(row.version)}`
  return row.longContext ? `${name} (1M context)` : name
}

export function modelSheetLayout(
  choices: readonly SessionOptionSelectChoice[]
): ModelSheetLayout | null {
  const rows = choices.map(parseRow)
  // Why two: one stray "Opus" in a Codex or Grok list must not split it.
  if (rows.filter((row) => row.family !== null).length < 2) {
    return null
  }
  const featuredRows: ParsedRow[] = []
  for (const family of FAMILIES) {
    let best: ParsedRow | null = null
    for (const row of rows) {
      if (row.family !== family || row.longContext) {
        continue
      }
      // The alias wins outright: it is what Claude Code itself resolves as
      // that family's newest, whatever name it is drawn under. Otherwise
      // strictly newer only, so a tie keeps the agent's own first row.
      if (
        !best ||
        (row.alias && !best.alias) ||
        (row.alias === best.alias && compareVersions(row.version, best.version) > 0)
      ) {
        best = row
      }
    }
    if (best) {
      featuredRows.push(best)
    }
  }
  const featuredSet = new Set(featuredRows)
  const familyRank = (row: ParsedRow): number =>
    row.family ? FAMILIES.indexOf(row.family) : FAMILIES.length
  const moreRows = rows
    .filter((row) => !featuredSet.has(row))
    .sort(
      (a, b) =>
        familyRank(a) - familyRank(b) ||
        compareVersions(b.version, a.version) ||
        Number(a.longContext) - Number(b.longContext) ||
        a.index - b.index
    )
  return {
    featured: featuredRows.map((row) => ({
      value: row.choice.value,
      label: displayLabel(row),
      description: taglineOf(row)
    })),
    more: moreRows.map((row) => ({ value: row.choice.value, label: displayLabel(row) }))
  }
}
