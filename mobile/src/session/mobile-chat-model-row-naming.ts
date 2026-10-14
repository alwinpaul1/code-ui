import type {
  AgentSessionOptionCatalog,
  CatalogModel
} from '../../../src/shared/agent-session-option-catalog-types'
import { withTrackedNativeChatModel } from '../../../src/shared/native-chat-session-option-snapshot'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'
import { claudeCanonicalModel, matchClaudeCatalogModelId, namesAnotherModel } from './claude-model-identity'

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
 *
 * A row whose own label already names a different model is never renamed. On
 * a Claude fallback (2.1.300, Opus 5.5 → Opus 4.8) the screen reports the
 * family word `opus` with the name "Opus 4.8", and renaming the listed `opus`
 * row ("Opus 5.5") drew "Opus 4.8" on the row that switches to 5.5. The name
 * goes to the row the matcher says is running (the listed `claude-opus-4-8`);
 * when the matcher folds the report onto that alias for want of one, no row
 * is renamed and the pill alone states the name.
 */
export function nameModelRowsFromAgent(
  models: readonly CatalogModel[],
  reportedModelId: string | null,
  reportedLabel: string | null
): CatalogModel[] {
  const name = reportedLabel?.trim()
  if (!reportedModelId || !name || !models.some((model) => model.id === reportedModelId)) {
    return [...models]
  }
  // With the reported id listed, the matcher keeps that row unless it is an
  // alias naming another model, so Codex and every other agent are unchanged.
  const running = matchClaudeCatalogModelId({ models: [...models], modelApply: {} }, reportedModelId, name)
  const canonical = claudeCanonicalModel(reportedModelId, name)
  return models.map((model) =>
    model.id === running && model.label !== name && !namesAnotherModel(model, canonical)
      ? { ...model, label: name }
      : model
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
