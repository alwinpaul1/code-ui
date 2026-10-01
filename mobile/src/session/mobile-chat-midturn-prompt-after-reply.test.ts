// Reported from the phone on 2026-09-29 with a screenshot, "Prompt leaking at
// the end": a Claude Code chat whose last reply ends "…Should I push them and
// open one PR? … session:ok", its Copy and scroll-up row under it, and under
// THAT a user bubble reading "Password changes now end only password sessions.
// … Whats this". The message was sent mid-turn at 05:36 and Claude answered it
// in that last reply ("You asked what the … line means"), so it belongs where
// it arrived, not under the answer as a new prompt.
//
// The session's own records, Claude Code 2.1.284 (1-based lines of the turn):
//     6 user, promptSource "typed", the prompt that opened the turn, 05:08:00.467
//   638 queue-operation enqueue, 05:36:01.523 ("…web session.\n\nWhats this issue")
//   642 queue-operation remove, reason `absorbed_mid_turn`, 05:36:02.185
//   643 attachment `queued_command`, origin human, stamped 05:36:01.523
//   661 queue-operation enqueue, 05:36:34.891 ("…web session.\n\nWhats this",
//       the same words less " issue")
//   665 queue-operation remove, reason `absorbed_mid_turn`, 05:37:31.338
//   666 attachment `queued_command`, stamped 05:36:34.891
//   748 assistant text, the last reply, 05:46:50.778
//   749 the first Stop hook's record, 05:46:51.005
// Orca's transcript reader keeps only `user` and `assistant` records, so the
// phone holds no row for either message; the tab status's `agentStatus.prompt`
// is its copy of them (agent-status-prompts.ts).
//
// Every clock that copy can be timed by puts it above the last reply: each
// working status that carried it was stamped by a hook at or before the last
// PostToolUse (05:46:41.308), and the `done` after it is placed by the run it
// came in, which began at 05:08. The bubble can only land under the reply when
// the status reader takes the message for a NEW prompt after the turn ended.
// It did that when a status carrying no prompt came between two that carried
// it: the reader forgot the text it had last read, took the next copy of the
// same message for a new submission, and timed it by the last status read
// before the reconnect, the turn's `done`, which is after the last reply.
// Two such statuses exist: a tab snapshot with no status at all (a relay
// re-dial or a re-hydrating tab list, which use-agent-status-prompts.ts
// already guards its reconnect latch against), and Orca's own stand-in when
// its hook row is stale or the terminal title is not the agent's
// (`buildRuntimeMobileAgentStatus` and the idle-title branch of
// runtime-mobile-session-projection.ts, origin/main 8d6fec597b): `done`,
// `prompt: ''`, `stateHistory: []`. On the build the phone ran, its log
// names the clock (`[desk-prompt] drawn: "Password changes now end…" (found
// on the first status since a reconnect or the cached tab list) placed from
// 2026-09-29T05:46:51.005Z, the last status read before it`), not which of
// the two came before it; both are pinned here. The line now also names the
// prompt the reader held when the copy came (agent-status-prompts.ts).
//
// The rows are the transcript's own records (uuid, role, time), a tail page of
// them as the chat holds one (its first read is 40 rows, so the prompt that
// opened the turn is on a page not loaded). Their words are placeholders. The
// statuses follow Orca's agent-status store, which pushes a history entry only
// on a state change, so a prompt taken mid-run leaves the state's start where
// it was; their stamps are the hook records' own times.
import { describe, expect, it, vi } from 'vitest'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import {
  at,
  FIRST_SEND,
  SECOND_SEND,
  EARLIER,
  OPENING,
  OPENING_ROW,
  NEXT,
  WRITTEN_BEFORE_SECOND,
  WRITTEN_AFTER_SECOND,
  BEFORE_FIRST,
  AFTER_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  NEXT_ROW,
  TURN_ENDED,
  working,
  done,
  standIn,
  statusReader,
  drawn,
  midturnChat
} from './mobile-chat-midturn-prompt.test-support'

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View'
}))
const frames = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) => {
      frames.push(props)
      return h('ChatView', props)
    }
  }
})

