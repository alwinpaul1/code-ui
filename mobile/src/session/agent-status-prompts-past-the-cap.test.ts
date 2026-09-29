import { describe, expect, it } from 'vitest'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt, type AgentStatusPromptState } from './agent-status-prompts'

// Review of 2026-09-30. The chat keeps the last 64 desk prompts a session's
// tab status carried, and numbered each one's nonce by how many it held. Past
// 64 that count stops moving, so every later prompt got the same number: two
// messages placed by the same run start shared a nonce, and every held-back
// prompt shared `status:<session>:x:64` whatever run it came in. The echoes key
// everything by nonce (the row id, the remembered anchor, the waits), so one
// message could take the other's place or be drawn nowhere.
const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
const RUN = 1790405900000
/** The shape desktop-prompt-photo-copies.ts reads the session back out of. */
const NONCE_SHAPE = new RegExp(`^status:${SESSION}:(\\d+|x):(\\d+)$`)

/** A message typed while the agent asked something, in the run that began at
 *  RUN: the history says the run it came in, so its time is RUN. */
const askedInRun = (text: string, index: number) => ({
  state: 'waiting',
  prompt: text,
  updatedAt: RUN + 60_000 + index * 1000,
  stateStartedAt: RUN + 30_000 + index * 1000,
  stateHistory: [{ state: 'working', prompt: text, startedAt: RUN }]
})

/** A prompt on a finished pane whose history holds no working run for it:
 *  held back, with no time. */
const heldOnDone = (text: string, index: number) => ({
  state: 'done',
  prompt: text,
  updatedAt: RUN + index * 1000,
  stateStartedAt: RUN + index * 1000,
  stateHistory: []
})

function read(count: number, status: (text: string, index: number) => object, from = EMPTY_AGENT_STATUS_PROMPTS): AgentStatusPromptState {
  let state = from
  for (let index = 0; index < count; index += 1) {
    state = observeAgentStatusPrompt(state, SESSION, status(`message ${index}`, index))
  }
  return state
}

const nonces = (state: AgentStatusPromptState) => state.prompts.map((prompt) => prompt.nonce)

describe('desk prompts after the chat has read more than it keeps', () => {
  it('gives each of 70 messages placed by the same run start a nonce of its own', () => {
    const state = read(70, askedInRun)
    expect(state.prompts).toHaveLength(64)
    expect(state.prompts.every((prompt) => prompt.at === RUN)).toBe(true)
    expect(new Set(nonces(state)).size).toBe(64)
    expect(nonces(state).every((nonce) => NONCE_SHAPE.test(nonce))).toBe(true)
  })

  // The failure path: a held copy has no time in its nonce at all.
  it('gives each message held back past the cap a nonce of its own, whatever run it came in', () => {
    const state = read(70, heldOnDone)
    expect(state.prompts.every((prompt) => prompt.heldBack === true)).toBe(true)
    expect(new Set(nonces(state)).size).toBe(64)
    expect(nonces(state).every((nonce) => /:x:\d+$/.test(nonce) && NONCE_SHAPE.test(nonce))).toBe(true)
  })

  it('keeps held and drawn messages apart when they alternate past the cap', () => {
    let state = EMPTY_AGENT_STATUS_PROMPTS
    for (let index = 0; index < 80; index += 1) {
      const text = `message ${index}`
      state = observeAgentStatusPrompt(state, SESSION, index % 2 === 0 ? heldOnDone(text, index) : askedInRun(text, index))
    }
    expect(new Set(nonces(state)).size).toBe(64)
  })

  // The anchors a chat remembers outlive the list (use-desktop-prompt-echoes.ts),
  // so a nonce given again to a later prompt would place it where the one it
  // first named was drawn.
  it('never gives a later prompt the nonce of one the chat has let go of', () => {
    let state = EMPTY_AGENT_STATUS_PROMPTS
    const issued: string[] = []
    for (let index = 0; index < 130; index += 1) {
      state = observeAgentStatusPrompt(state, SESSION, askedInRun(`message ${index}`, index))
      issued.push(state.prompts.at(-1)!.nonce)
    }
    expect(new Set(issued).size).toBe(130)
  })

  // A reconnect's first read does not start the session over: its prompt is
  // found, and still numbered after every one before it.
  it('numbers the prompt found on the first read after a reconnect after every one before it', () => {
    const before = read(66, askedInRun)
    const found = observeAgentStatusPrompt(before, SESSION, askedInRun('after the reconnect', 66), { firstRead: true })
    expect(found.prompts.at(-1)!.text).toBe('after the reconnect')
    expect(new Set(nonces(found)).size).toBe(64)
  })

  describe('at the degenerate sizes', () => {
    it('holds no prompt and no nonce before the first', () => {
      expect(read(0, askedInRun).prompts).toEqual([])
    })

    it('numbers the first prompt 0, as every mount has', () => {
      expect(nonces(read(1, askedInRun))).toEqual([`status:${SESSION}:${RUN}:0`])
    })

    it('numbers exactly 64 prompts 0 to 63 and keeps them all', () => {
      const state = read(64, askedInRun)
      expect(nonces(state)).toEqual(Array.from({ length: 64 }, (_, index) => `status:${SESSION}:${RUN}:${index}`))
    })

    it('numbers the 65th prompt 64 and lets the first go', () => {
      const state = read(65, askedInRun)
      expect(state.prompts[0]!.text).toBe('message 1')
      expect(nonces(state).at(-1)).toBe(`status:${SESSION}:${RUN}:64`)
      expect(new Set(nonces(state)).size).toBe(64)
    })

    it('starts a new session at 0 again', () => {
      const long = read(70, askedInRun)
      const next = observeAgentStatusPrompt(long, 'another-session', askedInRun('a new session', 0))
      expect(nonces(next)).toEqual([`status:another-session:${RUN}:0`])
    })
  })
})

// Swept with the nonce (review of 2026-09-30): the log lines quote the start
// of the prompt, cut at 32 UTF-16 units, which can split an emoji and leave
// its first half at the end of the line.
describe('the log line for a desk prompt that starts with 31 characters and an emoji', () => {
  const text = `${'a'.repeat(31)}\u{1F600} and then the rest of the message`
  const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

  it('quotes the emoji whole when the prompt is drawn', () => {
    const placed = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, askedInRun(text, 0)).placed ?? ''
    expect(placed).toContain(`"${'a'.repeat(31)}\u{1F600}…"`)
    expect(placed).not.toMatch(LONE_HALF)
  })

  it('quotes the emoji whole when the prompt is held back', () => {
    const withheld = observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, heldOnDone(text, 0)).withheld ?? ''
    expect(withheld).toContain(`"${'a'.repeat(31)}\u{1F600}…"`)
    expect(withheld).not.toMatch(LONE_HALF)
  })

  it('quotes a prompt of exactly 32 characters, one of them an emoji, with no cut', () => {
    const exact = `${'a'.repeat(31)}\u{1F600}`
    expect(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, askedInRun(exact, 0)).placed).toContain(`"${exact}" (`)
  })

  it('quotes a prompt of one emoji whole', () => {
    expect(observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, askedInRun('\u{1F600}', 0)).placed).toContain('"\u{1F600}" (')
  })
})
