import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { COMMIT_MESSAGE_AGENT_SPECS } from '../../../src/shared/commit-message-agent-spec'
import type { RpcResponse } from '../transport/types'
import {
  discoverClaudeModels,
  discoveredClaudeCatalogModels,
  hydrateDiscoveredClaudeModels,
  parseClaudeDiscovery,
  peekDiscoveredClaudeModels,
  resetClaudeDiscoveryForTests
} from './claude-model-discovery'

// Claude Code 2.1.282's `list_models` answer on a Bedrock host (2026-09-25),
// wrapped as the host wraps a probe. The wrapping is DERIVED from Orca
// ef428d879's `finalizeModelDiscoveryOutput`, not captured.
const STDOUT = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-list-models-2.1.282.jsonl', import.meta.url)),
  'utf8'
)
const MODELS = COMMIT_MESSAGE_AGENT_SPECS.claude!.modelDiscovery!.parse(STDOUT)
const PROBE = { success: true, models: MODELS, catalogOrigin: 'probe' }

function reply(result: unknown): RpcResponse {
  return { id: 'discovery', ok: true, result, _meta: { runtimeId: 'host' } }
}

beforeEach(async () => {
  resetClaudeDiscoveryForTests()
  await AsyncStorage.clear()
})

describe('the host\'s Claude model list is believed only when Claude Code gave it', () => {
  it('keeps each model\'s own levels and its fast mode', () => {
    const models = parseClaudeDiscovery(PROBE)!
    expect(models.map((model) => [model.id, model.effortLevels.join(',')])).toEqual([
      ['global.anthropic.claude-fable-5-1', 'low,medium,high,xhigh,max'],
      ['eu.anthropic.claude-sonnet-5', 'low,medium,high,xhigh,max'],
      ['eu.anthropic.claude-sonnet-4-6', 'low,medium,high,max'],
      ['eu.anthropic.claude-sonnet-4-6[1m]', 'low,medium,high,max'],
      ['opus', 'low,medium,high,xhigh,max'],
      ['haiku', ''],
      ['eu.anthropic.claude-opus-4-8[1m]', 'low,medium,high,xhigh,max'],
      ['eu.anthropic.claude-opus-5-5[1m]', 'low,medium,high,xhigh,max']
    ])
    expect(models.every((model) => !model.supportsFastMode)).toBe(true)
  })

  it('refuses the host\'s static fallback, which grants xhigh everywhere', () => {
    const spec = COMMIT_MESSAGE_AGENT_SPECS.claude!
    expect(parseClaudeDiscovery({ success: true, models: spec.models, catalogOrigin: 'spec' })).toBeNull()
    expect(parseClaudeDiscovery({ success: true, models: MODELS })).toBeNull()
  })

  it('refuses a failure, an empty list, and anything malformed', () => {
    expect(parseClaudeDiscovery({ success: false, error: 'Claude returned no available models.' })).toBeNull()
    expect(parseClaudeDiscovery({ success: true, models: [], catalogOrigin: 'probe' })).toBeNull()
    expect(parseClaudeDiscovery({ success: true, models: [{ id: '', label: 'x' }], catalogOrigin: 'probe' })).toBeNull()
    expect(parseClaudeDiscovery({ success: true, models: 'opus', catalogOrigin: 'probe' })).toBeNull()
    expect(parseClaudeDiscovery(null)).toBeNull()
    expect(parseClaudeDiscovery('opus')).toBeNull()
  })

  it('lists a one-model answer as one row', () => {
    const models = parseClaudeDiscovery({ success: true, models: [MODELS[0]], catalogOrigin: 'probe' })
    expect(models?.map((model) => model.id)).toEqual(['global.anthropic.claude-fable-5-1'])
  })
})

