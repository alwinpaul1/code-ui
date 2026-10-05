import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))

import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { useClaudeTranscriptModel } from './use-claude-transcript-model'

const stdout = (body: string): NativeChatMessage => ({
  id: 'o',
  role: 'user',
  blocks: [{ type: 'text', text: `<local-command-stdout>${body}</local-command-stdout>` }],
  timestamp: 1,
  source: 'transcript'
})

describe('a Claude chat with no live pair, with its own /model output in the rows', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  function Harness(p: { liveModel?: string | null; beacon?: boolean; messages?: NativeChatMessage[] }) {
    latest = useClaudeTranscriptModel({
      client: null,
      hostId: 'h',
      worktreeId: 'w',
      tabId: 't',
      sessionId: 's-1',
      enabled: true,
      connected: false,
      liveModel: p.liveModel ?? null,
      beacon: p.beacon ?? false,
      agentWorking: false,
      messages: p.messages
    }).fallback
    return null
  }
  const render = (p: Parameters<typeof Harness>[0]) =>
    act(() => {
      renderer = create(createElement(Harness, p))
    })

  it('shows the model a /model picked with its effort, with no scan and no beacon', () => {
    render({ messages: [stdout('Set model to `Opus 5.5` for this session only with high effort')] })
    expect(latest).toEqual({
      kind: 'transcript',
      model: { model: 'claude-opus-5-5', label: 'Opus 5.5' },
      effort: 'high'
    })
  })

  it('shows nothing for a session that has said nothing: a new session before its first prompt', () => {
    render({ messages: [] })
    expect(latest).toEqual({ kind: 'none' })
  })

  it('a live model beats the session command', () => {
    render({ liveModel: 'claude-fable-5-1', messages: [stdout('Set model to `Opus 5.5` for this session only')] })
    expect(latest).toEqual({ kind: 'none' })
  })

  it('a heard beacon beats it too, even one that states no model', () => {
    render({ beacon: true, messages: [stdout('Set model to `Opus 5.5` for this session only')] })
    expect(latest).toEqual({ kind: 'none' })
  })
})
