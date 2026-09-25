import type {
  AgentSessionOptionCatalog,
  CatalogOption
} from '../../../src/shared/agent-session-option-catalog-types'
import { claudeCanonicalModel, matchClaudeCatalogModelId } from './claude-model-identity'

/**
 * Which effort levels Claude Code itself allows on a model.
 *
 * Read out of the Claude Code 2.1.282 binary on 2026-09-25 (in 2.1.281 the
 * xhigh check was `gfe`, in 2.1.282 `yme`; max is `zq`, effort at all `ib`).
 * Each check consults the user's capability overrides and the model list's own
 * `effortLevels` first, and only then these tables, keyed by the canonical id
 * (claude-model-identity.ts):
 *
 *   no effort  claude-3-*, opus-4-0, opus-4-1, sonnet-4-0, sonnet-4-5, haiku-4-5
 *   no max     the above, and opus-4-5
 *   no xhigh   the above, and opus-4-6, sonnet-4-6
 *
 * Ultracode is "xhigh effort + dynamic workflows" and needs xhigh
 * (`OR(e)=$p()&&(e===void 0||yme(e)&&…)`), so no xhigh means no Ultracode.
 * A model outside the tables (Opus 5.5, Fable 5.1, anything newer) is null:
 * nothing is known against it, and its row is left as it is.
 */
export type ClaudeEffortSupport = { effort: boolean; max: boolean; xhigh: boolean }

const NO_EFFORT = new Set(['claude-opus-4-0', 'claude-opus-4-1', 'claude-sonnet-4-0', 'claude-sonnet-4-5', 'claude-haiku-4-5'])
const NO_MAX = new Set([...NO_EFFORT, 'claude-opus-4-5'])
const NO_XHIGH = new Set([...NO_MAX, 'claude-opus-4-6', 'claude-sonnet-4-6'])

/** What Claude Code refuses on the reported model, or null when it refuses
 *  nothing or the model is not in its tables. */
export function claudeEffortSupport(reportedModel: string, reportedLabel: string | null): ClaudeEffortSupport | null {
  const canonical = claudeCanonicalModel(reportedModel, reportedLabel)
  if (!canonical) {
    return null
  }
  const legacy = canonical === 'claude-3'
  const support = {
    effort: !legacy && !NO_EFFORT.has(canonical),
    max: !legacy && !NO_MAX.has(canonical),
    xhigh: !legacy && !NO_XHIGH.has(canonical)
  }
  return support.effort && support.max && support.xhigh ? null : support
}

function limitEffort(option: CatalogOption, support: ClaudeEffortSupport): CatalogOption | null {
  if (option.id !== 'effort' || option.kind.type !== 'select') {
    return option
  }
  if (!support.effort) {
    return null
  }
  const refused = new Set([...(support.max ? [] : ['max']), ...(support.xhigh ? [] : ['xhigh', 'ultracode'])])
  const choices = option.kind.choices.filter((choice) => !refused.has(String(choice.value)))
  if (choices.length === 0) {
    return null
  }
  const defaultValue = choices.some((choice) => choice.value === option.kind.defaultValue)
    ? option.kind.defaultValue
    : choices.some((choice) => choice.value === 'high')
      ? 'high'
      : choices[0]!.value
  return { ...option, kind: { ...option.kind, choices, defaultValue } }
}

function limitEfforts(options: readonly CatalogOption[], support: ClaudeEffortSupport): CatalogOption[] {
  return options.flatMap((option) => {
    const limited = limitEffort(option, support)
    return limited ? [limited] : []
  })
}

/**
 * The catalog with the RUNNING model's row cut to what Claude Code allows it.
 *
 * The row is the one the report resolves to, which need not be that model: a
 * seed alias (`opus`, xhigh everywhere) or a host-listed alias the report is
 * folded onto (`claude-opus-4-6` contains `opus`, which on the host may be
 * Opus 5.5). When the row IS the running model by its own id or label (the
 * host listed `eu.anthropic.claude-opus-4-6`, or `opus` labelled "Opus 4.6"),
 * its levels are Claude Code's answer for exactly that model, capability
 * overrides included, and the row stands. When no row matches at all, the
 * sheet draws the model it tracks with the catalog's fallback options (every
 * level), so those are cut instead.
 */
export function withRunningClaudeModelEfforts(
  catalog: AgentSessionOptionCatalog,
  reportedModel: string | null,
  reportedLabel: string | null
): AgentSessionOptionCatalog {
  const support = reportedModel ? claudeEffortSupport(reportedModel, reportedLabel) : null
  if (!reportedModel || !support) {
    return catalog
  }
  const rowId = matchClaudeCatalogModelId(catalog, reportedModel, reportedLabel)
  const row = catalog.models.find((model) => model.id === rowId)
  if (!row) {
    return catalog.unknownModelOptions
      ? { ...catalog, unknownModelOptions: limitEfforts(catalog.unknownModelOptions, support) }
      : catalog
  }
  if (claudeCanonicalModel(row.id, row.label) === claudeCanonicalModel(reportedModel, reportedLabel)) {
    return catalog
  }
  return {
    ...catalog,
    models: catalog.models.map((model) =>
      model.id === row.id ? { ...model, options: limitEfforts(model.options, support) } : model
    )
  }
}