describe('the rows drawn from the host\'s list', () => {
  it('apply a level mid-session with /effort and offer nothing the model lacks', () => {
    const rows = discoveredClaudeCatalogModels(parseClaudeDiscovery(PROBE)!)
    const sonnet46 = rows.find((row) => row.id === 'eu.anthropic.claude-sonnet-4-6')!
    const effort = sonnet46.options.find((option) => option.id === 'effort')!
    expect(effort.kind.type === 'select' ? effort.kind.choices.map((choice) => choice.value) : null).toEqual([
      'low',
      'medium',
      'high',
      'max'
    ])
    const midSession = effort.apply.midSession
    expect(midSession?.kind === 'command' ? midSession.build('max') : null).toBe('/effort max')
    expect(sonnet46.options.map((option) => option.id)).toEqual(['effort'])
  })

  it('give a model with no effort levels no effort row', () => {
    const haiku = discoveredClaudeCatalogModels(parseClaudeDiscovery(PROBE)!).find((row) => row.id === 'haiku')!
    expect(haiku.options).toEqual([])
  })

  it('offer fast mode only on a model Claude Code says has it', () => {
    const [row] = discoveredClaudeCatalogModels([
      { id: 'opus', label: 'Opus', effortLevels: ['high'], supportsFastMode: true }
    ])
    expect(row!.options.map((option) => option.id)).toEqual(['effort', 'fastMode'])
  })

  it('are empty for an empty list', () => {
    expect(discoveredClaudeCatalogModels([])).toEqual([])
  })
})

describe('asking the host', () => {
  it('asks once per host and worktree, and answers the next ask from memory', async () => {
    const sendRequest = vi.fn(async () => reply(PROBE))
    const [first, second] = await Promise.all([
      discoverClaudeModels({ client: { sendRequest }, hostId: 'h', worktreeId: 'w' }),
      discoverClaudeModels({ client: { sendRequest }, hostId: 'h', worktreeId: 'w' })
    ])
    expect(first).toHaveLength(8)
    expect(second).toBe(first)
    await discoverClaudeModels({ client: { sendRequest }, hostId: 'h', worktreeId: 'w' })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await discoverClaudeModels({ client: { sendRequest }, hostId: 'h', worktreeId: 'other' })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('does not remember a failure, so the next connection asks again', async () => {
    const sendRequest = vi
      .fn<() => Promise<RpcResponse>>()
      .mockRejectedValueOnce(new Error('relay still dialling'))
      .mockResolvedValueOnce(reply({ success: false, error: 'no models' }))
      .mockResolvedValueOnce(reply(PROBE))
    const client = { sendRequest }
    expect(await discoverClaudeModels({ client, hostId: 'h', worktreeId: 'w' })).toBeNull()
    expect(await discoverClaudeModels({ client, hostId: 'h', worktreeId: 'w' })).toBeNull()
    expect(peekDiscoveredClaudeModels('h', 'w')).toBeNull()
    expect(await discoverClaudeModels({ client, hostId: 'h', worktreeId: 'w' })).toHaveLength(8)
    expect(sendRequest).toHaveBeenCalledTimes(3)
  })

  it('keeps the last list for a cold start, and nothing from a failed ask', async () => {
    const failing = { sendRequest: vi.fn(async () => reply({ success: false, error: 'no models' })) }
    await discoverClaudeModels({ client: failing, hostId: 'h', worktreeId: 'w' })
    resetClaudeDiscoveryForTests()
    await hydrateDiscoveredClaudeModels('h', 'w')
    expect(peekDiscoveredClaudeModels('h', 'w')).toBeNull()

    await discoverClaudeModels({ client: { sendRequest: vi.fn(async () => reply(PROBE)) }, hostId: 'h', worktreeId: 'w' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    resetClaudeDiscoveryForTests()
    expect(peekDiscoveredClaudeModels('h', 'w')).toBeNull()
    await hydrateDiscoveredClaudeModels('h', 'w')
    expect(peekDiscoveredClaudeModels('h', 'w')?.map((model) => model.id)).toEqual(MODELS.map((model) => model.id))
  })

  it('starts cold, without a list, when the stored copy is unreadable', async () => {
    const key = `orca:codexModels:claude-discovered:${encodeURIComponent('h\0w')}`
    await AsyncStorage.setItem(key, JSON.stringify([{ id: 'opus', label: 'Opus', effortLevels: [], supportsFastMode: false }]))
    await hydrateDiscoveredClaudeModels('h', 'w')
    expect(peekDiscoveredClaudeModels('h', 'w')?.map((model) => model.id)).toEqual(['opus'])
    resetClaudeDiscoveryForTests()
    await AsyncStorage.setItem(key, '[{"id":1}]')
    await hydrateDiscoveredClaudeModels('h', 'w')
    expect(peekDiscoveredClaudeModels('h', 'w')).toBeNull()
    const getItem = vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'))
    await hydrateDiscoveredClaudeModels('h', 'x')
    expect(peekDiscoveredClaudeModels('h', 'x')).toBeNull()
    getItem.mockRestore()
  })
})
