import { describe, expect, it } from 'vitest'
import { MIDTURN_HANDBACK_STATUS_PROMPT } from './fixtures/claude-midturn-queued-commands-2.1.283'
import { SUBAGENT_REQUEST_PROMPT } from './fixtures/claude-agent-message-read-image-2.1.283'
import { AGENT_STATUS_MAX_FIELD_LENGTH, normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt, type AgentStatusPromptSource } from './agent-status-prompts'

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
    // Its time is when the pane's working state began — the prompt was taken
    // then; `updatedAt` had moved on with the tool pings since (2026-09-20).
    expect(state.prompts).toEqual([
      {
        nonce: expect.stringMatching(/^status:sess-1:1789823300000:0$/),
        text: LIVE.prompt,
        at: 1789823300000,
        atStateStart: true,
        seenAt: expect.any(Number)
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
    // The same text after a blip is the same submission. This asserted a
    // second one until 2026-09-29, when that second copy was drawn under the
    // reply to the message (mobile-chat-midturn-prompt-after-reply.test.ts).
    state = observeAgentStatusPrompt(state, 'sess-1', LIVE)
    expect(state.prompts).toHaveLength(1)
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

  // Final review of fix/midturn-prompt-at-end: Orca cuts one character short
  // when the cut would leave half an emoji (mobile-chat-status-copy-cut-before-emoji.test.ts).
  it('marks a prompt the hook cut one short of its field cap, before an emoji', () => {
    const cutBeforeEmoji = normalizePromptField(`${'word '.repeat(39)}abc \u{1F600} and the rest`)
    expect(cutBeforeEmoji).toHaveLength(AGENT_STATUS_MAX_FIELD_LENGTH - 1)
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: cutBeforeEmoji })
    expect(state.prompts[0]).toMatchObject({ text: cutBeforeEmoji, cut: true })
    expect(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: 'x'.repeat(198) }).prompts[0]!.cut).toBeUndefined()
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
      updatedAt: 1,
      prompt: parentText
    })
    expect(state.prompts.map((p) => p.text)).toEqual([parentText])
  })
})

// 2026-09-20: a tab opened an hour into a turn. `updatedAt` was the last tool
// ping, minutes ago, so the prompt anchored at the tail. The state the pane
// is in began when the prompt was taken — for the first status the phone
// sees of a session, that is the prompt's time.
describe('the time of a prompt first seen mid-session', () => {
  it('is when the pane’s current state began, not the status clock', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-9', {
      prompt: '<pasted_content id="329c"> Find me a jacket',
      updatedAt: 1789897000000,
      stateStartedAt: 1789895949068
    })
    expect(state.prompts[0]?.at).toBe(1789895949068)
  })

  it('is the status clock for a prompt that arrives while the phone is watching', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-9', {
      prompt: 'first',
      updatedAt: 1000,
      stateStartedAt: 900
    })
    state = observeAgentStatusPrompt(state, 'sess-9', {
      prompt: 'second, mid-turn',
      updatedAt: 5000,
      stateStartedAt: 900
    })
    expect(state.prompts.map((p) => p.at)).toEqual([900, 5000])
  })
})

// 2026-09-20: a subagent's message fires the same UserPromptSubmit hook as a
// typed prompt, so the tab status carried its first 200 characters — the
// injected preamble and the opening XML tag — and the phone drew that as a
// pending user bubble. The transcript row is drawn as a peer notice instead
// (mobile-native-chat-peer-messages.ts); an echo of it would show twice, and
// the bubble would be the wrapper, not the message.
describe('a peer or subagent message that reached the hook', () => {
  const INJECTED =
    'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/66525.sock" from-name="observer-sessions-17" from-mode="prompting">\n<agent-message from="a379d31745861b502">\nCan you provide the git diff'

  it('is never echoed as a desktop prompt, but is remembered so a repeat is not re-read', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: INJECTED })
    expect(state.prompts).toEqual([])
    expect(state.last).toBe(INJECTED)
    expect(observeAgentStatusPrompt(state, 'sess-1', { ...LIVE, prompt: INJECTED })).toBe(state)
  })

  it('still echoes the person\'s own next prompt after it', () => {
    const peer = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: INJECTED })
    const next = observeAgentStatusPrompt(peer, 'sess-1', { ...LIVE, prompt: 'now fix it', updatedAt: LIVE.updatedAt + 5 })
    expect(next.prompts.map((prompt) => prompt.text)).toEqual(['now fix it'])
  })

  // Orca's classifier keys on the opening phrase alone, so a person's prompt
  // that starts with it is hidden from the transcript on the desktop too. The
  // hook path follows the same rule on purpose: an echo of such a prompt
  // would never find its (hidden) row and would sit as a stale bubble.
  it('follows Orca\'s own rule for a prompt that starts with the phrase', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', {
      ...LIVE,
      prompt: 'Another Claude session sent a message: what does that mean?'
    })
    expect(state.prompts).toEqual([])
  })
})

