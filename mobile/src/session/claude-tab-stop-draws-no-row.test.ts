import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NATIVE_CHAT_INTERRUPTED_STATUS_TEXT, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData, foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { drawsStoppedTurnRow } from './mobile-native-chat-error-rows'
import { agentTurnsByEnd, trailingWorkIsRunning } from './mobile-native-chat-turn-end'

// A Claude tab that is not matched to an Anthropic session reads Orca's
// transcript, whose decoder turns Claude Code's `[Request interrupted by
// user]` record into a status row, and the chat drew it as a red "Session
// interrupted" after every Stop. The Claude app (1.261013.20) draws nothing for
// a Stop: the marker becomes no row (`u5a.j`, `t5v`) and its `result` row draws
// nothing (`gy30`), which a matched tab already does (542b5935e). Codex keeps
// its row: the Claude app has no Codex screen to copy.
//
// Only the drawn row goes. The Stop still ends the turn: review of 3308bfbe1
// found that taking the row out of the list merged the turns around it and
// read the call it cut off as still running.

const user = (id: string, text: string): NativeChatMessage => ({ id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' })
const assistant = (id: string, text: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' })
/** Orca's row for a stopped turn, from Claude Code's interrupt record and from Codex's `turn_aborted` alike. */
const stopped = (id: string): NativeChatMessage => ({
  id,
  role: 'system',
  blocks: [{ type: 'text', text: NATIVE_CHAT_INTERRUPTED_STATUS_TEXT }],
  timestamp: 0,
  source: 'transcript'
})

/** The list the chat view builds, as it builds it: the same for every agent. */
function list(
  messages: NativeChatMessage[],
  pending: Parameters<typeof buildMobileNativeChatTransientData>[0]['pending'] = []
): NativeChatMessage[] {
  return buildMobileNativeChatTransientData({
    messages,
    folded: foldMobileNativeChatMessages(messages),
    streaming: null,
    pending
  }).data
}

/** The rows the list draws something for on a tab of `agent`. */
const drawn = (rows: NativeChatMessage[], agent: string | null): string[] =>
  rows.filter((row) => drawsStoppedTurnRow(row, agent)).map((row) => row.id)

const STOPPED_TURN = [user('u1', 'go'), assistant('a1', 'Looking.'), stopped('s1'), user('u2', 'again')]

describe('a stopped turn on a Claude tab Orca reads', () => {
  it('draws no row for the Stop, as the Claude app draws none', () => {
    expect(drawn(list(STOPPED_TURN), 'claude')).toEqual(['u1', 'a1', 'u2'])
  })

  it('draws nothing at all for a transcript that is only the Stop', () => {
    expect(drawn(list([stopped('s1')]), 'claude')).toEqual([])
  })

  it('keeps a message sent right after the Stop where it was sent', () => {
    expect(
      drawn(list([user('u1', 'go'), assistant('a1', 'Looking.'), stopped('s1')], [{ id: 'p1', text: 'next', drawAfterId: 's1' }]), 'claude')
    ).toEqual(['u1', 'a1', 'p1'])
  })

  // P2 of the review: a1 and a2 read as one turn, one Copy for both.
  it('still ends the turn at the Stop: the replies either side are two turns', () => {
    const rows = list([user('u1', 'go'), assistant('a1', 'First.'), stopped('s1'), assistant('a2', 'Second.')])
    expect([...agentTurnsByEnd(rows).keys()]).toEqual(['a1', 'a2'])
  })

  // P1 of the review: with the agent working on a new turn, the call the Stop
  // cut off read as running, and the turn's actions hung above it.
  it('does not read the call the Stop cut off as running while the agent works on', () => {
    const cut: NativeChatMessage = {
      id: 'a1',
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Running the tests.' },
        { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test', description: 'Run the tests' } }
      ],
      timestamp: 0,
      source: 'transcript'
    }
    const rows = list([user('u1', 'go'), cut, stopped('s1')])
    const turn = agentTurnsByEnd(rows).get('a1')!
    expect(turn.isNewest).toBe(false)
    const runs = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: true }
    expect(trailingWorkIsRunning(turn.trailingWork, { turnIsNewest: turn.isNewest, runs })).toBe(false)
  })
})

describe('a stopped turn on a Codex tab', () => {
  it('keeps its list and its Session interrupted row', () => {
    const rows = list(STOPPED_TURN)
    expect(rows.map((row) => row.id)).toEqual(['u1', 'a1', 's1', 'u2'])
    expect(drawn(rows, 'codex')).toEqual(['u1', 'a1', 's1', 'u2'])
  })

  it('keeps it where the agent is not known either', () => {
    expect(drawn(list(STOPPED_TURN), null)).toEqual(['u1', 'a1', 's1', 'u2'])
  })
})

// The rule only holds if the chat view asks it of every row it draws. Matched
// against code, not the comments around it.
describe('the chat view', () => {
  it("asks of each row whether the tab's agent draws it", () => {
    const source = readFileSync(join(import.meta.dirname, 'MobileNativeChatView.tsx'), 'utf8')
    const code = source.replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/drawsStoppedTurnRow\(item, agent\)/)
  })
})
