import type {
  AgentSessionOptionCatalog,
  CatalogModel
} from '../../../src/shared/agent-session-option-catalog-types'
import { matchNativeChatCatalogModelId } from '../../../src/shared/native-chat-session-option-state'

// Claude Code 2.1.282's canonicaliser, in its own order (2.1.283 ships the
// same chain and the same embedded model table: both binaries read
// 2026-09-26): the first family id the lowercased string CONTAINS wins, so
// region prefixes (`eu.anthropic.`), `[1m]` and date suffixes all fall away.
// Opus 4.6 must be tried after 4.8 and 4.7, and the bare `claude-opus-4` form
// (Opus 4.0) only when no minor follows. The explicit `-4-0` ids are ours:
// Claude Code reaches them through its own id table, which this does not
// copy. Anything else is unknown, not guessed.
const CANONICAL: ReadonlyArray<readonly [RegExp | string, string]> = [
  ['claude-fable-5-1', 'claude-fable-5-1'],
  ['claude-fable-5', 'claude-fable-5'],
  ['claude-mythos-5-1', 'claude-mythos-5-1'],
  ['claude-mythos-5', 'claude-mythos-5'],
  ['claude-opus-5-5', 'claude-opus-5-5'],
  ['claude-opus-5', 'claude-opus-5'],
  ['claude-opus-4-8', 'claude-opus-4-8'],
  ['claude-opus-4-7', 'claude-opus-4-7'],
  ['claude-opus-4-6', 'claude-opus-4-6'],
  ['claude-opus-4-5', 'claude-opus-4-5'],
  ['claude-opus-4-1', 'claude-opus-4-1'],
  ['claude-opus-4-0', 'claude-opus-4-0'],
  [/claude-opus-4(?!-\d(?!\d))/, 'claude-opus-4-0'],
  ['claude-sonnet-5', 'claude-sonnet-5'],
  ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['claude-sonnet-4-5', 'claude-sonnet-4-5'],
  ['claude-sonnet-4-0', 'claude-sonnet-4-0'],
  [/claude-sonnet-4(?!-\d(?!\d))/, 'claude-sonnet-4-0'],
  ['claude-haiku-4-5', 'claude-haiku-4-5'],
  ['claude-3-', 'claude-3']
]

function canonicalOf(id: string): string | null {
  const lower = id.toLowerCase()
  for (const [pattern, canonical] of CANONICAL) {
    if (typeof pattern === 'string' ? lower.includes(pattern) : pattern.test(lower)) {
      return canonical
    }
  }
  return null
}

// An alias ("opus", the status-line badge or a host row) names only a family;
// its label names the version ("Opus 4.6", "Sonnet 4.6 (1M context)"), and is
// then the only evidence of which model it is. The seed's labels ("Opus") name
// no version, so a seed row is never taken for a particular model.
const LABEL = /^(fable|mythos|opus|sonnet|haiku)\s+(\d+(?:\.\d+)*)\b/i

/** Claude Code's canonical id for a model id and its label, or null when
 *  neither names a model it knows. */
export function claudeCanonicalModel(id: string, label: string | null): string | null {
  const trimmed = id.trim()
  if (trimmed.toLowerCase().includes('claude-')) {
    return canonicalOf(trimmed)
  }
  const named = LABEL.exec(label?.trim() ?? '')
  return named ? canonicalOf(`claude-${named[1]!.toLowerCase()}-${named[2]!.replace(/\./g, '-')}`) : null
}

function isOneMillion(id: string, label: string | null): boolean {
  return /\[1m\]/i.test(id) || /\(1M context\)/i.test(label ?? '')
}

/**
 * The catalog row a Claude report stands on, or null when none does.
 *
 * Orca's matcher tries the id, then a label, then the longest row id the report
 * contains. On a host's own list that misses or misfiles a report: the Bedrock
 * list carries Sonnet 4.6 only as `eu.anthropic.claude-sonnet-4-6`, which a bare
 * `claude-sonnet-4-6` does not contain, and its Sonnet 5 row is labelled
 * "Sonnet", which is exactly the badge id `sonnet`. So when the report names a
 * model Claude Code knows and the matcher found no row for that same model, the
 * one row that is that model (same canonical id, same 1M window) is taken
 * instead. An exact id always stands. A seed row names no model, so on the seed
 * this is Orca's matcher unchanged.
 */
export function matchClaudeCatalogModelId(
  catalog: AgentSessionOptionCatalog,
  reportedModel: string,
  reportedLabel: string | null
): string | null {
  // The matcher hands back the reported id itself for a catalog with no models,
  // so a match counts only when that row is really there.
  const matched = matchNativeChatCatalogModelId(catalog, reportedModel)
  const row = catalog.models.find((model) => model.id === matched) ?? null
  const canonical = claudeCanonicalModel(reportedModel, reportedLabel)
  if (!canonical || row?.id.toLowerCase() === reportedModel.trim().toLowerCase()) {
    return row?.id ?? null
  }
  const oneMillion = isOneMillion(reportedModel, reportedLabel)
  const isReported = (model: CatalogModel): boolean =>
    claudeCanonicalModel(model.id, model.label) === canonical &&
    isOneMillion(model.id, model.label) === oneMillion
  if (row && isReported(row)) {
    return row.id
  }
  const same = catalog.models.filter(isReported)
  return same.length === 1 ? same[0]!.id : (row?.id ?? null)
}
