import { describe, expect, it } from 'vitest'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt, type AgentStatusPromptSource } from './agent-status-prompts'

// A prompt that starts a working run (the pane was idle) is the only kind a
// loop's tick can look like on a tab without the prompt hook: Orca's
// UserPromptSubmit hook posts it, the pane goes `working`, and both stamps are
// that event's. A prompt sent mid-turn leaves `stateStartedAt` where the turn
// began. The reader marks the first kind `idleSubmit`
// (desk-prompt-idle-submit.ts decides what the transcript says of it).
//
// NOT PINNED TO A RECORDED STATUS: no captured status holds both stamps for a
// prompt that began a run (agent-status-prompts.test.ts says of its own that
// "the status itself was not captured"), so the slack is a conservative guess
// from Orca setting both stamps on one event, and a status read later than the
// event misses it and draws as before.

const SESSION = 'sess-idle'
const T = (clock: string) => Date.parse(`2026-10-01T${clock}Z`)
const working = (extra: Partial<NonNullable<AgentStatusPromptSource>>): AgentStatusPromptSource => ({
  state: 'working',
  prompt: 'check the build host',
  updatedAt: T('02:21:49.600'),
  stateStartedAt: T('02:21:49.600'),
  ...extra
})
/** A pane that finished a turn the chat watched: the earlier prompt is read on
 *  the first status (found), so the one after it is watched arriving. */
const idleBefore = (state = EMPTY_AGENT_STATUS_PROMPTS) =>
  observeAgentStatusPrompt(state, SESSION, {
    state: 'done',
    prompt: 'an earlier prompt',
    updatedAt: T('02:20:00.000'),
    stateStartedAt: T('02:20:00.000'),
    stateHistory: [{ state: 'working', prompt: 'an earlier prompt', startedAt: T('02:19:00.000') }]
  })
/** The flag of the last prompt the reader holds. */
const flags = (state: { prompts: readonly { idleSubmit?: true }[] }) => [state.prompts.at(-1)?.idleSubmit ?? false]

describe('a desk prompt that began a working run', () => {
  it('is marked an idle submit when the stamps of the working state are the prompt’s own', () => {
    const state = observeAgentStatusPrompt(idleBefore(), SESSION, working({}))
    expect(flags(state)).toEqual([true])
  })

  it('is marked when the status stamped them a few milliseconds apart', () => {
    const state = observeAgentStatusPrompt(idleBefore(), SESSION, working({ updatedAt: T('02:21:49.640') }))
    expect(flags(state)).toEqual([true])
  })

  it('is not marked for a prompt sent mid-turn, whose run began minutes before', () => {
    const state = observeAgentStatusPrompt(idleBefore(), SESSION, working({ stateStartedAt: T('02:16:49.600') }))
    expect(state.prompts.at(-1)?.text).toBe('check the build host')
    expect(flags(state)).toEqual([false])
  })

  it('is not marked once tool pings moved the stamp past the slack', () => {
    const state = observeAgentStatusPrompt(idleBefore(), SESSION, working({ updatedAt: T('02:21:51.000') }))
    expect(flags(state)).toEqual([false])
  })

  it('is not marked when it is found on the chat’s first status', () => {
    const state = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, working({}))
    expect(state.prompts.at(-1)?.text).toBe('check the build host')
    expect(flags(state)).toEqual([false])
  })

  it('is not marked on the first status since a reconnect, whose stamp the reconnect restamped', () => {
    const state = observeAgentStatusPrompt(idleBefore(), SESSION, working({}), { firstRead: true })
    expect(flags(state)).toEqual([false])
  })

  it('is not marked on a pane that is not working, or has no stamp to compare', () => {
    expect(flags(observeAgentStatusPrompt(idleBefore(), SESSION, working({ state: 'blocked' })))).toEqual([false])
    expect(flags(observeAgentStatusPrompt(idleBefore(), SESSION, working({ stateStartedAt: undefined })))).toEqual([false])
    expect(flags(observeAgentStatusPrompt(idleBefore(), SESSION, working({ stateStartedAt: Number.NaN })))).toEqual([false])
  })

  it('is not marked when the working state’s stamp is after the status’s own', () => {
    const state = observeAgentStatusPrompt(idleBefore(), SESSION, working({ updatedAt: T('02:21:49.000'), stateStartedAt: T('02:21:49.600') }))
    expect(flags(state)).toEqual([false])
  })
})
