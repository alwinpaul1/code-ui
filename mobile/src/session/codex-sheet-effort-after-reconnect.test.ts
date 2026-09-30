import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { writeCodexModelList } from '../storage/codex-model-lists'
import { resetCodexDiscoveryForTests } from './codex-model-discovery'
import { codexVisibleModelsKey, resetCodexVisibleModelsForTests } from './codex-visible-models'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import {
  clearMobileSessionOptionRecordsForTests,
  resetMobileNativeChatSessionOptionRecordsForTests
} from './use-mobile-native-chat-session-options'

// A Codex tab opened while the relay was still dialling asked the host for its
// models (`codex debug models`), the request failed, and nothing asked again
// once the host connected: the discovery effect's deps were the client, host,
// worktree and agent, none of which move on a connect. With no list persisted
// from an earlier run, every model row had no effort levels, and the sheet had
// no effort control until the tab was reopened (review, 2026-09-30). The repo
// rule: nothing stays stale once the relay connects.

let lastConnectedAt: number | null = 1
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => lastConnectedAt
}))

// The host's answer for agentId 'codex', captured 2026-09-05
// (codex-model-discovery.test.ts), cut to one model.
const DISCOVERY = {
  success: true,
  capability: { id: 'codex' },
  defaultModelId: 'gpt-6-astra',
  catalogOrigin: 'probe',
  models: [
    {
      id: 'gpt-6-astra',
      label: 'GPT-6-Astra',
      thinkingLevels: [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' }
      ],
      defaultThinkingLevel: 'medium',
      isDefault: true
    }
  ]
}

const HOST = 'host-a'
const WORKTREE = 'wt-1'
let hostUp = false
let snapshot: SessionOptionDescriptor[] = []
let renderer: ReactTestRenderer | undefined
const sendRequest = vi.fn(async (method: string): Promise<RpcResponse> => {
  if (method !== 'git.discoverCommitMessageModels') {
    return { id: method, ok: false, error: { code: 'unexpected', message: method } }
  }
  return hostUp
    ? { id: 'discovery', ok: true, result: DISCOVERY }
    : { id: 'discovery', ok: false, error: { code: 'not_connected', message: 'relay is dialling' } }
})
const client = { sendRequest } as unknown as RpcClient

function Probe(): null {
  const { nativeChatSessionOptions } = useMobileNativeChatSessionOptionController({
    activeChatStructured: false,
    activeSessionTabId: 'tab-1',
    agent: 'codex',
    dispatchCommand: async () => 'accepted',
    hostId: HOST,
    isTabChatView: () => true,
    isWorking: false,
    reportedModel: 'gpt-6-astra',
    reportedModelSource: 'live',
    terminalHandle: 'term-1',
    structured: { snapshot: [], pendingId: null, setOption: async () => false, invokeAction: async () => false },
    toggleTabChatView: () => {},
    worktreeId: WORKTREE,
    client,
    handleRef: { current: 'term-1' },
    deviceTokenRef: { current: null },
    refreshHud: async () => undefined,
    onFailure: () => {}
  })
  snapshot = nativeChatSessionOptions?.controller.snapshot ?? []
  return null
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render(): Promise<void> {
  await act(async () => {
    if (renderer) {
      renderer.update(createElement(Probe))
    } else {
      renderer = create(createElement(Probe))
    }
  })
  await settle()
}

function discoveryRequests(): number {
  return sendRequest.mock.calls.filter(([method]) => method === 'git.discoverCommitMessageModels').length
}

function effortLabels(): string[] {
  const effort = snapshot.find((row) => row.id === 'effort')
  return effort?.kind.type === 'select' ? effort.kind.choices.map((choice) => choice.label) : []
}

beforeEach(async () => {
  resetMobileNativeChatSessionOptionRecordsForTests()
  clearMobileSessionOptionRecordsForTests()
  resetCodexDiscoveryForTests()
  resetCodexVisibleModelsForTests()
  await AsyncStorage.clear()
  // The picker's rows are known from an earlier read; the probe's levels are not.
  await writeCodexModelList('visible', codexVisibleModelsKey(HOST, WORKTREE), [
    { slug: 'gpt-6-astra', description: 'Our most capable model', isDefault: true, isCurrent: true }
  ])
  sendRequest.mockClear()
  lastConnectedAt = 1
  hostUp = false
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

describe('the Codex sheet after the relay connects', () => {
  it('asks for the models again once the host connects, and shows their effort levels', async () => {
    await render()
    expect(discoveryRequests()).toBe(1)
    expect(snapshot.some((row) => row.id === 'model')).toBe(true)
    expect(effortLabels()).toEqual([])

    hostUp = true
    lastConnectedAt = 2
    await render()
    expect(discoveryRequests()).toBe(2)
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High'])
  })

  it('does not ask again while the connection is the same, however often it renders', async () => {
    await render()
    await render()
    await render()
    expect(discoveryRequests()).toBe(1)
  })

  it('asks once per new connection while the host keeps failing', async () => {
    await render()
    lastConnectedAt = 2
    await render()
    await render()
    expect(discoveryRequests()).toBe(2)
  })

  it('answers the next connection from memory once a discovery has landed', async () => {
    hostUp = true
    await render()
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High'])
    lastConnectedAt = 2
    await render()
    expect(discoveryRequests()).toBe(1)
    expect(effortLabels()).toEqual(['Low', 'Medium', 'High'])
  })
})