// 2026-09-26, 23:36 local, session 76ba8f2f (Claude Code 2.1.283, the thesis
// tab "paper-review"): the chat drew "lets ask mahdi later u continue the work"
// under the answer that ends "…and 2999 (distillation) starts. session:ok",
// just above the 23:36 turn. In the transcript's UTC times below, that turn
// is 21:36. The prompt was typed at 13:20:44 and answered by
// 13:22:30; three turns that teammates' messages started followed it, the last
// one 14:27:03–14:27:47. Orca keeps a person's prompt through a turn a
// harness message starts (resolvePrompt, prompt-fields.ts) and through the
// `done` after it, and moves `stateStartedAt` on every state change (the
// renderer's agent-status store), so the tab the phone opened that evening
// read `done` since 14:27:47 with this prompt: its time at first sight was the
// end of a turn it did not start, and the bubble was drawn after that turn's
// answer. The history below is what that store pushes for the transcript's own
// Stop records (13:22:30.957, 13:48:06.768, 13:48:12.723, 14:27:47.470) and
// turn starts; the status itself was not captured.
describe('a prompt the tab status still carries after its turn', () => {
  const SESSION = '76ba8f2f-3727-4cbb-bfc4-3f09fba4d67b'
  const PROMPT = 'lets ask mahdi later u continue the work'
  const T = (clock: string) => Date.parse(`2026-09-26T${clock}Z`)
  const before = { state: 'done', prompt: 'whats running on willi now', startedAt: T('13:15:14.407') }
  const history = [
    before,
    { state: 'working', prompt: PROMPT, startedAt: T('13:20:44.026') },
    { state: 'done', prompt: PROMPT, startedAt: T('13:22:30.957') },
    { state: 'working', prompt: PROMPT, startedAt: T('13:46:47.262') },
    { state: 'done', prompt: PROMPT, startedAt: T('13:48:06.768') },
    { state: 'working', prompt: PROMPT, startedAt: T('13:48:06.780') },
    { state: 'done', prompt: PROMPT, startedAt: T('13:48:12.723') },
    { state: 'working', prompt: PROMPT, startedAt: T('14:27:03.037') }
  ]
  const DONE = {
    state: 'done',
    agentType: 'claude',
    prompt: PROMPT,
    updatedAt: T('14:27:47.480'),
    stateStartedAt: T('14:27:47.470'),
    stateHistory: history,
    providerSession: { id: SESSION }
  }
  /** Held back: kept for the pairing with no time, never drawn. */
  const HELD = [[PROMPT, undefined, true]]
  const timing = (state: { prompts: readonly { text: string; at?: number; heldBack?: true }[] }) =>
    state.prompts.map((prompt) => [prompt.text, prompt.at, prompt.heldBack ?? false])

  it('is not drawn as a message sent when the turn ended, when the chat opens after it', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, DONE)
    // Held, with where it would go if the transcript shows the three turns
    // after it were started by the teammates' messages (13:46:47, 13:48:06,
    // 14:27:03): the run it came in, 13:20:44 (desk-prompt-harness-turns.ts).
    expect(state.prompts).toEqual([
      {
        nonce: `status:${SESSION}:x:0`,
        text: PROMPT,
        heldBack: true,
        ifHarnessStarted: {
          at: T('13:20:44.026'),
          crossings: [
            { after: T('13:22:30.957'), before: T('13:46:47.262') },
            { after: T('13:48:06.768'), before: T('13:48:06.780') },
            { after: T('13:48:12.723'), before: T('14:27:03.037') }
          ]
        },
        seenAt: expect.any(Number)
      }
    ])
    // Seen, so the pings that keep carrying it are not new prompts either.
    expect(timing(observeAgentStatusPrompt(state, SESSION, { ...DONE, updatedAt: T('21:30:00.000') }))).toEqual(HELD)
  })

  it('is not drawn at the start of a turn a teammate’s message started', () => {
    // Read at 14:27:10, while the turn the writer-bridge message opened ran.
    const working = {
      ...DONE,
      state: 'working',
      updatedAt: T('14:27:10.900'),
      stateStartedAt: T('14:27:03.037'),
      stateHistory: history.slice(0, -1)
    }
    expect(timing(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, working))).toEqual(HELD)
  })

  // The ask began after the prompt, and so did the run that went on after it:
  // the history's run the prompt came in is its time (13:20:44), not either.
  it('is timed by the run it came in, not where the agent stopped to ask or went on after', () => {
    const TIMED = [[PROMPT, T('13:20:44.026'), false]]
    const asking = { ...DONE, state: 'waiting', stateStartedAt: T('13:21:30.000'), stateHistory: history.slice(0, 2) }
    expect(timing(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, asking))).toEqual(TIMED)
    const blocked = { ...asking, state: 'blocked' }
    expect(timing(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, blocked))).toEqual(TIMED)
    const resumed = {
      ...DONE,
      state: 'working',
      stateStartedAt: T('13:21:40.000'),
      stateHistory: [...history.slice(0, 2), { state: 'waiting', prompt: PROMPT, startedAt: T('13:21:30.000') }]
    }
    expect(timing(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, resumed))).toEqual(TIMED)
  })

  // The turn it came in ended, and no other took it over: its run is still
  // in the history. Drawn in its own turn, never under the answer.
  it('is timed by the run it came in when the chat opens after its own turn ended', () => {
    const ended = { ...DONE, stateStartedAt: T('13:22:30.957'), stateHistory: history.slice(0, 2) }
    expect(timing(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, ended))).toEqual([[PROMPT, T('13:20:44.026'), false]])
  })

  it('is held back when the history is full and every entry carries it', () => {
    const full = Array.from({ length: 20 }, (_, index) => ({ state: 'working', prompt: PROMPT, startedAt: T('13:20:44.026') + index }))
    expect(timing(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, { ...DONE, stateHistory: full }))).toEqual(HELD)
  })

  // Review of 784531ee: Orca keeps `waiting` as the entry before the run for
  // as long as the run goes on, and a prompt that changed since came in it.
  it('is timed by the run’s resume when it was typed after the agent stopped to ask', () => {
    const typedAfter = {
      ...DONE,
      state: 'working',
      prompt: 'also dump the row counts before and after',
      stateStartedAt: T('13:21:40.000'),
      stateHistory: [...history.slice(0, 2), { state: 'waiting', prompt: PROMPT, startedAt: T('13:21:30.000') }]
    }
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, typedAfter)
    expect(timing(state)).toEqual([['also dump the row counts before and after', T('13:21:40.000'), false]])
  })

  it('is still timed by the run it started when the chat opens while that run works', () => {
    const running = {
      ...DONE,
      state: 'working',
      updatedAt: T('13:21:26.600'),
      stateStartedAt: T('13:20:44.026'),
      stateHistory: [before]
    }
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, running)
    expect(state.prompts.map((prompt) => [prompt.text, prompt.at])).toEqual([[PROMPT, T('13:20:44.026')]])
  })

  it('draws the next prompt the person sends while the chat is open', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, DONE)
    state = observeAgentStatusPrompt(state, SESSION, {
      ...DONE,
      state: 'working',
      prompt: '[Image #18]',
      updatedAt: T('21:36:49.100'),
      stateStartedAt: T('21:36:49.100'),
      stateHistory: [...history, { state: 'done', prompt: PROMPT, startedAt: T('14:27:47.470') }]
    })
    expect(timing(state)).toEqual([...HELD, ['[Image #18]', T('21:36:49.100'), false]])
  })

  it('is not taken from a Codex tab whose turn has ended either', () => {
    const codex = { ...DONE, agentType: 'codex', providerSession: null }
    expect(timing(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, codex))).toEqual(HELD)
  })

  // The chat can mount before the tab's status reaches it. The prompt on the
  // first status it reads was already there all the same, so its time is the
  // run's start, not the last tool ping.
  it('is timed by its run, not the last ping, when the first reading had no status yet', () => {
    const running = { ...DONE, state: 'working', updatedAt: T('13:21:26.600'), stateStartedAt: T('13:20:44.026'), stateHistory: [before] }
    for (const nothing of [null, undefined]) {
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, nothing)
      state = observeAgentStatusPrompt(state, SESSION, running)
      expect(state.prompts.map((prompt) => prompt.at)).toEqual([T('13:20:44.026')])
    }
  })

  it('says why it was not drawn, in one line that names the pane’s state', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, DONE)
    expect(state.withheld).toMatch(/^\[desk-prompt\] not drawn: .*"lets ask mahdi later u continue/)
    expect(state.withheld).toContain('done')
    // Nothing to say about a prompt it drew.
    const running = { ...DONE, state: 'working', stateStartedAt: T('13:20:44.026'), stateHistory: [before] }
    expect(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, running).withheld).toBeNull()
  })
})

