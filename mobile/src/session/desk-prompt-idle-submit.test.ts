import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import { useWithoutScheduledTicks } from './scheduled-prompt-ticks'
import { rememberedScheduledPrompts, resetScheduledPromptMemoryForTests } from './scheduled-prompt-memory'
import { NO_ROWS_WAIT_MS, resetIdleSubmitForTests } from './desk-prompt-idle-submit'

// A loop's tick on a tab with no prompt hook has no mark and, when its loop
// call was never loaded, no words to match: Orca's status copy of it is a
// prompt that began a working run, exactly as a typed prompt at an idle pane
// is. What tells them apart is the transcript: a typed prompt is written as a
// user row of its words before the agent answers, and a tick, an `isMeta` row
// Orca draws nothing for, is not. So a copy that began a run waits for rows,
// and a first reply with no user row of its words before it makes it a tick.
// Claude Code 2.1.286 (the user row's shape: fixtures/claude-scheduled-tick-2.1.286.ts).

const SESSION = 'sess-idle-gate'
const T0 = Date.parse('2026-10-01T02:21:49.600Z')
const TICK = 'Check the build host and report in one line.'

const row = (id: string, role: 'assistant' | 'user', text: string, timestamp: number | null): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp,
  source: 'transcript'
})
const toolResult = (id: string, timestamp: number): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'tool-result', output: 'ok' }],
  timestamp,
  source: 'transcript'
})
const idleCopy = (text: string, at = T0, nonce = `status:${SESSION}:${at}:0`): DesktopPrompt => ({
  nonce,
  text,
  at,
  seenAt: Date.now(),
  idleSubmit: true
})

type Props = {
  prompts: readonly DesktopPrompt[]
  messages: readonly NativeChatMessage[]
  agent?: string
  promptHook?: boolean
  readSettled?: boolean
}
let kept: readonly DesktopPrompt[] = []

function Probe({ prompts, messages, agent = 'claude', promptHook = false, readSettled = true }: Props) {
  kept = useWithoutScheduledTicks(prompts, messages, SESSION, { agent, promptHook, readSettled })
  return null
}