describe('a message sent mid-turn, after the reply that answered it', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, where, watchTheTurn, expectSentWhereItArrived } = midturnChat(frames, () => agent)

  for (const kind of ['claude', 'codex'] as const) {
    describe(`on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, () => {
      it('stays where it was sent, once, when a reconnect after the turn comes back through a tab snapshot with no status', async () => {
        agent = kind
        const reader = statusReader()
        await watchTheTurn(reader)
        expectSentWhereItArrived()
        // The relay drops and re-dials; the tab list comes back before the
        // tab's status does.
        vi.setSystemTime(at('05:47:30.000'))
        reader.read(done(SECOND_SEND), { connected: false })
        reader.read(null, { connected: false })
        reader.read(null)
        const prompts = reader.read(done(SECOND_SEND))
        await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
        expectSentWhereItArrived()
        reader.unmount()
        unmount()
      })

      it('stays where it was sent, once, when Orca stands in a status with no prompt after the turn and a reconnect brings the real one back', async () => {
        agent = kind
        const reader = statusReader()
        await watchTheTurn(reader)
        vi.setSystemTime(at('05:47:10.000'))
        let prompts = reader.read(standIn('05:47:09.000'))
        await showAt('05:47:10.100', WHOLE_TURN, prompts, false)
        vi.setSystemTime(at('05:47:30.000'))
        reader.read(standIn('05:47:09.000'), { connected: false })
        reader.read(standIn('05:47:09.000'))
        prompts = reader.read(done(SECOND_SEND))
        await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
        expectSentWhereItArrived()
        reader.unmount()
        unmount()
      })
    })
  }

  it('is not drawn a second time when the status carries no prompt for a moment mid-turn', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:01.700'))
    prompts = reader.read(working(FIRST_SEND, '05:36:01.523'))
    await showAt('05:36:01.800', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    // A tab snapshot with no status, then the next tool ping (line 664).
    vi.setSystemTime(at('05:37:31.400'))
    reader.read(null)
    prompts = reader.read(working(SECOND_SEND, '05:37:31.306'))
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    expectSentWhereItArrived()
    reader.unmount()
    unmount()
  })

  // What the reader must still do: a message it never read, taken while the
  // link was down, is drawn after the last status it read before the drop.
  // Here that status is the earlier message's, so the message is drawn above
  // the reply, not under it; a status with no prompt read between says
  // nothing about the message and does not move it down.
  it('draws a message it never read, taken while the link was down, above the reply when a status with no prompt came between', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    // Orca's stand-in through the rest of the turn, then the drop.
    vi.setSystemTime(at('05:47:10.000'))
    prompts = reader.read(standIn('05:47:09.000'))
    await showAt('05:47:10.100', WHOLE_TURN, prompts, false)
    reader.read(standIn('05:47:09.000'), { connected: false })
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(standIn('05:47:09.000'))
    prompts = reader.read(done(SECOND_SEND))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.at[0]!).toBeLessThan(second.reply)
    reader.unmount()
    unmount()
  })

  // Review of 257768bc: the reconnect latch is left to any status that is not
  // null, as before. Held through statuses with no prompt, it took a message
  // the chat watched arrive long after the reconnect for one found there: on
  // a Claude lead whose cached prompt is empty (after startup, resume or
  // clear, with its run started by a teammate's message, which keeps the
  // cached prompt), Orca's genuine hook rows carry `prompt: ''`, and the
  // message was timed by the run's start and never drawn.
  it('draws a message watched arriving after a reconnect through hook rows with no prompt where it was sent', async () => {
    agent = 'claude'
    const reader = statusReader()
    const noPrompt = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
      ...working('', stamped),
      prompt: '',
      stateHistory: [{ state: 'done', prompt: '', startedAt: at('05:07:00.700') }]
    })
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(noPrompt('05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    reader.read(noPrompt('05:34:55.850'), { connected: false })
    vi.setSystemTime(at('05:36:03.000'))
    reader.read(noPrompt('05:34:55.850'))
    prompts = reader.read(noPrompt('05:36:02.200'))
    await showAt('05:36:30.000', BEFORE_SECOND, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read({ ...noPrompt('05:36:34.891'), prompt: normalizePromptField(SECOND_SEND) })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    const rows = drawn(frames.at(-1)!)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
    reader.unmount()
    unmount()
  })

  // The same with Orca's stand-in first on the way back, rows written while
  // the link was down, and the message sent after the reconnect. A message
  // taken WHILE the link was down, with the stand-in first on the way back,
  // reaches the reader in the same shape and, with no hook, is timed by its
  // ping, below the words written after it; the reader cannot tell the two
  // apart, and this one is the case the latch is not for. With the hook the
  // one taken during the drop is placed after the last status read before it
  // (mobile-chat-midturn-beacon-evidence.test.ts).
  for (const kind of ['claude', 'codex'] as const) {
    it(`draws a message sent after a reconnect whose first status was Orca's stand-in below the rows written during the drop, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      reader.read(working(EARLIER, '05:34:55.850'), { connected: false })
      vi.setSystemTime(at('05:36:28.000'))
      reader.read(working(EARLIER, '05:34:55.850'))
      prompts = reader.read({ ...standIn('05:36:26.000'), state: 'working' })
      await showAt('05:36:28.100', BEFORE_SECOND, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts)
      await showAt('05:46:50.900', WHOLE_TURN, prompts)
      const rows = drawn(frames.at(-1)!)
      const second = where(SECOND_SEND)
      expect(second.at).toHaveLength(1)
      expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
      expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
      reader.unmount()
      unmount()
    })
  }

  // Round-2 review of this branch: a hook row that carries no prompt, on a
  // pane whose cached prompt is empty, is a real reading (the message's
  // UserPromptSubmit would have put it on the next row). A message taken
  // while the link was down came after the last such row, and 257768bc's
  // `readAt` left it bounded by nothing but its run's start, 05:08, on a page
  // the chat has not loaded: never drawn. Only null and Orca's stand-in, with
  // no history of its own, are no reading.
  it('draws a message taken while the link was down, on hook rows with no prompt, after the rows watched before the drop', async () => {
    agent = 'claude'
    const reader = statusReader()
    const noPrompt = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
      ...working('', stamped),
      prompt: '',
      stateHistory: [{ state: 'done', prompt: '', startedAt: at('05:07:00.700') }]
    })
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(noPrompt('05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:03.000'))
    prompts = reader.read(noPrompt('05:36:02.200'))
    await showAt('05:36:03.100', AFTER_FIRST, prompts)
    vi.setSystemTime(at('05:36:26.000'))
    prompts = reader.read(noPrompt('05:36:25.100'))
    await showAt('05:36:26.100', BEFORE_SECOND, prompts)
    reader.read(noPrompt('05:36:25.100'), { connected: false })
    vi.setSystemTime(at('05:37:40.000'))
    reader.read(noPrompt('05:36:25.100'))
    prompts = reader.read({ ...noPrompt('05:37:31.306'), prompt: normalizePromptField(SECOND_SEND) })
    await showAt('05:37:40.100', WHOLE_TURN.filter((row) => row.timestamp! <= at('05:37:38.938')), prompts)
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    const rows = drawn(frames.at(-1)!)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
    reader.unmount()
    unmount()
  })

  // Gap C of the final review of fix/midturn-prompt-at-end (Orca's stand-in
  // as the chat's first status uses up its first read, so a message taken
  // before the chat opened is timed by the next status's ping) is settled
  // only by the prompt hook's copy of the message
  // (mobile-chat-midturn-beacon-evidence.test.ts). Taking the stand-in for no
  // read, as tried, timed the next status's message by the start of its run
  // instead, and a message typed after the chat opened, which Claude took
  // before a screen read listed it, is then on a page the chat has not loaded
  // and not drawn at all (the review of fix/midturn-gaps). Without the hook
  // the two cannot be told apart, and a message lost is the worse error:
  // drawn late, it is at least drawn. This pins that, with no hook.
  for (const kind of ['claude', 'codex'] as const) {
    it(`draws a message typed after the chat opened on Orca's stand-in where it was sent, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:26.000'))
      let prompts = reader.read({ ...standIn('05:36:25.500'), state: 'working' })
      await showAt('05:36:26.100', BEFORE_SECOND, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts)
      await showAt('05:37:40.000', WHOLE_TURN.filter((row) => row.timestamp! <= at('05:37:38.938')), prompts)
      const second = where(SECOND_SEND)
      expect(second.at).toHaveLength(1)
      expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
      reader.unmount()
      unmount()
    })
  }

  // Gap B of the final review of fix/midturn-prompt-at-end: after the chat
  // remounts (a relaunch, a tab switch back), the first status finds the last
  // message and times it by its run's start, 05:08, on a page the chat has not
  // loaded, so that copy is not drawn; and the message's stored bubble, which
  // the phone drew where it arrived, gave way to it. Nothing was drawn.
  for (const kind of ['claude', 'codex'] as const) {
    it(`keeps a mid-turn message where it was drawn after the chat remounts, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const reader = statusReader()
      await watchTheTurn(reader)
      expectSentWhereItArrived()
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      const prompts = again.read(done(SECOND_SEND))
      await showAt('05:48:00.100', WHOLE_TURN, prompts, false)
      await showAt('05:48:01.000', WHOLE_TURN, prompts, false)
      expectSentWhereItArrived()
      again.unmount()
      unmount()
    })
  }

  // Degenerate: a turn with no mid-turn message. The status carries the
  // prompt that opened it, whose row is on a page the chat has not loaded.
  it('draws nothing under the reply of a turn that had no mid-turn message', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:46:41.500'))
    let prompts = reader.read(working(OPENING, '05:46:41.308'))
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    vi.setSystemTime(at('05:46:51.100'))
    prompts = reader.read(done(OPENING))
    await showAt('05:46:51.200', WHOLE_TURN, prompts, false)
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(done(OPENING), { connected: false })
    reader.read(null)
    prompts = reader.read(done(OPENING))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    const rows = drawn(frames.at(-1)!)
    expect(rows.filter((row) => row.role === 'user')).toEqual([])
    reader.unmount()
    unmount()
  })

  // Degenerate: the message is the only user row the chat holds, and it was
  // sent twice with the same words, so the status never changed between them.
  it('draws a message sent twice with the same words once, where it was first sent', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    vi.setSystemTime(at('05:37:31.400'))
    prompts = reader.read(working(SECOND_SEND, '05:37:31.306'))
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(done(SECOND_SEND), { connected: false })
    reader.read(null)
    prompts = reader.read(done(SECOND_SEND))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    reader.unmount()
    unmount()
  })

  // The two messages differ only by the first's last word, and each is a
  // message of its own. The chat keeps what it drew of them in its witness
  // memory, which is all it draws from once its reader starts over and the
  // status carries only the second (the tab's terminal looked at, then the
  // chat again). That memory took the first for the second with the screen's
  // rows glued on, and kept only the second.
  it('keeps both of two messages that differ by a last word, each where it was sent, after the terminal is looked at', async () => {
    agent = 'claude'
    const reader = statusReader()
    await watchTheTurn(reader)
    expectSentWhereItArrived()
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(done(SECOND_SEND), { shown: false })
    const prompts = reader.read(done(SECOND_SEND))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    expectSentWhereItArrived()
    reader.unmount()
    unmount()
  })

  // The same message by the other copy the phone can hold, the prompt hook's
  // beacon (agent-hud-launch-args.ts; Claude Code only, a Codex tab's beacon
  // carries no prompt). The beacon names the row the message was typed after
  // (`at=`). Until 2026-09-29 the hook skipped every record with `"tool_use"`
  // anywhere in it, and Claude Code 2.1.284 writes each text record of a turn
  // that goes on to a tool with `"stop_reason":"tool_use"`, so a message sent
  // mid-turn named the last row of a finished turn: here the prompt that
  // opened this one (line 6), on a page the chat has not loaded. The hook now
  // skips a record by its block's `"type":` (agent-hud-prompt-anchor.test.ts),
  // but a tab launched before that keeps the old hook until its agent
  // restarts, and this is what its beacon says. The copy waits for that row, drawn
  // meanwhile where it was first seen. Until 2026-09-29
  // use-desktop-prompt-echoes.ts alone settled it on the tail of its 30th
  // reading, which with the phone asleep through the turn is the last reply,
  // and the witness memory, which stores the first place, masked that; it now
  // settles where it was first seen by itself (use-desktop-prompt-echoes.test.ts,
  // "a waiting copy whose row never loads"). This passed before the fixes above
  // and pins that it still does.
  it('keeps a beaconed mid-turn message where it was first seen when the row it names never loads', async () => {
    agent = 'claude'
    vi.setSystemTime(at('05:36:35.000'))
    const beaconed: DesktopPrompt = { nonce: '48213', text: SECOND_SEND, anchorId: OPENING_ROW, seenAt: at('05:36:35.000') }
    await showAt('05:36:35.100', BEFORE_SECOND, [beaconed])
    // The phone wakes after the turn with every row in, and the chat is read
    // again on every beat.
    for (let beat = 0; beat < 20; beat += 1) {
      await showAt(`05:47:${String(10 + beat).padStart(2, '0')}.000`, WHOLE_TURN, [beaconed], false)
    }
    const rows = drawn(frames.at(-1)!)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
    unmount()
  })

  // The next prompt starts a turn and lands as a row; its status copy is
  // drawn until the row comes and never again after, blink or not.
  it('draws the next prompt once, before its row lands and after, across a status with no prompt', async () => {
    agent = 'claude'
    const reader = statusReader()
    await watchTheTurn(reader)
    // The new run: the turn and its end pushed to the history.
    const nextRun = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
      ...working(NEXT, stamped),
      stateStartedAt: at('05:49:47.000'),
      stateHistory: [...done(SECOND_SEND).stateHistory!, { state: 'done', prompt: normalizePromptField(SECOND_SEND), startedAt: TURN_ENDED }]
    })
    vi.setSystemTime(at('05:49:47.100'))
    let prompts = reader.read(nextRun('05:49:47.000'))
    await showAt('05:49:47.200', WHOLE_TURN, prompts)
    expect(where(NEXT).at).toHaveLength(1)
    expect(where(NEXT).at[0]!).toBeGreaterThan(where(NEXT).reply)
    reader.read(null)
    prompts = reader.read(nextRun('05:49:50.000'))
    await showAt('05:49:50.100', [...WHOLE_TURN, NEXT_ROW], prompts)
    expect(where(NEXT).at).toHaveLength(1)
    expectSentWhereItArrived()
    reader.unmount()
    unmount()
  })
})
