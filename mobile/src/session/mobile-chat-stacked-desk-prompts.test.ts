// Reported from the phone on 2026-09-29: "All 3 prompts stacked together with
// no responses in between them". A Claude Code chat drew three user bubbles in
// a row and none of the replies that sit between them. The screenshot did not
// reach anyone, so this pins the path that draws that picture from the real
// records of the same day's session (mobile-chat-midturn-prompt.test-support.ts,
// Claude Code 2.1.284), and the case that must keep drawing three in a row.
//
// The prompt hook's copy of a mid-turn message names the text row it was typed
// after (`at=`). When the chat does not hold that row, the copy waits, drawn
// where the chat first saw it, and settles there. After a sleep the phone reads
// every beacon of the turn at once and its first page is the turn's tail: the
// rows the copies name are on the page above, so every copy was first seen on
// the same last reply and settled under it, one after another. The hook now
// says when it ran, by the desk's clock (`ts=`), which places each copy among
// the rows by the time they were written, or above a page it came before.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAgentHudBeaconPayload, type DesktopPrompt } from './agent-hud-beacon'
import {
  at,
  FIRST_SEND,
  SECOND_SEND,
  BEFORE_FIRST,
  WRITTEN_BEFORE_SECOND,
  WRITTEN_AFTER_SECOND,
  WHOLE_TURN,
  LAST_REPLY,
  drawn,
  oneLine,
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

/** The payload the prompt hook writes (agent-hud-launch-args.ts): the words as
 *  a JSON string body, `%`, space and `;` percent-encoded; the row it names;
 *  and, from 2026-09-29, the second it ran (`ts=`, by the desk clock). A tab
 *  launched before that sends no `ts=`. */
function hookFrame(nonce: string, words: string, anchorId: string, typed: string | null): string {
  const body = JSON.stringify(words).slice(1, -1).replace(/%/g, '%25').replace(/ /g, '%20').replace(/;/g, '%3B')
  const ts = typed === null ? '' : ` ts=${Math.floor(at(typed) / 1000)}`
  return `CUIHUD1 agent=claude sid=4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11 up=${nonce}:${body} at=${anchorId}${ts}`
}

/** The copy the beacon store holds for that frame, received at `received`. */
function hookCopy(nonce: string, words: string, anchorId: string, typed: string | null, received: string): DesktopPrompt {
  const prompt = parseAgentHudBeaconPayload(hookFrame(nonce, words, anchorId, typed))?.desktopPrompt
  if (!prompt) {
    throw new Error('the hook frame did not parse')
  }
  return { ...prompt, seenAt: at(received) }
}

/** The page the chat reads first after the sleep: the turn from 05:37:31 on,
 *  with the rows the two messages were typed after on the page above. */
const TAIL_PAGE = WHOLE_TURN.slice(WHOLE_TURN.findIndex((row) => row.id === 'b2fc1eee-5953-4f0f-8c7f-030e47884fd2'))
const LONG_CALL = '60a7be7b-a870-40e0-ad3d-b3278fb1c02a'
/** The call written after the words the second message names, 05:36:25.066,
 *  nine seconds before it was sent. */
const THE_CALL = 'c23a95c6-02db-4b9d-9c85-eb30b5d479ce'

describe('mid-turn desk messages the phone read all at once after a sleep', () => {
  const { unmount, showAt, where, expectSentWhereItArrived } = midturnChat(frames, () => 'claude')
  afterEach(() => {
    unmount()
    vi.restoreAllMocks()
  })

  it('are drawn where each was sent, not in a row after the answer', async () => {
    vi.setSystemTime(at('05:47:10.000'))
    const copies = [
      hookCopy('48101', FIRST_SEND, BEFORE_FIRST[0]!.id, '05:36:01.523', '05:47:10.000'),
      hookCopy('48213', SECOND_SEND, WRITTEN_BEFORE_SECOND, '05:36:34.891', '05:47:10.000')
    ]
    // The chat is read again on every beat, far past the copies' wait.
    for (let beat = 0; beat < 20; beat += 1) {
      await showAt(`05:47:${String(10 + beat).padStart(2, '0')}.000`, TAIL_PAGE, copies, false)
    }
    // Both were typed before every row of this page: they belong on the page
    // above, not under the last reply.
    const tail = drawn(frames.at(-1)!)
    expect(tail.filter((row) => row.role === 'user')).toEqual([])
    expect(tail.at(-1)?.id).toBe(LAST_REPLY)
    // The page above loads (the user scrolls up): each is drawn where it was sent.
    await showAt('05:47:40.000', WHOLE_TURN, copies, false)
    expectSentWhereItArrived()
    expect(where(FIRST_SEND).at[0]!).toBeLessThan(where(SECOND_SEND).at[0]!)
  })

  // Modeled on the same turn: three messages typed during its seven-minute
  // call (05:39:23 to 05:46:20), each after the words Claude wrote before it.
  // Nothing was written between them, so they are three in a row, after the
  // call they were sent during, and above the rows written after it.
  it('stay three in a row when all three were typed during one long call', async () => {
    vi.setSystemTime(at('05:47:10.000'))
    const words = ['check the web session too', 'and the password path', 'then open one PR']
    const copies = [
      hookCopy('50101', words[0]!, WRITTEN_AFTER_SECOND, '05:40:05.200', '05:47:10.000'),
      hookCopy('50102', words[1]!, WRITTEN_AFTER_SECOND, '05:42:30.700', '05:47:10.000'),
      hookCopy('50103', words[2]!, WRITTEN_AFTER_SECOND, '05:44:50.100', '05:47:10.000')
    ]
    for (let beat = 0; beat < 20; beat += 1) {
      await showAt(`05:47:${String(10 + beat).padStart(2, '0')}.000`, WHOLE_TURN, copies, false)
    }
    const rows = drawn(frames.at(-1)!)
    const places = words.map((body) => rows.findIndex((row) => row.role === 'user' && row.text === oneLine(body)))
    expect(places.every((place) => place > 0)).toBe(true)
    expect(places[1]).toBe(places[0]! + 1)
    expect(places[2]).toBe(places[1]! + 1)
    // After the words and the call they were typed during: the call folds into
    // those words, as the Claude app draws it, rather than being drawn below
    // the three as a row of its own. Above the reply.
    expect(rows[places[0]! - 1]?.id).toBe(WRITTEN_AFTER_SECOND)
    expect(rows.some((row) => row.id === LONG_CALL)).toBe(false)
    expect(places[2]!).toBeLessThan(rows.findIndex((row) => row.id === LAST_REPLY))
  })

  // The chat reads the transcript a moment behind the desk: a message typed
  // right after a call can reach the phone before the call's row does. Drawn
  // at first after the words above the call and remembered there, it has to
  // move below the call once that row loads, as the Claude app draws it; the
  // remembered place must not hold it above.
  it('moves below the call written before it when that row loads after the message was drawn', async () => {
    vi.setSystemTime(at('05:36:35.000'))
    // A nonce of its own: the chat keeps its echo anchors by nonce for the
    // life of the process, and the first case read this message too.
    const copy = [hookCopy('48613', SECOND_SEND, WRITTEN_BEFORE_SECOND, '05:36:34.891', '05:36:35.000')]
    const beforeTheCall = WHOLE_TURN.slice(0, WHOLE_TURN.findIndex((row) => row.id === WRITTEN_BEFORE_SECOND) + 1)
    await showAt('05:36:35.100', beforeTheCall, copy)
    expect(where(SECOND_SEND).after(where(SECOND_SEND).at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    const withTheCall = WHOLE_TURN.slice(0, WHOLE_TURN.findIndex((row) => row.id === THE_CALL) + 1)
    for (let beat = 0; beat < 3; beat += 1) {
      await showAt(`05:36:3${6 + beat}.000`, withTheCall, copy)
    }
    const rows = drawn(frames.at(-1)!)
    expect(where(SECOND_SEND).at).toHaveLength(1)
    // The call folds into the words above it, and the message follows both.
    expect(rows.some((row) => row.id === THE_CALL)).toBe(false)
    expect(where(SECOND_SEND).after(where(SECOND_SEND).at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(rows.at(-1)?.text).toBe(oneLine(SECOND_SEND))
  })

  // A tab launched before the hook said when it ran sends no `ts=`. Its copy
  // of a row the chat does not hold has nothing to place it by: it is still
  // drawn where the chat first saw it (a message is never dropped), and the
  // log says why, once, so a stack like the report's can be told from a bug.
  it('says in the log why a copy with no time and no held row is drawn where it was first seen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.setSystemTime(at('05:47:10.000'))
    const copies = [hookCopy('48313', SECOND_SEND, WRITTEN_BEFORE_SECOND, null, '05:47:10.000')]
    for (let beat = 0; beat < 20; beat += 1) {
      await showAt(`05:47:${String(10 + beat).padStart(2, '0')}.000`, TAIL_PAGE, copies, false)
    }
    expect(where(SECOND_SEND).at).toHaveLength(1)
    console.log('WARNS', JSON.stringify(warn.mock.calls.map((call) => String(call[0]).slice(0, 120))), JSON.stringify(drawn(frames.at(-1)!).map((row) => `${row.role}:${row.id.slice(0, 10)}`)), frames.length)
    const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('[desk-prompt] drawn where first seen'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Password changes now end only pa')
    expect(lines[0]).toContain(WRITTEN_BEFORE_SECOND)
    expect(lines[0]).toContain('sent no time')
  })
})
