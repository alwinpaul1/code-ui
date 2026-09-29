import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import type { StatusSubagentMessage } from './mobile-native-chat-agent-messages'
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
      listed = useAgentStatusPrompts(SESSION, DONE, beacon).prompts
      return null
    }
    act(() => {
      renderer = create(createElement(Merged))
    })
    // Only the status's own copy, held back: untimed, and never drawn.
    expect(listed.map((prompt) => [prompt.nonce, prompt.at, prompt.heldBack])).toEqual([[`status:${SESSION}:x:0`, undefined, true]])
  })
})

// Re-review of a6857609..235dfa20: the first status the phone reads after a
// reconnect can carry a subagent message taken while it was away, minutes
// old, its row long off the screen. Timed by that read it paired with the
// sender's next row and gave it the old words.
describe("a subagent message's copy on the tab status, across a reconnect", () => {
  const wrap = (from: string, words: string) => `<agent-message from="${from}"> ${words} </agent-message>`
  const statusOf = (prompt: string): AgentStatusPromptSource => ({ prompt, updatedAt: 1 })

  it('is untimed when it is the first status read after the link came back, and timed when read live', () => {
    let messages: readonly StatusSubagentMessage[] = []
    function Chat({ status, connected }: { status: AgentStatusPromptSource; connected: boolean }) {
      messages = useAgentStatusPrompts('sess-1', status, undefined, connected).agentMessages
      return null
    }
    let renderer!: ReactTestRenderer
    const show = (status: AgentStatusPromptSource, connected: boolean) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, { status, connected }))
        } else {
          renderer = create(createElement(Chat, { status, connected }))
        }
      })
    show(statusOf(''), true)
    const live = statusOf(wrap('a1111111111111111', 'read live'))
    show(live, true)
    show(live, false)
    // Back, still holding the status it read before the drop.
    show(live, true)
    show(statusOf(wrap('a7a46867b4f497c96', 'taken while the phone was away')), true)
    show(statusOf(wrap('a2222222222222222', 'read live again')), true)
    act(() => renderer.unmount())
    expect(messages.map((message) => [message.body, message.seenAt === undefined ? 'untimed' : 'timed'])).toEqual([
      ['read live', 'timed'],
      ['taken while the phone was away', 'untimed'],
      ['read live again', 'timed']
    ])
  })

  // Combined review of fix/prompt-leak, 2026-09-27: the latch took `null` for
  // "nothing pending", and a tab status can itself be null, so coming back to
  // a null status disarmed it and the first status after was read as live.
  it('is untimed after a reconnect that came back to no status at all', () => {
    let messages: readonly StatusSubagentMessage[] = []
    function Chat({ status, connected }: { status: AgentStatusPromptSource; connected: boolean }) {
      messages = useAgentStatusPrompts('sess-1', status, undefined, connected).agentMessages
      return null
    }
    let renderer!: ReactTestRenderer
    const show = (status: AgentStatusPromptSource, connected: boolean) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, { status, connected }))
        } else {
          renderer = create(createElement(Chat, { status, connected }))
        }
      })
    show(statusOf(''), true)
    show(statusOf(wrap('a1111111111111111', 'read live')), true)
    show(null, false)
    show(null, true)
    show(statusOf(wrap('a7a46867b4f497c96', 'taken while the phone was away')), true)
    act(() => renderer.unmount())
    expect(messages.map((message) => [message.body, message.seenAt === undefined ? 'untimed' : 'timed'])).toEqual([
      ['read live', 'timed'],
      ['taken while the phone was away', 'untimed']
    ])
  })
})

// The same shape for a person's prompt: one typed at the desk while the link
// was down reaches the phone on the first status after the reconnect, whose
// `updatedAt` the reconnect restamped. Timed by it, the bubble sat at the tail
// under rows written after it; the run it came in is its time.
describe('a desk prompt taken while the phone was away', () => {
  it('is timed by the run it came in, not by the reconnect, on the first status read after it', () => {
    let listed: readonly { text: string; at?: number }[] = []
    function Chat({ status, connected }: { status: AgentStatusPromptSource; connected: boolean }) {
      listed = useAgentStatusPrompts('sess-1', status, undefined, connected).prompts
      return null
    }
    let renderer!: ReactTestRenderer
    const show = (status: AgentStatusPromptSource, connected: boolean) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, { status, connected }))
        } else {
          renderer = create(createElement(Chat, { status, connected }))
        }
      })
    const history = [{ state: 'done', prompt: 'earlier', startedAt: 500 }]
    const watched = { state: 'working', prompt: 'run the migration', updatedAt: 1_000, stateStartedAt: 1_000, stateHistory: history }
    show(watched, true)
    show(watched, false)
    show(watched, true)
    // Typed at the desk mid-run at 1,400 while the phone was away; the status
    // the reconnect delivers is stamped 9,000.
    show({ ...watched, prompt: 'and keep the old table', updatedAt: 9_000 }, true)
    act(() => renderer.unmount())
    expect(listed.map((prompt) => [prompt.text, prompt.at])).toEqual([
      ['run the migration', 1_000],
      ['and keep the old table', 1_000]
    ])
  })
})

