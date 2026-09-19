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

// 2026-09-19, on the phone: the Code UI chat drew a user bubble that was never
// typed into it — `<pasted_content id="f750"> Third probe, first line.
// session:ok last line here </pasted_content id="f750">`. The agent had
// started a second `claude` in a tmux pane from its own Bash tool, whose
// environment carries the terminal's ORCA_PANE_KEY, hook port and token, so
// the nested session's hooks posted as this pane: the tab's `stateHistory`
// holds the nested prompts, and `providerSession.id` flipped to the nested
// session while it ran. The pane caches `prompt` across events, so when the
// parent's next hook flipped `providerSession` back, the row read
// providerSession=parent with the nested text still in `prompt`.
describe('a prompt posted on this pane by another session', () => {
  const PARENT = '7449d614-3e02-439b-8e71-5bed99eaf4f0'
  const NESTED = '3b1d0c52-8e7a-4a1e-9f0c-2b9d4a1e7c55'
  const parentText = "[Image #40] [Image #41] so the thing is that I uploaded the images from my mobile still it's showing the images around desktop"
  const nestedText =
    '<pasted_content id="f750"> [Image #37] Third probe, first line. session:ok last line here </pasted_content id="f750">'
  const row = (id: string, prompt: string, updatedAt: number) => ({
    state: 'working',
    updatedAt,
    prompt,
    providerSession: { key: 'session_id' as const, id }
  })

  it('is not drawn as this session\'s prompt when the row names the other session', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, PARENT, row(PARENT, parentText, 1))
    state = observeAgentStatusPrompt(state, PARENT, row(NESTED, nestedText, 2))
    expect(state.prompts.map((p) => p.text)).toEqual([parentText])
  })

  it('is not taken as new when the pane flips back to this session with the other session\'s prompt still cached', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, PARENT, row(PARENT, parentText, 1))
    // The intermediate row, seen: providerSession=nested.
    state = observeAgentStatusPrompt(state, PARENT, row(NESTED, nestedText, 2))
    // The parent's next tool ping: providerSession=parent, prompt cached.
    state = observeAgentStatusPrompt(state, PARENT, row(PARENT, nestedText, 3))
    expect(state.prompts.map((p) => p.text)).toEqual([parentText])
    // A genuinely new prompt afterwards still lands.
    state = observeAgentStatusPrompt(state, PARENT, row(PARENT, '[Image #42] Ask jev to find this bug where is it', 4))
    expect(state.prompts.map((p) => p.text)).toEqual([parentText, '[Image #42] Ask jev to find this bug where is it'])
  })

  it('survives the chat itself following the flip: the cached prompt is still not re-taken on the way back', () => {
    // `resolveMobileNativeChat` takes the chat's session id from the same
    // `providerSession`, so the key the hook is called with can flip too.
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, PARENT, row(PARENT, parentText, 1))
    state = observeAgentStatusPrompt(state, NESTED, row(NESTED, nestedText, 2))
    // While the chat shows the nested session, that prompt is its own.
    expect(state.prompts.map((p) => p.text)).toEqual([nestedText])
    state = observeAgentStatusPrompt(state, PARENT, row(PARENT, nestedText, 3))
    expect(state.prompts).toEqual([])
  })

  it('still takes a prompt from a row with no provider session (older hosts)', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, PARENT, {
      state: 'working',
      updatedAt: 1,
      prompt: parentText
    })
    expect(state.prompts.map((p) => p.text)).toEqual([parentText])
  })
})
