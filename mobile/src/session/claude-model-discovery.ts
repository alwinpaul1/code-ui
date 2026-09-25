// Claude's models, and the effort levels each one takes, as the host's own
// Claude Code lists them. The host's `git.discoverCommitMessageModels` (on the
// mobile RPC allowlist) sends Claude Code a `list_models` control request over
// `claude -p --input-format stream-json …` and parses the answer with Orca's
// `parseClaudeModels`: id, label, description, `thinkingLevels`, fast mode.
//
// Without it the sheet is Orca's static seed, whose `opus` and `sonnet` carry
// xhigh on every host. Claude Code 2.1.282 lists Sonnet 4.6, and Opus 4.6 when
// `opus` resolves to it, as low/medium/high/max (captured 2026-09-25, see
// fixtures/claude-list-models-*-2.1.282.jsonl), so the seed offered Extra and
// Ultracode on models that refuse both.
import { z } from 'zod'
import { createClaudeCatalogOptions } from '../../../src/shared/agent-session-option-catalog-claude-codex'
import type { CatalogModel } from '../../../src/shared/agent-session-option-catalog-types'
import { readCodexModelList, writeCodexModelList } from '../storage/codex-model-lists'
import { defineRpcOperation, runRpcOperation } from '../transport/rpc-operation'

const discoveredModel = z.object({
  id: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
  effortLevels: z.array(z.string()),
  supportsFastMode: z.boolean()
})
export type DiscoveredClaudeModel = z.infer<typeof discoveredModel>

const discoveryResult = z.object({
  success: z.literal(true),
  // Why 'probe' only: when Claude Code answers with nothing the host falls back
  // to its static spec and says so with `catalogOrigin: 'spec'`. That spec gives
  // `opus` and `sonnet` every level, xhigh included, which is the bug itself.
  // An older host that does not say where its list came from is not believed.
  catalogOrigin: z.literal('probe'),
  models: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string(),
        description: z.string().optional(),
        thinkingLevels: z.array(z.object({ id: z.string() })).optional(),
        supportsFastMode: z.boolean().optional()
      })
    )
    .min(1)
})

/** The host's answer as models the sheet can list, or null to keep the seed. */
export function parseClaudeDiscovery(raw: unknown): DiscoveredClaudeModel[] | null {
  const parsed = discoveryResult.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  return parsed.data.models.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    effortLevels: (model.thinkingLevels ?? []).map((level) => level.id),
    supportsFastMode: model.supportsFastMode === true
  }))
}

/** Rows built exactly as Orca's own `listModels` overlay builds them: the
 *  model's levels and nothing else, applied with `/effort <value>`, and fast
 *  mode only where Claude Code says the model has it. */
export function discoveredClaudeCatalogModels(models: readonly DiscoveredClaudeModel[]): CatalogModel[] {
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    options: createClaudeCatalogOptions({
      effortLevelIds: model.effortLevels,
      supportsFastMode: model.supportsFastMode
    })
  }))
}

const listClaudeModels = defineRpcOperation({
  name: 'claude.listed-models',
  method: 'git.discoverCommitMessageModels',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: (raw: unknown) => ({
    compatible: true as const,
    variant: 'listed-models' as const,
    value: parseClaudeDiscovery(raw),
    salvage: { droppedPaths: [], droppedCount: 0 }
  })
})

const cache = new Map<string, DiscoveredClaudeModel[]>()
const persisted = new Map<string, DiscoveredClaudeModel[]>()
const inFlight = new Map<string, Promise<DiscoveredClaudeModel[] | null>>()
const hydrating = new Map<string, Promise<void>>()

function cacheKey(hostId: string, worktreeId: string): string {
  return `${hostId}\0${worktreeId}`
}

function isDiscoveredModel(value: unknown): value is DiscoveredClaudeModel {
  return discoveredModel.safeParse(value).success
}

export function peekDiscoveredClaudeModels(hostId: string, worktreeId: string): DiscoveredClaudeModel[] | null {
  const key = cacheKey(hostId, worktreeId)
  return cache.get(key) ?? persisted.get(key) ?? null
}

/** Load the last list this host gave, so a cold open shows it at once. The
 *  first open of the app run still asks the host, and its answer replaces the
 *  stored one; after that the list is not asked for again until the app
 *  restarts. */
export function hydrateDiscoveredClaudeModels(hostId: string, worktreeId: string): Promise<void> {
  const key = cacheKey(hostId, worktreeId)
  if (cache.has(key) || persisted.has(key)) {
    return Promise.resolve()
  }
  const pending = hydrating.get(key)
  if (pending) {
    return pending
  }
  const run = readCodexModelList('claude-discovered', key, isDiscoveredModel)
    .then((stored) => {
      if (stored && !cache.has(key) && !persisted.has(key)) {
        persisted.set(key, stored)
      }
    })
    .finally(() => {
      hydrating.delete(key)
    })
  hydrating.set(key, run)
  return run
}

export function resetClaudeDiscoveryForTests(): void {
  cache.clear()
  persisted.clear()
  hydrating.clear()
  inFlight.clear()
}

/**
 * Ask once per host+worktree and remember the answer until the app restarts,
 * as Codex's list is. A model added on the host meanwhile shows after a
 * restart. Null when the host had no list to give (refused, failed, static,
 * unreachable), and that is not cached, so the next connection asks again.
 */
export function discoverClaudeModels(args: {
  client: Parameters<typeof runRpcOperation>[0]
  hostId: string
  worktreeId: string
}): Promise<DiscoveredClaudeModel[] | null> {
  const key = cacheKey(args.hostId, args.worktreeId)
  const cached = cache.get(key)
  if (cached) {
    return Promise.resolve(cached)
  }
  const pending = inFlight.get(key)
  if (pending) {
    return pending
  }
  // Why 65 s: the host gives the `claude -p` probe 60 s to answer (Orca
  // ef428d879's SOURCE_CONTROL_GENERATION_TIMEOUT_MS, GENERATION_TIMEOUT_MS in
  // older builds), and a cold Claude Code with hooks to run can take most of
  // it. The RPC default of 30 s gave up on an answer still coming.
  const run = runRpcOperation(
    args.client,
    listClaudeModels,
    { worktree: `id:${args.worktreeId}`, agentId: 'claude' },
    { timeoutMs: 65_000 }
  )
    .then((models) => {
      if (models) {
        cache.set(key, models)
        void writeCodexModelList('claude-discovered', key, models)
      }
      return models
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, run)
  return run
}
