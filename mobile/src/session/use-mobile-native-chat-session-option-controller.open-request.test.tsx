import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'

// The header menu's Change model asks the chat controller for the model sheet by raising a count
// (`openRequest`). The plain lane handed it to its picker; the structured lane (an agent session
// the phone drives over Orca's own session API) built its picker props without it, so on that lane
// the menu offered Change model, the tap did nothing, and nothing said why (found in review,
// 2026-10-14).

vi.mock('./use-codex-native-chat-options', () => ({
  useCodexNativeChatOptions: () => ({
    modelsPending: false,
    discoveredModels: null,
    discoveredModelApply: null,
    applyOverride: null
  })
}))
vi.mock('./use-mobile-omp-model-discovery', () => ({ useMobileOmpModelDiscovery: () => null }))
vi.mock('./use-claude-model-discovery', () => ({ useClaudeModelDiscovery: () => null }))
vi.mock('./use-mobile-native-chat-session-options', () => ({
  useMobileNativeChatSessionOptions: () => ({
    snapshot: [],
    pendingId: null,
    setOption: async () => true,
    invokeAction: async () => true,
    recordCommand: () => {}
  })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))

import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'

const MODEL: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: { type: 'select', currentValue: 'opus', choices: [{ value: 'opus', label: 'Opus' }] },
  valueSource: 'reported',
  transport: 'catalog',
  settable: true
}

let out: ReturnType<typeof useMobileNativeChatSessionOptionController> | null = null
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  out = null
})

function Harness(props: { structured: boolean; openRequest: number }) {
  out = useMobileNativeChatSessionOptionController({
    activeChatStructured: props.structured,
    activeSessionTabId: 'tab-1',
    agent: 'claude',
    dispatchCommand: async () => 'accepted',
    hostId: 'host',
    isTabChatView: () => true,
    isWorking: false,
    reportedModel: 'opus',
    openRequest: props.openRequest,
    structured: {
      snapshot: [MODEL],
      pendingId: null,
      setOption: async () => true,
      invokeAction: async () => true
    },
    toggleTabChatView: () => {},
    worktreeId: 'wt',
    client: null,
    handleRef: { current: null },
    deviceTokenRef: { current: null },
    refreshHud: async () => {},
    onFailure: () => {}
  })
  return null
}

function mount(props: Parameters<typeof Harness>[0]) {
  act(() => {
    renderer = create(createElement(Harness, props))
  })
  return out!.nativeChatSessionOptions
}

describe('the open request reaches the model picker', () => {
  it('on the structured lane, which draws the same sheet', () => {
    const options = mount({ structured: true, openRequest: 3 })
    expect(options?.controller.snapshot.some((descriptor) => descriptor.category === 'model')).toBe(true)
    expect(options?.openRequest).toBe(3)
  })
})
