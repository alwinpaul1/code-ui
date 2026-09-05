// Codex models and their reasoning levels, discovered per account instead of
// hardcoded. The host's `git.discoverCommitMessageModels` (on the mobile RPC
// allowlist) runs `codex debug models`, which returns the signed-in account's
// model catalog: slug, display name, default reasoning level, and the levels
// each model supports. A Pro-only account therefore sees only what it can use.
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { CODEX_SESSION_OPTION_CATALOG } from '../../../src/shared/agent-session-option-catalog-claude-codex'
import type {
  CatalogModel,
  CatalogOption,
  CatalogOptionApply
} from '../../../src/shared/agent-session-option-catalog-types'

export type DiscoveredCodexLevel = { id: string; label: string }
export type DiscoveredCodexModel = {
  id: string
  label: string
  description?: string
  levels: DiscoveredCodexLevel[]
  defaultLevel: string | null
  isDefault: boolean
}

type DiscoveryResponse = {
  success?: boolean
  models?: Array<{
    id?: unknown
    label?: unknown
    description?: unknown
    thinkingLevels?: Array<{ id?: unknown; label?: unknown }>
    defaultThinkingLevel?: unknown
    isDefault?: unknown
  }>
  defaultModelId?: unknown
}

/** Shape the host's discovery result into models the option sheet can list. */
export function parseCodexDiscovery(result: unknown): DiscoveredCodexModel[] {
  const response = result as DiscoveryResponse | null
  if (!response || response.success !== true || !Array.isArray(response.models)) {
    return []
  }
  const models: DiscoveredCodexModel[] = []
  for (const model of response.models) {
    if (typeof model.id !== 'string' || !model.id || typeof model.label !== 'string') {
      continue
    }
    const levels = (model.thinkingLevels ?? [])
      .filter(
        (level): level is { id: string; label: string } =>
          typeof level.id === 'string' && level.id.length > 0 && typeof level.label === 'string'
      )
      .map((level) => ({ id: level.id, label: level.label }))
    models.push({
      id: model.id,
      label: model.label,
      ...(typeof model.description === 'string' && model.description
        ? { description: model.description }
        : {}),
      levels,
      defaultLevel:
        typeof model.defaultThinkingLevel === 'string' ? model.defaultThinkingLevel : null,
      // Why false: the probe's default is the host's static seed default, not
      // the account's; only Codex's own picker knows which row is "(default)".
      isDefault: false
    })
  }
  return models
}

/** The effort option a discovered model exposes: its own levels, its own default.
 *  Apply metadata is the catalog's (launch flags stay correct); mid-session the
 *  phone drives the picker, see codex-picker-apply.ts. */
function effortOptionFor(model: DiscoveredCodexModel): CatalogOption | null {
  if (model.levels.length === 0) {
    return null
  }
  const seed = CODEX_SESSION_OPTION_CATALOG.unknownModelOptions?.find(
    (option) => option.id === 'effort'
  )
  if (!seed) {
    return null
  }
  const choices = model.levels.map((level) => ({ value: level.id, label: level.label }))
  const defaultValue =
    model.defaultLevel && choices.some((choice) => choice.value === model.defaultLevel)
      ? model.defaultLevel
      : (choices[0]?.value ?? 'medium')
  return {
    ...seed,
    kind: { type: 'select', choices, defaultValue },
    // Why: a 'command' apply makes the sheet draw radio rows instead of the
    // agent-picker action row. The text is never typed: the mobile hook's
    // applyOverride drives the picker instead (typing it would reach the model
    // as chat — verified on Codex 0.153.4).
    apply: { ...seed.apply, midSession: { kind: 'command', build: () => '/model' } }
  }
}

/** Model apply for a discovered catalog: same placeholder, same reason as above. */
export const CODEX_DISCOVERED_MODEL_APPLY: CatalogOptionApply = {
  ...CODEX_SESSION_OPTION_CATALOG.modelApply,
  midSession: { kind: 'command', build: (value) => `/model ${String(value)}` }
}

export function discoveredCodexCatalogModels(
  models: readonly DiscoveredCodexModel[]
): CatalogModel[] {
  return models.map((model) => {
    const effort = effortOptionFor(model)
    return {
      id: model.id,
      label: model.label,
      ...(model.description ? { description: model.description } : {}),
      ...(model.isDefault ? { isDefault: true } : {}),
      options: effort ? [effort] : []
    }
  })
}

const cache = new Map<string, DiscoveredCodexModel[]>()
const inFlight = new Map<string, Promise<DiscoveredCodexModel[]>>()

export function codexDiscoveryCacheKey(hostId: string, worktreeId: string): string {
  return `${hostId}\0${worktreeId}`
}

export function peekDiscoveredCodexModels(
  hostId: string,
  worktreeId: string
): DiscoveredCodexModel[] | null {
  return cache.get(codexDiscoveryCacheKey(hostId, worktreeId)) ?? null
}

export function resetCodexDiscoveryForTests(): void {
  cache.clear()
  inFlight.clear()
}

/**
 * Discover once per host+worktree and remember it for the process. A failed
 * or empty discovery is not cached, so the next open retries.
 */
export function discoverCodexModels(args: {
  client: RpcClient
  hostId: string
  worktreeId: string
}): Promise<DiscoveredCodexModel[]> {
  const key = codexDiscoveryCacheKey(args.hostId, args.worktreeId)
  const cached = cache.get(key)
  if (cached) {
    return Promise.resolve(cached)
  }
  const pending = inFlight.get(key)
  if (pending) {
    return pending
  }
  const run = (async () => {
    try {
      const response = await args.client.sendRequest(
        'git.discoverCommitMessageModels',
        { worktree: `id:${args.worktreeId}`, agentId: 'codex' },
        { timeoutMs: 20_000 }
      )
      if (!response.ok) {
        return []
      }
      const models = parseCodexDiscovery((response as RpcSuccess).result)
      if (models.length > 0) {
        cache.set(key, models)
      }
      return models
    } catch {
      return []
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, run)
  return run
}
