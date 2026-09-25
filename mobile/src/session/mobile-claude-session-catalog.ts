import type {
  AgentSessionOptionCatalog,
  CatalogModel,
  CatalogOption
} from '../../../src/shared/agent-session-option-catalog-types'

/**
 * Claude's effort levels as the Claude app names them (2026-09-25, the user,
 * beside its Effort sheet: "Low, Medium, High, Extra, Max, Ultracode", and its
 * pill "Opus 5.5 Extra"). Orca's catalog, vendored, says "Extra high" and the
 * status line says "xhigh"; both are drawn with these names instead.
 */
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
  ultracode: 'Ultracode'
}

/** An effort id, from the catalog or the status line, as it is drawn. */
export function effortDisplayLabel(effort: string): string {
  const known = EFFORT_LABELS[effort.toLowerCase()]
  if (known) {
    return known
  }
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

/**
 * Claude Code 2.1.281's `/effort ultracode` is "xhigh effort + dynamic
 * workflows for maximum thoroughness", and it refuses it on a model that does
 * not support xhigh ("the model does not support xhigh effort"). So it is
 * offered exactly where Extra is, after Max. Where Extra is comes from the
 * host's own list of Claude models (claude-model-discovery.ts), and for the
 * running model from Claude Code's table (claude-running-model-efforts.ts),
 * so neither is offered on Opus 4.6 or Sonnet 4.6 unless the host's own
 * Claude Code lists xhigh for them (a capability override). Dynamic workflows
 * being off is Claude Code's to say: the phone cannot read that setting, and
 * the refusal is the agent's own words in the chat.
 */
function withClaudeEffortNames(option: CatalogOption, ultracode: boolean): CatalogOption {
  if (option.id !== 'effort' || option.kind.type !== 'select') {
    return option
  }
  const choices = option.kind.choices.map((choice) => ({
    ...choice,
    label: effortDisplayLabel(String(choice.value))
  }))
  const offersExtra = choices.some((choice) => choice.value === 'xhigh')
  const hasUltracode = choices.some((choice) => choice.value === 'ultracode')
  return {
    ...option,
    kind: {
      ...option.kind,
      choices:
        ultracode && offersExtra && !hasUltracode
          ? [...choices, { value: 'ultracode', label: 'Ultracode' }]
          : choices
    }
  }
}

function withModelEffortNames(model: CatalogModel, ultracode: boolean): CatalogModel {
  return { ...model, options: model.options.map((option) => withClaudeEffortNames(option, ultracode)) }
}

/** A catalog with the Claude app's effort names, so one level reads the same
 *  on every agent's sheet and pill. Ultracode is Claude Code's alone: the
 *  apply is the catalog's own `/effort <value>`, so it needs nothing new to
 *  reach the agent. Codex takes the names and no Ultracode. */
export function mobileEffortNamedCatalog(
  catalog: AgentSessionOptionCatalog,
  { ultracode }: { ultracode: boolean }
): AgentSessionOptionCatalog {
  return {
    ...catalog,
    models: catalog.models.map((model) => withModelEffortNames(model, ultracode)),
    ...(catalog.unknownModelOptions
      ? {
          unknownModelOptions: catalog.unknownModelOptions.map((option) =>
            withClaudeEffortNames(option, ultracode)
          )
        }
      : {})
  }
}

/** Claude's catalog with the Claude app's effort names and its Ultracode. */
export function mobileClaudeSessionCatalog(catalog: AgentSessionOptionCatalog): AgentSessionOptionCatalog {
  return mobileEffortNamedCatalog(catalog, { ultracode: true })
}
