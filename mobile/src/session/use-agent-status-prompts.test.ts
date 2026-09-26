import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import { useAgentStatusPrompts } from './use-agent-status-prompts'

// 2026-09-26, session 76ba8f2f: a finished turn's prompt read off the tab
// status sat under a later turn's answer, and nothing said why. A prompt the
// chat now holds back leaves one line in the log saying so, once.
const SESSION = '76ba8f2f-3727-4cbb-bfc4-3f09fba4d67b'
const DONE = {
  state: 'done',
  prompt: 'lets ask mahdi later u continue the work',
  updatedAt: Date.parse('2026-09-26T14:27:47.480Z'),
  stateStartedAt: Date.parse('2026-09-26T14:27:47.470Z'),
  stateHistory: [{ state: 'working', prompt: 'lets ask mahdi later u continue the work' }],
  providerSession: { id: SESSION }
}

function Probe({ status }: { status: AgentStatusPromptSource }) {
  useAgentStatusPrompts(SESSION, status, undefined)
  return null
}

describe('a desk prompt the chat holds back', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('says so in the log once, not on every render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    act(() => {
      renderer = create(createElement(Probe, { status: DONE }))
    })
    act(() => {
      renderer!.update(createElement(Probe, { status: { ...DONE, updatedAt: DONE.updatedAt + 60_000 } }))
    })
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(/^\[desk-prompt\] not drawn: .*"lets ask mahdi later u continue.*done/)
    ])
  })
})

// The beacon reports the same submission when the tab was launched with the
// prompt hook, and a copy of a prompt read before the chat looked can still be
// in its store (it keeps 40, and a relaunch restores them). The status copy
// used to win the merge; held back, it must not let the beacon's through,
// whose row is on a page not loaded and would wait for it at the tail.
describe('a desk prompt the chat holds back, that the beacon also carried', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('is not drawn from the beacon’s copy either', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const beacon = [{ nonce: '48213', text: DONE.prompt, anchorId: '8a3424c5-6eaa-4ca5-aad4-db36d49683fb' }]
    let listed: readonly { nonce: string; at?: number; heldBack?: true }[] = []
    function Merged() {
      listed = useAgentStatusPrompts(SESSION, DONE, beacon)
      return null
    }
    act(() => {
      renderer = create(createElement(Merged))
    })
    // Only the status's own copy, held back: untimed, and never drawn.
    expect(listed.map((prompt) => [prompt.nonce, prompt.at, prompt.heldBack])).toEqual([[`status:${SESSION}:x:0`, undefined, true]])
  })
})
