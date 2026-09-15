import type {
  AgentSessionOptionCatalog,
  CatalogModel
} from '../../../src/shared/agent-session-option-catalog-types'
import { withTrackedNativeChatModel } from '../../../src/shared/native-chat-session-option-snapshot'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'

/**
 * Name the running model the way the AGENT names it.
 *
 * The Claude catalog lists four generic entries — fable, opus, sonnet, haiku,
 * labelled "Fable"/"Opus"/"Sonnet"/"Haiku" — and a reported model is collapsed
 * onto one of them by `matchNativeChatCatalogModelId`. So a session on Opus
 * 4.8.5 and a session on Opus 5 both rendered "Opus", and the pill could not
 * state which was running (reported 2026-09-15: "the user can use Opus 4.8.5 or
 * either Sonnet or any model with any effort, so you should exactly show what
 * model the user is using").
 *
 * The agent states its own name on the beacon (`name=Opus%204.8.5`) and on its
 * status-line badge. That name is evidence; the catalog label is our guess at a
 * family. So the matched row takes the agent's name when there is one.
 *
 * Only the row the agent is actually reporting is renamed: every other row is a
 * choice the user might make, and those keep the catalog's own wording.
 * `src/shared` is Orca's, so this happens here rather than in the snapshot.
 */
export function nameModelRowsFromAgent(
  models: readonly CatalogModel[],
  reportedModelId: string | null,
  reportedLabel: string | null
): CatalogModel[] {
  const name = reportedLabel?.trim()
  if (!reportedModelId || !name) {
    return [...models]
  }
  return models.map((model) =>
    model.id === reportedModelId && model.label !== name ? { ...model, label: name } : model
  )
}

/** The rows the picker and the pill read: the catalog's models, named as the
 *  agent names the running one, plus a row for a tracked model the catalog does
 *  not list (a Codex release newer than the catalog). */
export function activeModels(
  catalog: AgentSessionOptionCatalog,
  record: NativeChatSessionOptionRecord,
  reportedModel: string | null,
  reportedModelLabel: string | null
): CatalogModel[] {
  return withTrackedNativeChatModel(
    catalog,
    nameModelRowsFromAgent(catalog.models, reportedModel, reportedModelLabel),
    record
  )
}
