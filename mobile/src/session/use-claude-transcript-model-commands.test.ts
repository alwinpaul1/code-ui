import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))

import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { resetSessionCommandPairCacheForTests } from './claude-session-command-pair'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { clearPendingModelPicksForTests, notePendingModelPick } from './mobile-native-chat-model-report-authority'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { resetClaudeTranscriptModelPicksForTests, useClaudeTranscriptModel } from './use-claude-transcript-model'

let clock = 0
const msg = (role: 'user' | 'assistant', body: string): NativeChatMessage => ({
  id: `m${(clock += 1)}`,
  role,
  blocks: [{ type: 'text', text: body }],
  timestamp: clock * 1000,
  source: 'transcript'
})
const ran = (name: string, body: string): NativeChatMessage[] => [
  msg('user', `<command-name>/${name}</command-name>\n<command-args></command-args>`),
  msg('user', `<local-command-stdout>${body}</local-command-stdout>`)
]
const SCOPE = mobileNativeChatScopeKey('h', 'w', 't')!

describe('a Claude chat with no live pair, with its own /model output in the rows', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: ClaudeModelFallback | null = null
  beforeEach(() => {
    resetSessionCommandPairCacheForTests()
    resetClaudeTranscriptModelPicksForTests()
    clearPendingModelPicksForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  function Harness(p: { sessionId?: string; liveModel?: string | null; beacon?: boolean; messages?: NativeChatMessage[] }) {
    latest = useClaudeTranscriptModel({
      client: null,
      hostId: 'h',
      worktreeId: 'w',
      tabId: 't',
      sessionId: p.sessionId ?? 's-1',
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
      if (renderer) {
        renderer.update(createElement(Harness, p))
      } else {
        renderer = create(createElement(Harness, p))
      }
    })

  it('shows the model a /model picked with its effort, as 2.1.289 words it, with no scan and no beacon', () => {
    render({ messages: ran('model', 'Set model to `Opus 5.5` for this session only with `high` effort') })
    expect(latest).toMatchObject({ kind: 'transcript', model: { model: 'claude-opus-5-5', label: 'Opus 5.5' }, effort: 'high' })
  })

  it('shows nothing for a session that has said nothing: a new session before its first prompt', () => {
    render({ messages: [] })
    expect(latest).toEqual({ kind: 'none' })
  })

  it('a live model beats the session command', () => {
    render({ liveModel: 'claude-fable-5-1', messages: ran('model', 'Set model to `Opus 5.5` for this session only') })
    expect(latest).toEqual({ kind: 'none' })
  })

  it('a heard beacon beats it too, even one that states no model', () => {
    render({ beacon: true, messages: ran('model', 'Set model to `Opus 5.5` for this session only') })
    expect(latest).toEqual({ kind: 'none' })
  })

  // Review of c91134b9a, finding 3: ~40 rows are loaded and a reconnect replaces them.
  it('keeps the pair when a reconnect replaces the loaded rows with ones that no longer hold the command', () => {
    render({ messages: ran('effort', 'Set effort level to high (this session only): Deep') })
    expect(latest).toEqual({ kind: 'none' })
    render({ messages: ran('model', 'Set model to `Opus 5.5` for this session only with `high` effort') })
    render({ messages: [msg('assistant', 'a reply, much later')] })
    expect(latest).toMatchObject({ model: { model: 'claude-opus-5-5' }, effort: 'high' })
  })

  // Review of c91134b9a, finding 7: the 2026-09-18 rule.
  it('shows nothing while the phone’s own pick is unconfirmed, and does not let an older row bring a figure back', () => {
    notePendingModelPick(SCOPE, 'claude-fable-5-1', null)
    render({ messages: ran('model', 'Set model to `Opus 5.5` for this session only with `high` effort') })
    expect(latest).toEqual({ kind: 'none' })
  })
})