// Device, 2026-09-29 (mobile-chat-midturn-prompt-after-reply.test.ts): a tab
// status that carries no prompt came between two that carried a mid-turn
// message, the reader took it for a pane reset, and the message came back as
// a second copy timed after the reply to it. Two statuses carry none: a tab
// snapshot with no status at all, and Orca's own stand-in when it will not
// use its hook row (`done`, `prompt: ''`, no history). Neither says anything
// about the pane's prompt.
describe('a tab status that carries no prompt', () => {
  const T = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)
  const MESSAGE = 'Password changes now end only password sessions. Whats this'
  const history = [{ state: 'done', prompt: 'the turn before', startedAt: T('05:07:00.700') }]
  const taken = {
    state: 'working',
    agentType: 'claude',
    prompt: MESSAGE,
    updatedAt: T('05:36:34.891'),
    stateStartedAt: T('05:08:00.600'),
    stateHistory: history,
    providerSession: { id: 'sess-1' }
  }
  const turnDone = {
    ...taken,
    state: 'done',
    updatedAt: T('05:46:51.005'),
    stateStartedAt: T('05:46:51.005'),
    stateHistory: [...history, { state: 'working', prompt: MESSAGE, startedAt: T('05:08:00.600') }]
  }
  const standIn = (status: NonNullable<AgentStatusPromptSource>) => ({ ...status, state: 'done', prompt: '', updatedAt: T('05:47:09.000'), stateHistory: [] })
  const copies = (state: { prompts: readonly { text: string; at?: number }[] }) =>
    state.prompts.map((prompt) => [prompt.text, prompt.at])

  for (const [agent, providerSession] of [['claude', { id: 'sess-1' }], ['codex', null]] as const) {
    it(`keeps a ${agent} pane's prompt one message through a status with none, before and after the turn ends`, () => {
      const pane = { ...taken, agentType: agent, providerSession }
      const ended = { ...turnDone, agentType: agent, providerSession }
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...pane, prompt: 'an earlier message', updatedAt: T('05:30:40.761') })
      state = observeAgentStatusPrompt(state, 'sess-1', pane)
      for (const blip of [null, undefined, standIn(pane)]) {
        state = observeAgentStatusPrompt(state, 'sess-1', blip)
        state = observeAgentStatusPrompt(state, 'sess-1', { ...pane, updatedAt: T('05:46:41.308') })
        state = observeAgentStatusPrompt(state, 'sess-1', blip)
        // The first status after a reconnect, the turn over.
        state = observeAgentStatusPrompt(state, 'sess-1', ended, { firstRead: true })
      }
      expect(copies(state).slice(1)).toEqual([[MESSAGE, T('05:36:34.891')]])
    })
  }

  // Gap C of the final review of fix/midturn-prompt-at-end: the stand-in as
  // the chat's first status took the chat's first read.
  it('leaves the chat’s first read to the next status that says what the prompt is', () => {
    for (const standInState of ['working', 'done']) {
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...standIn(taken), state: standInState })
      state = observeAgentStatusPrompt(state, 'sess-1', { ...taken, updatedAt: T('05:39:23.200') })
      expect(copies(state)).toEqual([[MESSAGE, T('05:08:00.600')]])
      expect(state.placed).toContain("found on the chat's first status")
    }
  })

  it('still takes the next message the person sends after it', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', taken)
    state = observeAgentStatusPrompt(state, 'sess-1', standIn(taken))
    state = observeAgentStatusPrompt(state, 'sess-1', { ...taken, prompt: 'and this too', updatedAt: T('05:40:00.000') })
    expect(copies(state).map(([text]) => text)).toEqual([MESSAGE, 'and this too'])
  })

  it('is no bound on when a message taken while the link was down came', () => {
    let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...taken, prompt: 'an earlier message', updatedAt: T('05:30:40.761') })
    state = observeAgentStatusPrompt(state, 'sess-1', standIn(taken))
    state = observeAgentStatusPrompt(state, 'sess-1', turnDone, { firstRead: true })
    // No earlier than the last status read that carried a prompt, not the
    // stand-in's stamp, which is after the turn ended.
    expect(copies(state)[1]).toEqual([MESSAGE, T('05:30:40.761')])
    // And the log line names the prompt the reader held when it came.
    expect(state.placed).toBe(
      '[desk-prompt] drawn: "Password changes now end only pa…" (found on the first status since a reconnect or the cached tab list, after "an earlier message") placed from 2026-09-29T05:30:40.761Z, the last status read before it that said what prompt the pane had'
    )
  })

  // Round-2 review: a hook row with no prompt and a history of its own is a
  // real reading (a pane whose cached prompt is empty). A message found after
  // a reconnect or the cached tab list came after it, and the next copy of a
  // prompt after it is a new submission, as before 257768bc.
  // Final review of this branch: Orca's headless builder, and its PTY builder
  // when the renderer published no tab status, send hook rows with no history
  // (`stateHistory: []`), so a history cannot tell them from the stand-in.
  // The row Orca lands for a SessionStart says the pane was reset
  // (`sessionBoundary`), and the stand-in never does.
  describe('from a session reset with no history', () => {
    const pane = { stateHistory: [], providerSession: { id: 'sess-1' } }
    it('makes the same words sent mid-turn in a teammate’s turn after it a new message', () => {
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...pane, state: 'working', prompt: 'yes', updatedAt: 1_000, stateStartedAt: 1_000 })
      state = observeAgentStatusPrompt(state, 'sess-1', { ...pane, state: 'done', prompt: '', sessionBoundary: true, updatedAt: 2_000, stateStartedAt: 2_000 })
      state = observeAgentStatusPrompt(state, 'sess-1', { ...pane, state: 'working', prompt: '', updatedAt: 3_000, stateStartedAt: 3_000 })
      state = observeAgentStatusPrompt(state, 'sess-1', { ...pane, state: 'working', prompt: 'yes', updatedAt: 4_000, stateStartedAt: 3_000 })
      expect(state.prompts.map((prompt) => [prompt.text, prompt.at])).toEqual([
        ['yes', 1_000],
        ['yes', 4_000]
      ])
    })

    // The same after `/clear`, where the new session's key already started
    // the reader over but kept the text last read (a pane flips sessions).
    it('draws a first prompt after /clear that repeats the last one of the session before', () => {
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-A', {
        state: 'done',
        prompt: 'ok',
        updatedAt: 1_000,
        stateStartedAt: 900,
        stateHistory: [{ state: 'working', prompt: 'ok', startedAt: 500 }],
        providerSession: { id: 'sess-A' }
      })
      state = observeAgentStatusPrompt(state, 'sess-B', { state: 'done', prompt: '', sessionBoundary: true, updatedAt: 2_000, stateStartedAt: 2_000, stateHistory: [], providerSession: { id: 'sess-B' } })
      state = observeAgentStatusPrompt(state, 'sess-B', { state: 'working', prompt: 'ok', updatedAt: 3_000, stateStartedAt: 3_000, stateHistory: [], providerSession: { id: 'sess-B' } })
      expect(state.prompts.map((prompt) => prompt.text)).toEqual(['ok'])
    })

    it('still keeps one message through the stand-in, working or done', () => {
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...pane, state: 'working', prompt: 'yes', updatedAt: 1_000, stateStartedAt: 1_000 })
      for (const standInState of ['working', 'blocked', 'done']) {
        state = observeAgentStatusPrompt(state, 'sess-1', { ...pane, state: standInState, prompt: '', updatedAt: 2_000, stateStartedAt: 1_500 })
        state = observeAgentStatusPrompt(state, 'sess-1', { ...pane, state: 'working', prompt: 'yes', updatedAt: 3_000, stateStartedAt: 1_000 })
      }
      expect(state.prompts).toHaveLength(1)
    })
  })

  describe('from a hook row, with a history of its own', () => {
    const row = (updatedAt: number, prompt = '') => ({
      state: 'working',
      prompt,
      updatedAt,
      stateStartedAt: 1_000,
      stateHistory: [{ state: 'done', prompt: '', startedAt: 500 }],
      providerSession: { id: 'sess-1' }
    })

    it('bounds the next message found after a reconnect or the cached tab list', () => {
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', row(2_000))
      state = observeAgentStatusPrompt(state, 'sess-1', row(50_000))
      state = observeAgentStatusPrompt(state, 'sess-1', row(90_000, 'and keep the old table'), { firstRead: true })
      expect(state.prompts.map((prompt) => prompt.at)).toEqual([50_000])
      // The log names that bound for what it was: no prompt carried it.
      expect(state.placed).toBe(
        '[desk-prompt] drawn: "and keep the old table" (found on the first status since a reconnect or the cached tab list, no prompt read before it) placed from 1970-01-01T00:00:50.000Z, the last status read before it that said what prompt the pane had'
      )
    })

    it('makes the same words after it a new message', () => {
      let state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', row(2_000, 'ok'))
      state = observeAgentStatusPrompt(state, 'sess-1', row(3_000))
      state = observeAgentStatusPrompt(state, 'sess-1', row(4_000, 'ok'))
      expect(state.prompts.map((prompt) => prompt.text)).toEqual(['ok', 'ok'])
    })
  })

  // Degenerate: nothing but statuses with no prompt, and the first status of
  // the session carrying none.
  it('makes no message of its own, and leaves the first message found on the next status', () => {
    let state = EMPTY_AGENT_STATUS_PROMPTS
    for (const blip of [null, standIn(taken), undefined, standIn(taken)]) {
      state = observeAgentStatusPrompt(state, 'sess-1', blip)
    }
    expect(state.prompts).toEqual([])
    expect(state.last).toBeNull()
    state = observeAgentStatusPrompt(state, 'sess-1', turnDone)
    expect(copies(state)).toEqual([[MESSAGE, T('05:08:00.600')]])
  })
})

