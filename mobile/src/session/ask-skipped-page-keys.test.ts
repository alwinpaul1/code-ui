import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCodexAskAnswerKeys,
  formatAskAnswer,
  type AskAnswerSelection,
  type AskPrompt
} from '../../../src/shared/native-chat-ask'
import type { AgentType } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'
import { ASK_NO_PREFERENCE, buildClaudeAskAnswerKeys } from './ask-skipped-pages'

// Review of f00febd4a (2026-10-16): Skip made a partly answered card reachable,
// and with it the key builders' unanswered-page branches, which nothing tested.
// What each agent is sent for a skipped page:
//
// - Claude Code: no screen of its review step with a question left unanswered
//   has been captured, so what that step highlights, and whether one Enter
//   submits there, is unknown. Rather than guess at it, a skipped page is
//   answered with the Claude app's own words for one, "[No preference]"
//   (t52.java:83,97), typed through the "Type something" row like any typed
//   answer. Every page then has an answer, which is the review step the
//   2.1.282 two-question screens pin (claude-ask-answer-keys-screens.test.ts):
//   "Submit answers" highlighted, one Enter. Unverified: a typed answer's own
//   keys (row number, text, Enter) are not on a captured screen either; they are
//   the same keys every typed answer already uses.
// - Codex: the vendored builder's skip path, kept as Orca wrote it (Backspace,
//   then Right to the next question or Enter on the last, and one Enter for the
//   confirmation it says Codex opens). Not checked against a Codex screen here.
// - Pasted-label agents (Grok, OMP): one line per question, a skipped one empty.

const THREE: AskPrompt = {
  questions: [
    { question: 'q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
    { question: 'q2', multiSelect: false, options: [{ label: 'C' }, { label: 'D' }] },
    { question: 'q3', multiSelect: false, options: [{ label: 'E' }, { label: 'F' }] }
  ]
}
const WITH_MULTI: AskPrompt = {
  questions: [
    { question: 'q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
    { question: 'q2', multiSelect: true, options: [{ label: 'C' }, { label: 'D' }, { label: 'E' }] }
  ]
}
const SKIPPED_MIDDLE: AskAnswerSelection[] = [{ indices: [1] }, { indices: [] }, { indices: [0] }]

function acceptedResponse() {
  return { id: 'send', ok: true as const, result: { send: { accepted: true } }, _meta: { runtimeId: 'runtime' } }
}

describe('what a skipped page sends', () => {
  let renderer: ReactTestRenderer | null = null
  let answerSend: ReturnType<typeof useMobileNativeChatAnswerSend> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    answerSend = null
    vi.useRealTimers()
  })

  async function sent(agent: AgentType, prompt: AskPrompt, selections: AskAnswerSelection[]): Promise<unknown[]> {
    const sendRequest = vi.fn().mockResolvedValue(acceptedResponse())
    const client = { sendRequest } as unknown as RpcClient
    function Harness(): null {
      answerSend = useMobileNativeChatAnswerSend({
        client,
        enabled: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: 'device' },
        agentRef: { current: agent },
        sessionId: 'session',
        streamIdentity: 'host\0worktree\0tab\0session',
        onSendError: vi.fn()
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    let result: Promise<boolean> | undefined
    await act(async () => {
      result = answerSend?.answerAsk(prompt, selections)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    await expect(result).resolves.toBe(true)
    return sendRequest.mock.calls.map((call) => {
      const params = call[1] as { text: string; enter: boolean }
      return { text: params.text, enter: params.enter }
    })
  }

  it('answers a skipped Claude page "[No preference]" through its typed row, so the review step has every answer', async () => {
    expect(await sent('claude', THREE, SKIPPED_MIDDLE)).toEqual([
      { text: '2', enter: false },
      { text: '3', enter: false },
      { text: ASK_NO_PREFERENCE, enter: false },
      { text: '\r', enter: false },
      { text: '1', enter: false },
      { text: '\r', enter: false }
    ])
  })

  it('answers a skipped Claude multi-select page the same way, then steps on', () => {
    expect(buildClaudeAskAnswerKeys(WITH_MULTI, [{ indices: [0] }, { indices: [] }])).toEqual([
      { raw: '1' },
      { raw: '4' },
      { text: ASK_NO_PREFERENCE },
      { raw: '\r' },
      { raw: '\x1b[C' },
      { raw: '\r' }
    ])
  })

  it('leaves a Claude card with nothing answered empty, for the send to refuse', () => {
    expect(buildClaudeAskAnswerKeys(THREE, [{ indices: [] }, { indices: [] }, { indices: [] }])).toEqual([])
  })

  it('leaves a lone Claude question as it was: a single page is never skipped into an answer', () => {
    const one: AskPrompt = { questions: [THREE.questions[0]!] }
    expect(buildClaudeAskAnswerKeys(one, [{ indices: [1] }])).toEqual([{ raw: '2' }])
    expect(buildClaudeAskAnswerKeys(one, [{ indices: [] }])).toEqual([])
  })

  it('steps a skipped Codex page with its own skip keys and confirms once', async () => {
    const plan = buildCodexAskAnswerKeys(THREE, SKIPPED_MIDDLE)
    expect(plan).toEqual([{ raw: '2' }, { raw: '\x7f' }, { raw: '\x1b[C' }, { raw: '1' }, { raw: '\r' }])
    expect(await sent('codex', THREE, SKIPPED_MIDDLE)).toEqual(
      plan.map((group) => ({ text: 'raw' in group ? group.raw : group.text, enter: false }))
    )
  })

  it('ends a Codex answer whose last page is skipped on Enter, then the confirmation Enter', () => {
    expect(buildCodexAskAnswerKeys(THREE, [{ indices: [0] }, { indices: [1] }, { indices: [] }])).toEqual([
      { raw: '1' },
      { raw: '2' },
      { raw: '\x7f' },
      { raw: '\r' },
      { raw: '\r' }
    ])
  })

  it('pastes a skipped page as an empty line for a pasted-label agent', async () => {
    expect(formatAskAnswer(THREE, SKIPPED_MIDDLE)).toBe('B\n\nE')
    expect(await sent('grok', THREE, SKIPPED_MIDDLE)).toEqual([{ text: 'B\n\nE', enter: true }])
  })
})