// Review of a615bde2: a short drop in a long run. The prompt came after the
// last status the chat read before the drop, so that is a truer lower bound
// than the run's start, an hour earlier.
describe('a desk prompt typed during a short drop in a long run', () => {
  it('is timed no earlier than the last status the chat read before the drop', () => {
    let listed: readonly { text: string; at?: number }[] = []
    function Chat({ status, connected }: { status: AgentStatusPromptSource; connected: boolean }) {
      listed = useAgentStatusPrompts('sess-1', status, undefined, connected).prompts
      return null
    }
    let renderer!: ReactTestRenderer
    const show = (status: AgentStatusPromptSource, connected: boolean) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, { status, connected }))
        } else {
          renderer = create(createElement(Chat, { status, connected }))
        }
      })
    const history = [{ state: 'done', prompt: 'earlier', startedAt: 500 }]
    const run = { state: 'working', prompt: 'run the migration', updatedAt: 1_000, stateStartedAt: 1_000, stateHistory: history }
    show(run, true)
    const lastBeforeDrop = { ...run, updatedAt: 3_600_000 }
    show(lastBeforeDrop, true)
    show(lastBeforeDrop, false)
    show(lastBeforeDrop, true)
    show({ ...run, prompt: 'and keep the old table', updatedAt: 3_606_000 }, true)
    act(() => renderer.unmount())
    expect(listed.map((prompt) => [prompt.text, prompt.at])).toEqual([
      ['run the migration', 1_000],
      ['and keep the old table', 3_600_000]
    ])
  })
})

// Pre-merge review of 06911823: the tab can hand the chat a null status on the
// way back, and the latch took that null as the first read, so the status
// after it was treated as watched and the prompt timed by the reconnect.
describe('a desk prompt taken while the phone was away, after a null status on the way back', () => {
  it('is still timed by the run it came in', () => {
    let listed: readonly { text: string; at?: number }[] = []
    function Chat({ status, connected }: { status: AgentStatusPromptSource; connected: boolean }) {
      listed = useAgentStatusPrompts('sess-1', status, undefined, connected).prompts
      return null
    }
    let renderer!: ReactTestRenderer
    const show = (status: AgentStatusPromptSource, connected: boolean) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, { status, connected }))
        } else {
          renderer = create(createElement(Chat, { status, connected }))
        }
      })
    const history = [{ state: 'done', prompt: 'earlier', startedAt: 500 }]
    const watched = { state: 'working', prompt: 'run the migration', updatedAt: 1_000, stateStartedAt: 1_000, stateHistory: history }
    show(watched, true)
    show(watched, false)
    show(watched, true)
    show(null, true)
    show({ ...watched, prompt: 'and keep the old table', updatedAt: 9_000 }, true)
    act(() => renderer.unmount())
    expect(listed.map((prompt) => [prompt.text, prompt.at])).toEqual([
      ['run the migration', 1_000],
      ['and keep the old table', 1_000]
    ])
  })
})

// Review of 257768bc, which held the reconnect and cached-tab-list latch
// through statuses with no prompt: a Claude lead whose cached prompt is empty
// (Orca's SessionStart empties it after startup, resume or clear, and a turn
// a teammate's or subagent's message starts keeps it) sends genuine hook rows
// with `prompt: ''`. Held through them, the latch took a message the chat
// watched arrive long after the reconnect for one found there, timed it by
// the run's start, and a subagent message read live got no time to pair by.
// Any status that is not null ends the latch, as before that commit.
describe('a status with no prompt on the way back', () => {
  const noPrompt: NonNullable<AgentStatusPromptSource> = {
    state: 'working',
    prompt: '',
    updatedAt: 2_000,
    stateStartedAt: 1_000,
    stateHistory: [{ state: 'done', prompt: '', startedAt: 500 }],
    providerSession: { id: 'sess-1' }
  }
  function mount() {
    let renderer: ReactTestRenderer | null = null
    let out: ReturnType<typeof useAgentStatusPrompts> = { prompts: [], agentMessages: [] }
    function Chat({ status, connected, live }: { status: AgentStatusPromptSource; connected: boolean; live: boolean }) {
      out = useAgentStatusPrompts('sess-1', status, undefined, connected, live)
      return null
    }
    return {
      show(status: AgentStatusPromptSource, { connected = true, live = true }: { connected?: boolean; live?: boolean } = {}) {
        act(() => {
          const element = createElement(Chat, { status, connected, live })
          if (renderer) {
            renderer.update(element)
          } else {
            renderer = create(element)
          }
        })
        return out
      },
      done(): void {
        act(() => renderer?.unmount())
      }
    }
  }

  it('ends the wait, so a message watched arriving long after a reconnect is timed by its own stamp', () => {
    const chat = mount()
    chat.show(noPrompt)
    chat.show(noPrompt, { connected: false })
    chat.show({ ...noPrompt })
    chat.show({ ...noPrompt, updatedAt: 60_000 })
    const { prompts } = chat.show({ ...noPrompt, prompt: 'and keep the old table', updatedAt: 120_000 })
    chat.done()
    expect(prompts.map((prompt) => [prompt.text, prompt.at])).toEqual([['and keep the old table', 120_000]])
  })

  it('ends the wait after the cached tab list too', () => {
    const chat = mount()
    chat.show(noPrompt, { live: false })
    chat.show({ ...noPrompt, updatedAt: 60_000 })
    const { prompts } = chat.show({ ...noPrompt, prompt: 'and keep the old table', updatedAt: 120_000 })
    chat.done()
    expect(prompts.map((prompt) => [prompt.text, prompt.at])).toEqual([['and keep the old table', 120_000]])
  })

  it('leaves a subagent message read live after it a time to pair by', () => {
    const chat = mount()
    chat.show(noPrompt)
    chat.show(noPrompt, { connected: false })
    chat.show({ ...noPrompt })
    chat.show({ ...noPrompt, updatedAt: 60_000 })
    const { agentMessages } = chat.show({
      ...noPrompt,
      prompt: '<agent-message from="a7a46867b4f497c96"> hello from probe </agent-message>',
      updatedAt: 120_000
    })
    chat.done()
    expect(agentMessages[0]?.seenAt).toEqual(expect.any(Number))
  })
})