// Bug B, 2026-09-27: Orca's hook puts a subagent message on the tab status
// like any prompt, folded to one line and cut at 200 characters. It is never
// a desktop prompt, but on a tab with no prompt hook it is the only source of
// the message's words.
describe("a subagent message's copy on the tab status", () => {
  /** Read live: the phone had read this session's status before. */
  const observe = (prompt: string) =>
    observeAgentStatusPrompt(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: '', stateHistory: [{ state: 'done', prompt: '' }] }), 'sess-1', { ...LIVE, prompt })

  it("keeps the first words of a short message, marked as cut, and no desktop prompt", () => {
    // SUBAGENT_REQUEST_PROMPT as normalizePromptField leaves it.
    const onStatus = SUBAGENT_REQUEST_PROMPT.replaceAll(/\n+/g, ' ').slice(0, AGENT_STATUS_MAX_FIELD_LENGTH)
    const state = observe(onStatus)
    expect(state.prompts).toEqual([])
    expect(state.agentMessages).toEqual([
      {
        from: 'a7a46867b4f497c96',
        body: onStatus.slice('<agent-message from="a7a46867b4f497c96"> '.length).trim(),
        cut: true,
        seenAt: expect.any(Number)
      }
    ])
    expect(state.agentMessages?.[0]?.body.startsWith('Request for one read-only device probe (copy-flicker agent)')).toBe(true)
  })

  it('keeps nothing of a hand-back but who sent it: the harness line fills all 200 characters', () => {
    expect(MIDTURN_HANDBACK_STATUS_PROMPT).toHaveLength(200)
    expect(observe(MIDTURN_HANDBACK_STATUS_PROMPT).agentMessages).toEqual([
      { from: 'a9d5c2f85e94ca47f', body: '', cut: true, seenAt: expect.any(Number) }
    ])
  })

  it('keeps a message that fit whole, and not a person\'s short prompt that opens with the tag', () => {
    expect(observe('<agent-message from="a7a46867b4f497c96"> hello from probe </agent-message>').agentMessages).toEqual([
      { from: 'a7a46867b4f497c96', body: 'hello from probe', cut: false, seenAt: expect.any(Number) }
    ])
    expect(observe('<agent-message from="x"> keeps showing in my log, why?').agentMessages ?? []).toEqual([])
  })

  // Review of 2026-09-27: the next prompt dropped them, so a "Message from"
  // row lost its words the moment the person replied.
  it('keeps them when the person\'s next prompt comes', () => {
    const message = observe('<agent-message from="a7a46867b4f497c96"> hello from probe </agent-message>')
    const next = observeAgentStatusPrompt(message, 'sess-1', { ...LIVE, prompt: 'thanks, carry on', updatedAt: LIVE.updatedAt + 1000 })
    expect(next.prompts.map((prompt) => prompt.text)).toEqual(['thanks, carry on'])
    expect(next.agentMessages).toEqual(message.agentMessages)
    expect(next.agentMessages?.map(({ from, body, cut }) => ({ from, body, cut }))).toEqual([
      { from: 'a7a46867b4f497c96', body: 'hello from probe', cut: false }
    ])
  })

  it('starts over with the session', () => {
    const first = observe(MIDTURN_HANDBACK_STATUS_PROMPT)
    expect(observeAgentStatusPrompt(first, 'sess-2', { ...LIVE, prompt: '' }).agentMessages).toEqual([])
  })
})

