import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { COMMIT_MESSAGE_AGENT_SPECS, type CommitMessageModel } from '../../../src/shared/commit-message-agent-spec'
import { CLAUDE_THINKING_LEVELS } from '../../../src/shared/commit-message-model-parsers'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import {
  clearMobileSessionOptionRecordsForTests,
  resetMobileNativeChatSessionOptionRecordsForTests
} from './use-mobile-native-chat-session-options'
import { resetClaudeDiscoveryForTests } from './claude-model-discovery'
import type * as CodexOptions from './use-codex-native-chat-options'
import type { CatalogOptionApply } from '../../../src/shared/agent-session-option-catalog-types'

let lastConnectedAt: number | null = 1
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => lastConnectedAt
}))

// The Codex hook clears its list in an effect, so for the render after a tab
// turns from Codex to Claude it still hands back Codex's model apply. This
// holds that render open.
let heldCodexApply: CatalogOptionApply | null = null
vi.mock('./use-codex-native-chat-options', async (importOriginal) => {
  const actual = await importOriginal<typeof CodexOptions>()
  return {
    ...actual,
    useCodexNativeChatOptions: (...args: Parameters<typeof actual.useCodexNativeChatOptions>) => {
      const result = actual.useCodexNativeChatOptions(...args)
      return heldCodexApply ? { ...result, discoveredModelApply: heldCodexApply } : result
    }
  }
})

// Captured 2026-09-25 from Claude Code 2.1.282 on a Bedrock host: the stdout of
// the `list_models` control request Orca's host sends it
// (`claude -p --input-format stream-json --output-format stream-json --verbose`),
// hooks and all. The second capture is the same host with
// ANTHROPIC_DEFAULT_OPUS_MODEL=eu.anthropic.claude-opus-4-6, so Claude Code's
// own answer for Opus 4.6 is on record: low, medium, high, max. No xhigh.
function capture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}
const BEDROCK_LIST = capture('claude-list-models-2.1.282.jsonl')
const OPUS_4_6_LIST = capture('claude-list-models-opus-4-6-2.1.282.jsonl')

// The host's answer to `git.discoverCommitMessageModels` with agentId 'claude'.
// DERIVED, not captured: built the way Orca's `finalizeModelDiscoveryOutput`
// (src/main/text-generation/commit-message-model-discovery-policy.ts, Orca
// ef428d879) wraps a probe — the Claude spec's own `parseClaudeModels` over the
// real stdout above, the spec's default when listed or else the first model,
// and `catalogOrigin: 'probe'`.
function hostResult(
  stdout: string,
  edit: (model: CommitMessageModel) => CommitMessageModel = (model) => model
): Record<string, unknown> {
  const spec = COMMIT_MESSAGE_AGENT_SPECS.claude!
  const models = spec.modelDiscovery!.parse(stdout).map(edit)
  const defaultModelId = models.some((model) => model.id === spec.defaultModelId)
    ? spec.defaultModelId
    : models[0]!.id
  const capability = { id: spec.id, label: spec.label, modelSource: spec.modelSource, defaultModelId, models }
  return { success: true, capability, models, defaultModelId, catalogOrigin: 'probe' }
}

// What the same host answers when the probe parses nothing (an older CLI): its
// static spec, which gives `opus` and `sonnet` every level, xhigh included.
function staticFallback(): Record<string, unknown> {
  const spec = COMMIT_MESSAGE_AGENT_SPECS.claude!
  const capability = { id: spec.id, label: spec.label, modelSource: spec.modelSource, defaultModelId: spec.defaultModelId, models: spec.models }
  return { success: true, capability, models: spec.models, defaultModelId: spec.defaultModelId, catalogOrigin: 'spec' }
}

function reply(result: unknown): RpcResponse {
  return { id: 'discovery', ok: true, result, _meta: { runtimeId: 'host' } }
}

type Report = { model: string | null; label?: string | null }
let report: Report = { model: null }
let client: RpcClient | null = null
let snapshot: SessionOptionDescriptor[] = []
let setOption: ((id: string, value: string) => Promise<boolean>) | null = null
let dispatched: string[] = []
let renderer: { unmount: () => void; update: (element: ReturnType<typeof createElement>) => void } | undefined

