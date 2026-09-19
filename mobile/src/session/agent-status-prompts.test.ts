import { describe, expect, it } from 'vitest'
import { AGENT_STATUS_MAX_FIELD_LENGTH } from '../../../src/shared/agent-status-field-normalization'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'

// 2026-09-19: the user wanted the transcript-tail terminal off their desktop
// and asked whether the transcript could be read live without it. Orca's own
// hooks already tell the runtime every prompt a session takes, and the tab
// snapshot the phone subscribes to carries it as `agentStatus.prompt`. Read on
// this machine for a hand-started session while its agent was working:
const LIVE = {
  state: 'working',
  agentType: 'claude',
  updatedAt: 1789823360008,
  stateStartedAt: 1789823300000,
  prompt: 'without keeping transcript tab open cant we read the transcript live'
}

describe('desktop prompts read off the tab status', () => {
  it('turns the prompt a hand-started session just took into a desktop prompt, at its time', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', LIVE)
    expect(state.prompts).toEqual([
      {
        nonce: expect.stringMatching(/^status:sess-1:1789823360008:0$/),
        text: LIVE.prompt,
        at: 1789823360008
      }
    ])
  })

  it('does not repeat a prompt that later tool pings keep carrying', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', LIVE)
    state = observeAgentStatusPrompt(state, 'sess-1', { ...LIVE, updatedAt: LIVE.updatedAt + 5000 })
    state = observeAgentStatusPrompt(state, 'sess-1', { ...LIVE, updatedAt: LIVE.updatedAt + 9000 })
    expect(state.prompts).toHaveLength(1)
  })

  it('adds the next prompt, from whichever client sent it', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', LIVE)
    state = observeAgentStatusPrompt(state, 'sess-1', {
      ...LIVE,
      updatedAt: LIVE.updatedAt + 60_000,
      prompt: 'also see thos queued messages and thiis send now fix the stale queued messages'
    })
    expect(state.prompts.map((p) => p.text)).toEqual([
      LIVE.prompt,
      'also see thos queued messages and thiis send now fix the stale queued messages'
    ])
    expect(state.prompts[1]!.at).toBe(LIVE.updatedAt + 60_000)
  })

  it('starts over for another session, and forgets nothing for a status blip', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', LIVE)
    state = observeAgentStatusPrompt(state, 'sess-1', null)
    expect(state.prompts).toHaveLength(1)
    // The same text after a reset is a new submission.
    state = observeAgentStatusPrompt(state, 'sess-1', LIVE)
    expect(state.prompts).toHaveLength(2)
    state = observeAgentStatusPrompt(state, 'sess-2', { ...LIVE, prompt: 'new session' })
    expect(state.prompts.map((p) => p.text)).toEqual(['new session'])
    expect(observeAgentStatusPrompt(state, null, LIVE).prompts).toEqual([])
  })

  it('marks a prompt the hook cut at its field cap, and says nothing for an empty one', () => {
    const long = 'x'.repeat(AGENT_STATUS_MAX_FIELD_LENGTH)
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: long })
    expect(state.prompts[0]).toMatchObject({ text: long, cut: true })
    expect(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: '' }).prompts).toEqual([])
    expect(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: '   ' }).prompts).toEqual([])
    expect(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', undefined).prompts).toEqual([])
  })

  it('keeps a bounded tail of prompts', () => {
    let state = EMPTY_AGENT_STATUS_PROMPTS
    for (let i = 0; i < 100; i += 1) {
      state = observeAgentStatusPrompt(state, 'sess-1', { ...LIVE, updatedAt: i, prompt: `prompt ${i}` })
    }
    expect(state.prompts).toHaveLength(64)
    expect(state.prompts[0]!.text).toBe('prompt 36')
  })
})