// Re-review of a6857609..235dfa20: a copy the phone reads on its first read
// of a session (a launch, a return to the tab, the first read after a
// reconnect) can be minutes old, its row long off the screen. Timed by that
// read, it paired with the sender's NEXT row when that row's own copy was
// missed, and the new row opened to the old words.
describe("a subagent message's copy read on a first read of the tab status", () => {
  const OLD = '<agent-message from="a7a46867b4f497c96"> OLD: probe step 1 done </agent-message>'

  it('is kept with no time to pair by, and one read live after it has one', () => {
    const first = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: OLD })
    expect(first.agentMessages?.[0]).toEqual({ from: 'a7a46867b4f497c96', body: 'OLD: probe step 1 done', cut: false })
    const live = observeAgentStatusPrompt(first, 'sess-1', { ...LIVE, prompt: '<agent-message from="a1111111111111111"> other report </agent-message>' })
    expect(live.agentMessages?.[1]?.seenAt).toEqual(expect.any(Number))
  })

  it('has no time either when the caller says it is the first read after a reconnect', () => {
    const seen = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, 'sess-1', { ...LIVE, prompt: 'go on' })
    const afterReconnect = observeAgentStatusPrompt(seen, 'sess-1', { ...LIVE, prompt: OLD }, { firstRead: true })
    expect(afterReconnect.agentMessages?.[0]).not.toHaveProperty('seenAt')
  })
})