function Probe(): null {
  const { nativeChatSessionOptions } = useMobileNativeChatSessionOptionController({
    activeChatStructured: false,
    activeSessionTabId: 'tab-1',
    agent: 'claude',
    dispatchCommand: async (command) => {
      dispatched.push(command)
      return 'accepted'
    },
    hostId: 'host-a',
    isTabChatView: () => true,
    isWorking: false,
    reportedModel: report.model,
    reportedModelLabel: report.label ?? null,
    reportedModelSource: 'live',
    terminalHandle: 'term-1',
    structured: {
      snapshot: [],
      pendingId: null,
      setOption: async () => false,
      invokeAction: async () => false
    },
    toggleTabChatView: () => {},
    worktreeId: 'wt-1',
    client,
    handleRef: { current: 'term-1' },
    deviceTokenRef: { current: null },
    refreshHud: async () => undefined,
    onFailure: () => {}
  })
  snapshot = nativeChatSessionOptions?.controller.snapshot ?? []
  setOption = nativeChatSessionOptions?.controller.setOption ?? null
  return null
}

function fakeClient(answer: () => Promise<RpcResponse>): { client: RpcClient; sendRequest: ReturnType<typeof vi.fn> } {
  const sendRequest = vi.fn(answer)
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

async function mount(next: Report, rpc: RpcClient | null): Promise<void> {
  report = next
  client = rpc
  await act(async () => {
    renderer = create(createElement(Probe))
  })
  // The discovery reply, then the persisted-list read, settle on later ticks.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function rerender(next: Report): Promise<void> {
  report = next
  await act(async () => {
    renderer?.update(createElement(Probe))
  })
}

function modelIds(): string[] {
  const model = snapshot.find((row) => row.id === 'model')
  return model?.kind.type === 'select' ? model.kind.choices.map((choice) => String(choice.value)) : []
}

function currentModel(): string | undefined {
  const model = snapshot.find((row) => row.id === 'model')
  return model?.kind.type === 'select' ? model.kind.currentValue : undefined
}

function effortLabels(): string[] {
  const effort = snapshot.find((row) => row.id === 'effort')
  return effort?.kind.type === 'select' ? effort.kind.choices.map((choice) => choice.label) : []
}

const SEED_IDS = ['fable', 'opus', 'sonnet', 'haiku']

beforeEach(async () => {
  resetMobileNativeChatSessionOptionRecordsForTests()
  clearMobileSessionOptionRecordsForTests()
  resetClaudeDiscoveryForTests()
  await AsyncStorage.clear()
  lastConnectedAt = 1
  report = { model: null }
  client = null
  heldCodexApply = null
  dispatched = []
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

// 2026-09-25, the user: Opus 4.6 and Sonnet show no Ultracode in the Claude
// app, yet Code UI offered Extra and Ultracode on them. The phone never asked
// the host which models Claude has, so every sheet was Orca's static seed, whose
// `opus` and `sonnet` aliases carry xhigh on every host.
describe('the Claude sheet lists the effort levels the host says each model has', () => {
  it('asks the host for Claude\'s own model list', async () => {
    const { client: rpc, sendRequest } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'eu.anthropic.claude-opus-5-5[1m]', label: 'Opus 5.5 (1M context)' }, rpc)
    // The host gives Claude Code 60 s to answer (Orca ef428d879's
    // SOURCE_CONTROL_GENERATION_TIMEOUT_MS), so the phone waits past that
    // rather than its 30 s RPC default.
    expect(sendRequest).toHaveBeenCalledWith(
      'git.discoverCommitMessageModels',
      { worktree: 'id:wt-1', agentId: 'claude' },
      { timeoutMs: 65_000 }
    )
    expect(modelIds()).toEqual([
      'global.anthropic.claude-fable-5-1',
      'eu.anthropic.claude-sonnet-5',
      'eu.anthropic.claude-sonnet-4-6',
      'eu.anthropic.claude-sonnet-4-6[1m]',
      'opus',
      'haiku',
      'eu.anthropic.claude-opus-4-8[1m]',
      'eu.anthropic.claude-opus-5-5[1m]'
    ])
  })

  it('offers no Extra and no Ultracode on a session running Sonnet 4.6', async () => {
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'eu.anthropic.claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' }, rpc)
    expect(currentModel()).toBe('eu.anthropic.claude-sonnet-4-6[1m]')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('offers no Extra and no Ultracode on a session running Opus 4.6', async () => {
    const { client: rpc } = fakeClient(async () => reply(hostResult(OPUS_4_6_LIST)))
    await mount({ model: 'eu.anthropic.claude-opus-4-6', label: 'Opus 4.6' }, rpc)
    // The host's list, not the seed: `opus` here is the row Claude Code itself
    // labels "Opus 4.6" and gives low/medium/high/max.
    expect(modelIds()).toEqual([
      'global.anthropic.claude-fable-5-1',
      'eu.anthropic.claude-sonnet-5',
      'eu.anthropic.claude-sonnet-4-6',
      'eu.anthropic.claude-sonnet-4-6[1m]',
      'opus',
      'haiku',
      'eu.anthropic.claude-opus-4-8[1m]',
      'eu.anthropic.claude-opus-5-5[1m]'
    ])
    expect(currentModel()).toBe('opus')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('believes the host when its own list gives Opus 4.6 Extra', async () => {
    // Claude Code checks the user's capability overrides before its tables, so
    // a host can list the Opus 4.6 row with xhigh. DERIVED from the Opus 4.6
    // capture with that one row's levels widened: the host's answer is about
    // exactly the model that runs, and the table must not overrule it.
    const widened = (model: CommitMessageModel): CommitMessageModel =>
      model.id === 'opus' ? { ...model, thinkingLevels: CLAUDE_THINKING_LEVELS } : model
    const { client: rpc } = fakeClient(async () => reply(hostResult(OPUS_4_6_LIST, widened)))
    await mount({ model: 'eu.anthropic.claude-opus-4-6', label: 'Opus 4.6' }, rpc)
    expect(currentModel()).toBe('opus')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Extra', 'Max', 'Ultracode'])
  })

  it('offers Extra and Ultracode on Opus 5.5 and on Fable', async () => {
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'eu.anthropic.claude-opus-5-5[1m]', label: 'Opus 5.5 (1M context)' }, rpc)
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Extra', 'Max', 'Ultracode'])
    await rerender({ model: 'global.anthropic.claude-fable-5-1', label: 'Fable' })
    expect(currentModel()).toBe('global.anthropic.claude-fable-5-1')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Extra', 'Max', 'Ultracode'])
  })

  it('keeps the seed when the host refuses, fails, or only has its static list', async () => {
    const answers: Array<() => Promise<RpcResponse>> = [
      async () => reply({ success: false, error: 'Claude returned no available models.' }),
      async () => reply(staticFallback()),
      async () => reply({ success: true, models: [], catalogOrigin: 'probe' }),
      async () => ({ id: 'discovery', ok: false, error: { code: 'method_not_found', message: 'nope' }, _meta: { runtimeId: 'host' } }) as RpcResponse,
      async () => {
        throw new Error('socket closed')
      }
    ]
    for (const answer of answers) {
      resetClaudeDiscoveryForTests()
      const { client: rpc, sendRequest } = fakeClient(answer)
      await mount({ model: 'eu.anthropic.claude-opus-5-5[1m]', label: 'Opus 5.5 (1M context)' }, rpc)
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(modelIds()).toEqual(SEED_IDS)
      act(() => renderer?.unmount())
      renderer = undefined
    }
  })

  it('asks again on the next connection after a failed discovery, and not before', async () => {
    let answer: () => Promise<RpcResponse> = async () => {
      throw new Error('relay still dialling')
    }
    const { client: rpc, sendRequest } = fakeClient(() => answer())
    await mount({ model: 'eu.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6' }, rpc)
    expect(modelIds()).toEqual(SEED_IDS)
    await rerender({ model: 'eu.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6' })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    answer = async () => reply(hostResult(BEDROCK_LIST))
    lastConnectedAt = 2
    await rerender({ model: 'eu.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(currentModel()).toBe('eu.anthropic.claude-sonnet-4-6')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('switches a host-listed model with Claude\'s own /model, whatever the Codex hook still holds', async () => {
    heldCodexApply = { midSession: { kind: 'command', build: (value) => `/codex-model ${String(value)}` } }
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'eu.anthropic.claude-opus-5-5[1m]', label: 'Opus 5.5 (1M context)' }, rpc)
    await act(async () => {
      await setOption!('model', 'eu.anthropic.claude-sonnet-4-6')
    })
    expect(dispatched).toEqual(['/model eu.anthropic.claude-sonnet-4-6'])
  })
})

// Without a list from the host (an older host, a failed probe, the seconds
// before it lands) the sheet is the seed. The running model is still known from
// its beacon or badge, and Claude Code's own table says what it refuses.
describe('without a host list, the running model still offers only what Claude Code allows', () => {
  it('drops Extra and Ultracode from the Opus row while the session runs Opus 4.6', async () => {
    await mount({ model: 'claude-opus-4-6', label: 'Opus 4.6' }, null)
    expect(currentModel()).toBe('opus')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('drops them for a Bedrock Sonnet 4.6 with a 1M suffix', async () => {
    await mount({ model: 'eu.anthropic.claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' }, null)
    expect(currentModel()).toBe('sonnet')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('drops them when only the status-line badge names the model ("opus", "Opus 4.6")', async () => {
    await mount({ model: 'opus', label: 'Opus 4.6' }, null)
    expect(currentModel()).toBe('opus')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('keeps Extra and Ultracode on Opus 5.5', async () => {
    await mount({ model: 'eu.anthropic.claude-opus-5-5[1m]', label: 'Opus 5.5 (1M context)' }, null)
    expect(currentModel()).toBe('opus')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Extra', 'Max', 'Ultracode'])
  })

  it('strips a host-listed alias that the running Opus 4.6 folds onto', async () => {
    // The Bedrock list's `opus` is Opus 5.5 (xhigh). A session started on
    // `claude-opus-4-6` reports an id the list does not carry, and the matcher
    // folds it onto `opus`: the row it shows is not the model that runs.
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'claude-opus-4-6', label: 'Opus 4.6' }, rpc)
    expect(currentModel()).toBe('opus')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })
})

// The Bedrock list names Sonnet 4.6 only by its region id, so a session on the
// bare `claude-sonnet-4-6` id, or one the badge names only "sonnet", matches
// none of its rows by id. Claude Code's own canonical id says which row it is.
describe('a session whose id the host list does not carry verbatim', () => {
  const HOST_IDS = [
    'global.anthropic.claude-fable-5-1',
    'eu.anthropic.claude-sonnet-5',
    'eu.anthropic.claude-sonnet-4-6',
    'eu.anthropic.claude-sonnet-4-6[1m]',
    'opus',
    'haiku',
    'eu.anthropic.claude-opus-4-8[1m]',
    'eu.anthropic.claude-opus-5-5[1m]'
  ]

  it('sits on the host\'s Sonnet 4.6 row, not a stray "sonnet" row', async () => {
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }, rpc)
    expect(modelIds()).toEqual(HOST_IDS)
    expect(currentModel()).toBe('eu.anthropic.claude-sonnet-4-6')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('keeps a 1M session on the 1M row', async () => {
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' }, rpc)
    expect(modelIds()).toEqual(HOST_IDS)
    expect(currentModel()).toBe('eu.anthropic.claude-sonnet-4-6[1m]')
  })

  it('does not put a badge that says "Sonnet 4.6" on the Sonnet 5 row', async () => {
    // The badge id `sonnet` equals the label of the list's Sonnet 5 row.
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'sonnet', label: 'Sonnet 4.6' }, rpc)
    expect(currentModel()).toBe('eu.anthropic.claude-sonnet-4-6')
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  // No row is Sonnet 4.5. The sheet keeps the model it tracked before the list
  // landed and draws it with the catalog's fallback options, which carry every
  // level, so those are what the table cuts.
  it('offers no effort at all on Sonnet 4.5, which Claude Code gives none', async () => {
    const { client: rpc } = fakeClient(async () => reply(hostResult(BEDROCK_LIST)))
    await mount({ model: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' }, rpc)
    expect(effortLabels()).toEqual([])
  })
})