describe('a prompt that began a working run, on a Claude tab with no prompt hook', () => {
  let renderer: ReactTestRenderer | null = null
  const render = (props: Props) => {
    act(() => {
      if (renderer === null) {
        renderer = create(createElement(Probe, props))
      } else {
        renderer.update(createElement(Probe, props))
      }
    })
    return kept.map((prompt) => prompt.text)
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    resetIdleSubmitForTests()
    resetScheduledPromptMemoryForTests()
    kept = []
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('draws no bubble for a tick on a tab with no hook once its turn’s first reply lands', () => {
    const prompts = [idleCopy(TICK)]
    const earlier = row('a0', 'assistant', 'Earlier reply.', T0 - 60_000)
    expect(render({ prompts, messages: [earlier] })).toEqual([])
    const reply = row('a1', 'assistant', 'No change.', T0 + 3000)
    expect(render({ prompts, messages: [earlier, reply] })).toEqual([])
    // Still no bubble once the rows have moved on.
    expect(render({ prompts, messages: [earlier, reply, row('a2', 'assistant', 'Done.', T0 + 9000)] })).toEqual([])
  })

  it('holds a typed prompt’s copy while its row is still loading, then lets it retire against the row', () => {
    const typed = 'and also dump the row counts'
    const prompts = [idleCopy(typed)]
    // Held, not dropped: nothing is decided without a row.
    expect(render({ prompts, messages: [row('a0', 'assistant', 'earlier reply', T0 - 60_000)] })).toEqual([])
    // Its own row lands, then the first reply: the copy stands, and the
    // landed-prompt rule downstream retires it against the row.
    const own = row('u1', 'user', typed, T0 + 40)
    expect(render({ prompts, messages: [own] })).toEqual([typed])
    expect(render({ prompts, messages: [own, row('a1', 'assistant', 'On it.', T0 + 2000)] })).toEqual([typed])
  })

  it('keeps a typed prompt whose row is stamped just before the status’s own time', () => {
    const prompts = [idleCopy('check the logs')]
    expect(render({ prompts, messages: [row('u1', 'user', 'check the logs', T0 - 400), row('a1', 'assistant', 'ok', T0 + 1500)] })).toEqual([
      'check the logs'
    ])
  })

  it('takes a cut status copy for its long row', () => {
    const long = `${'word '.repeat(60)}end`
    const copy: DesktopPrompt = { ...idleCopy(long.slice(0, 199)), cut: true }
    expect(render({ prompts: [copy], messages: [row('u1', 'user', long, T0 + 30), row('a1', 'assistant', 'ok', T0 + 900)] })).toEqual([
      long.slice(0, 199)
    ])
  })

  // The status folds a prompt to one line and the row keeps its lines; a
  // mismatch here would read a typed message as a tick and drop it.
  it('keeps a typed multi-line prompt, whose status copy is folded to one line', () => {
    const typed = 'First do this:\n\n  1. read the log\n  2. count the rows\n\nThen report.'
    const copy = idleCopy(normalizePromptField(typed))
    const earlier = row('a0', 'assistant', 'Earlier reply.', T0 - 60_000)
    expect(render({ prompts: [copy], messages: [earlier, row('u1', 'user', typed, T0 + 40), row('a1', 'assistant', 'On it.', T0 + 2000)] })).toEqual([
      copy.text
    ])
  })

  it('keeps a mid-turn message’s bubble while the turn’s rows keep landing', () => {
    // Its run began minutes before: the reader never marks it (`idleSubmit`
    // absent), so the gate never looks at it, whatever the rows say.
    const midTurn: DesktopPrompt = { nonce: `status:${SESSION}:${T0}:0`, text: 'also check the queue', at: T0, seenAt: Date.now() }
    const rows = [row('a1', 'assistant', 'Running.', T0 - 120_000), row('a2', 'assistant', 'Still running.', T0 + 2000)]
    expect(render({ prompts: [midTurn], messages: rows })).toEqual(['also check the queue'])
  })

  it('draws the copy after 30 s with no rows', () => {
    const prompts = [idleCopy(TICK)]
    expect(render({ prompts, messages: [] })).toEqual([])
    // No new reading: the timer the hook armed brings it back.
    act(() => {
      vi.advanceTimersByTime(NO_ROWS_WAIT_MS + 50)
    })
    expect(kept.map((prompt) => prompt.text)).toEqual([TICK])
  })

  it('keeps the copy held after 30 s while the chat’s read has not settled', () => {
    const prompts = [idleCopy(TICK)]
    expect(render({ prompts, messages: [], readSettled: false })).toEqual([])
    act(() => {
      vi.advanceTimersByTime(NO_ROWS_WAIT_MS + 50)
    })
    expect(kept).toEqual([])
    expect(render({ prompts, messages: [], readSettled: true })).toEqual([TICK])
  })

  it('does not hold or drop a copy on a Codex tab, or on a tab with the prompt hook', () => {
    const answered = [row('a0', 'assistant', 'Earlier reply.', T0 - 60_000), row('a1', 'assistant', 'No change.', T0 + 3000)]
    expect(render({ prompts: [idleCopy(TICK)], messages: [], agent: 'codex' })).toEqual([TICK])
    expect(render({ prompts: [idleCopy(TICK)], messages: answered, agent: 'codex' })).toEqual([TICK])
    expect(render({ prompts: [idleCopy(TICK)], messages: [], promptHook: true })).toEqual([TICK])
    expect(render({ prompts: [idleCopy(TICK)], messages: answered, promptHook: true })).toEqual([TICK])
    expect(render({ prompts: [idleCopy(TICK)], messages: answered })).toEqual([])
  })

  it('draws a slash command or a photo-only prompt as before, whatever the rows say', () => {
    const prompts = [idleCopy('/compact keep the schema notes', T0, 'status:a'), idleCopy('[Image #3]', T0 + 1, 'status:b')]
    expect(render({ prompts, messages: [row('a1', 'assistant', 'ok', T0 + 3000)] })).toEqual(['/compact keep the schema notes', '[Image #3]'])
  })

  it('waits when the held rows do not reach back before the prompt, so its own row may be on an earlier page', () => {
    const prompts = [idleCopy('check the logs')]
    expect(render({ prompts, messages: [row('a1', 'assistant', 'ok', T0 + 1500)] })).toEqual([])
    // The earlier page loads and holds its row: it was typed.
    expect(render({ prompts, messages: [row('u1', 'user', 'check the logs', T0 + 30), row('a1', 'assistant', 'ok', T0 + 1500)] })).toEqual([
      'check the logs'
    ])
  })

  it('does not take a reply stamped before the prompt for its turn’s first', () => {
    const prompts = [idleCopy('check the logs')]
    expect(render({ prompts, messages: [row('a1', 'assistant', 'earlier', T0 - 5000)] })).toEqual([])
  })

  it('holds a tool result that is no row of its words, and decides on the reply after it', () => {
    const prompts = [idleCopy(TICK)]
    const earlier = row('a0', 'assistant', 'Earlier reply.', T0 - 60_000)
    expect(render({ prompts, messages: [earlier, toolResult('t1', T0 + 500)] })).toEqual([])
    expect(render({ prompts, messages: [earlier, toolResult('t1', T0 + 500), row('a1', 'assistant', 'ok', T0 + 900)] })).toEqual([])
    expect(rememberedScheduledPrompts(SESSION)).toEqual([])
  })

  it('leaves a copy with no time to compare, and one over rows with no time, to the wait', () => {
    const noTime: DesktopPrompt = { nonce: 'status:x', text: TICK, seenAt: Date.now(), idleSubmit: true }
    expect(render({ prompts: [noTime], messages: [row('a1', 'assistant', 'ok', T0 + 900)] })).toEqual([TICK])
    expect(render({ prompts: [idleCopy(TICK)], messages: [row('a1', 'assistant', 'ok', null)] })).toEqual([])
  })

  it('degenerate: no prompts, and one message', () => {
    expect(render({ prompts: [], messages: [] })).toEqual([])
    expect(render({ prompts: [], messages: [row('a1', 'assistant', 'ok', T0)] })).toEqual([])
    expect(render({ prompts: [idleCopy(TICK)], messages: [row('a1', 'assistant', 'ok', T0)] })).toEqual([])
  })

  describe('what a tick teaches the session', () => {
    const earlier = row('a0', 'assistant', 'Earlier reply.', T0 - 60_000)
    const reply = (id: string, at: number) => row(id, 'assistant', 'No change.', at)

    it('remembers the words only after a second tick', () => {
      const first = idleCopy(TICK, T0, 'status:t1')
      render({ prompts: [first], messages: [earlier, reply('a1', T0 + 3000)] })
      expect(rememberedScheduledPrompts(SESSION)).toEqual([])
      const second = idleCopy(TICK, T0 + 180_000, 'status:t2')
      render({ prompts: [first, second], messages: [earlier, reply('a1', T0 + 3000), reply('a2', T0 + 183_000)] })
      expect(rememberedScheduledPrompts(SESSION).map((entry) => entry.words)).toEqual([TICK])
    })

    it('does not count one copy twice, or two different prompts, as a second tick', () => {
      const first = idleCopy(TICK, T0, 'status:t1')
      render({ prompts: [first], messages: [earlier, reply('a1', T0 + 3000)] })
      render({ prompts: [first], messages: [earlier, reply('a1', T0 + 3000), reply('a2', T0 + 9000)] })
      expect(rememberedScheduledPrompts(SESSION)).toEqual([])
      render({ prompts: [first, idleCopy('look at the queue', T0 + 180_000, 'status:t2')], messages: [earlier, reply('a1', T0 + 3000), reply('a2', T0 + 183_000)] })
      expect(rememberedScheduledPrompts(SESSION)).toEqual([])
    })

    it('remembers a copy cut at 200 as a prefix of the prompt', () => {
      const long = `${'word '.repeat(60)}end`
      const cut = (nonce: string, at: number): DesktopPrompt => ({ ...idleCopy(long.slice(0, 199), at, nonce), cut: true })
      const [one, two] = [cut('status:c1', T0), cut('status:c2', T0 + 180_000)]
      render({ prompts: [one, two], messages: [earlier, reply('a1', T0 + 3000), reply('a2', T0 + 183_000)] })
      expect(rememberedScheduledPrompts(SESSION)).toEqual([{ words: long.slice(0, 199).trim(), cut: true }])
    })

    it('drops a third tick at once, with no wait for rows', () => {
      const [one, two] = [idleCopy(TICK, T0, 'status:t1'), idleCopy(TICK, T0 + 180_000, 'status:t2')]
      render({ prompts: [one, two], messages: [earlier, reply('a1', T0 + 3000), reply('a2', T0 + 183_000)] })
      expect(render({ prompts: [one, two, idleCopy(TICK, T0 + 360_000, 'status:t3')], messages: [] })).toEqual([])
    })
  })
})