// Device, 2026-09-27 (session 790eafa8): the session screen paints the tab
// list the last visit cached before the host answers, so the chat's first
// status of a session was that visit's. A message taken while the chat was
// closed came on the host's first status, read as if the chat had watched it
// arrive, and was timed by that status's stamp, the last tool ping before the
// chat opened: it sat at the tail under the agent's reply to it.
describe('a desk prompt taken while the chat was closed, opened on the cached tab list', () => {
  const history = [{ state: 'done', prompt: 'earlier', startedAt: 500 }]
  const cached = { state: 'working', prompt: 'run the migration', updatedAt: 3_600_000, stateStartedAt: 1_000, stateHistory: history }
  function reader() {
    let listed: readonly { text: string; at?: number }[] = []
    let renderer!: ReactTestRenderer
    function Chat({ status, live }: { status: AgentStatusPromptSource; live: boolean }) {
      listed = useAgentStatusPrompts('sess-1', status, undefined, true, live).prompts
      return null
    }
    return {
      show(status: AgentStatusPromptSource, live: boolean) {
        act(() => {
          if (renderer) {
            renderer.update(createElement(Chat, { status, live }))
          } else {
            renderer = create(createElement(Chat, { status, live }))
          }
        })
      },
      done() {
        act(() => renderer.unmount())
        return listed.map((prompt) => [prompt.text, prompt.at])
      }
    }
  }

  it('is timed by the run it came in, no earlier than the cached status, on the host’s first status', () => {
    const chat = reader()
    chat.show(cached, false)
    chat.show({ ...cached, prompt: 'and keep the old table', updatedAt: 3_606_000 }, true)
    expect(chat.done()).toEqual([
      ['run the migration', 1_000],
      ['and keep the old table', 3_600_000]
    ])
  })

  it('is timed by the run it came in when the cached status had no time and the run began after it', () => {
    const chat = reader()
    chat.show({ ...cached, updatedAt: undefined }, false)
    chat.show({ ...cached, prompt: 'and keep the old table', updatedAt: 3_606_000 }, true)
    expect(chat.done()).toEqual([
      ['run the migration', 1_000],
      ['and keep the old table', 1_000]
    ])
  })

  // The tab list keeps the cached objects when the host's first list is
  // equal. A latch that waited for a new object would take the next prompt
  // the chat does watch arrive for one it found, and time it early.
  it('times the next prompt the chat watches arrive by its own stamp when the host’s first status repeated the cached one', () => {
    const chat = reader()
    chat.show(cached, false)
    chat.show(cached, true)
    chat.show({ ...cached, prompt: 'and keep the old table', updatedAt: 3_606_000 }, true)
    expect(chat.done()).toEqual([
      ['run the migration', 1_000],
      ['and keep the old table', 3_606_000]
    ])
  })

  it('says in the log how it placed it, and that the chat did not watch it arrive', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const chat = reader()
    chat.show(cached, false)
    chat.show({ ...cached, prompt: 'and keep the old table', updatedAt: 3_606_000 }, true)
    chat.done()
    expect(info.mock.calls.map((call) => String(call[0]))).toEqual([
      '[desk-prompt] drawn: "run the migration" (found on the chat\'s first status) placed from 1970-01-01T00:00:01.000Z, the start of the run it came in',
      '[desk-prompt] drawn: "and keep the old table" (found on the first status since a reconnect or the cached tab list, after "run the migration") placed from 1970-01-01T01:00:00.000Z, the last status read before it that carried a prompt'
    ])
    info.mockRestore()
  })
})
