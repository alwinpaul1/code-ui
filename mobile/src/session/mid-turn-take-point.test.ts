// drawnWhereTaken on its own, at the sizes where a scan breaks: no rows, one
// row, an anchor at the end, a result right after it. The rows are the
// 2026-10-11 report's records (session 0954729d, Claude Code 2.1.296; the
// story is at the top of mobile-chat-midturn-take-point.test.ts).
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { drawnWhereTaken, isSentElsewhere, placeSentElsewhereWhereTaken, placeWhereTaken } from './mid-turn-take-point'

const at = (clock: string) => Date.parse(`2026-10-11T${clock}Z`)
const row = (id: string, role: NativeChatMessage['role'], block: NativeChatMessage['blocks'][number], clock: string): NativeChatMessage => ({
  id,
  role,
  blocks: [block],
  timestamp: at(clock),
  source: 'transcript'
})

const FIRST = row('01d0b4ff-b079-442e-8ccb-9df647c67f72', 'user', { type: 'text', text: " [Image #94] Can't send messages due to this see how claude does manage these" }, '18:31:15.739')
const BASH = row('6eb82b9b-c4e5-4dc3-a701-460f111e2450', 'assistant', { type: 'tool-call', name: 'Bash', input: {} }, '18:31:42.642')
const BASH_RESULT = row('9bc170c9-de09-424b-a9cf-425daa3e6ea7', 'tool', { type: 'tool-result', output: '' }, '18:31:49.230')
const ANSWER = row(
  'ed14dac4-e417-48eb-99b8-83bd9377f5d5',
  'assistant',
  { type: 'text', text: "Your answers to 3 and 4 came through this time. You want both done the way Claude's code does them. Starting that now." },
  '18:32:00.120'
)
const AGENT = row('aadaccc4-6721-47f8-b174-f2a72b2cdd09', 'assistant', { type: 'tool-call', name: 'Agent', input: {} }, '18:32:13.155')
const AGENT_RESULT = row('1f4f053e-d080-416c-b2d6-4cac14a2ded6', 'tool', { type: 'tool-result', output: '' }, '18:32:16.997')
/** The next turn's prompt, modeled. */
const NEXT_PROMPT = row('next-prompt', 'user', { type: 'text', text: 'and the queue box too' }, '18:40:00.000')

describe('drawnWhereTaken', () => {
  it('leaves a message alone in a chat with no rows', () => {
    expect(drawnWhereTaken([], null, true)).toBeNull()
    expect(drawnWhereTaken([], FIRST.id, true)).toBe(FIRST.id)
  })

  it('keeps the only row when the message was placed after it', () => {
    expect(drawnWhereTaken([FIRST], FIRST.id, true)).toBe(FIRST.id)
    expect(drawnWhereTaken([FIRST], FIRST.id, false)).toBe(FIRST.id)
  })

  it('leaves a null anchor and one the chat does not hold as they are', () => {
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT], null, true)).toBeNull()
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT], 'not-held', true)).toBe('not-held')
  })

  it('goes after the first result written after its place', () => {
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT, ANSWER, AGENT, AGENT_RESULT], FIRST.id, true)).toBe(BASH_RESULT.id)
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT, ANSWER, AGENT, AGENT_RESULT], FIRST.id, false)).toBe(BASH_RESULT.id)
  })

  it('goes after a result that is the very next row, and after the last result of a run', () => {
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT], BASH.id, true)).toBe(BASH_RESULT.id)
    const second = row('second-result', 'tool', { type: 'tool-result', output: '' }, '18:31:49.300')
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT, second, ANSWER], FIRST.id, true)).toBe(second.id)
  })

  it('sits at the live end while the agent works and no result has come', () => {
    expect(drawnWhereTaken([FIRST, BASH], FIRST.id, true)).toBe(BASH.id)
    expect(drawnWhereTaken([FIRST, ANSWER], FIRST.id, true)).toBe(ANSWER.id)
  })

  it('keeps its place by the send once the agent is idle with no result after it', () => {
    expect(drawnWhereTaken([FIRST, ANSWER], FIRST.id, false)).toBe(FIRST.id)
  })

  it('keeps its place when a user row comes before any result', () => {
    expect(drawnWhereTaken([FIRST, ANSWER, NEXT_PROMPT, AGENT, AGENT_RESULT], FIRST.id, true)).toBe(FIRST.id)
  })

  // Session 0954729d, lines 643–675 (2026-10-08): one API message
  // (msg_011CfqC7nr3e…) made three calls, each written after the result of
  // the one before (Claude Code runs them as they stream), then the next step
  // began 12 s later. Claude never takes a queued message inside a step: of
  // 1,287 human queued_commands in 25 local transcripts, none sits there. A
  // call written within a second of a result is the same step's (about one
  // in five of them; no call of a NEW step came that soon, of 6,973).
  it('does not draw a message between the calls of one step that are written as they stream', () => {
    const stamp = (clock: string) => Date.parse(`2026-10-08T${clock}Z`)
    const toolRow = (id: string, kind: 'call' | 'result', clock: string): NativeChatMessage => ({
      id,
      role: kind === 'call' ? 'assistant' : 'tool',
      blocks: [kind === 'call' ? { type: 'tool-call', name: 'Bash', input: {} } : { type: 'tool-result', output: '' }],
      timestamp: stamp(clock),
      source: 'transcript'
    })
    const before = toolRow('cce36f17-5ed8-4c08-8713-eac21b165122', 'call', '17:49:39.197')
    const step = [
      toolRow('a1ce3b3a-3e99-4d80-9db2-33e61deee37f', 'result', '17:49:43.424'),
      toolRow('24e5adb3-fee0-442e-a769-8370c6767a6e', 'call', '17:49:46.022'),
      toolRow('945a6594-27d6-4a89-bbc6-91c951a10afe', 'result', '17:49:46.230'),
      toolRow('e5bf7c90-3369-4189-815f-ab8677da40a5', 'call', '17:49:46.773'),
      toolRow('ce5f8bac-5c6b-4c94-99bf-34866d11cb71', 'result', '17:49:46.976'),
      toolRow('b2d9d255-1a85-4940-9b1c-de6f6cbe7045', 'call', '17:49:47.212'),
      toolRow('5c08a533-2859-444f-90e3-0924111b533d', 'result', '17:49:47.389')
    ]
    const nextStep = row('2be57c5b-10e5-42a7-927d-58d945554197', 'assistant', { type: 'text', text: 'The next step.' }, '17:49:59.728')
    // Sent while the first call of the step ran: taken after its last result.
    expect(drawnWhereTaken([before, ...step, nextStep], step[1]!.id, true)).toBe(step[6]!.id)
    // The step's next result not in yet: still at the live end while it works.
    expect(drawnWhereTaken([before, ...step.slice(0, 4)], step[1]!.id, true)).toBe(step[3]!.id)
    // A result followed by a call a new step made (12 s on) is a take.
    expect(drawnWhereTaken([before, step[0]!, step[1]!], before.id, true)).toBe(step[0]!.id)
  })

  it('does not count a result the anchor already sits on or above', () => {
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT], BASH_RESULT.id, true)).toBe(BASH_RESULT.id)
    expect(drawnWhereTaken([FIRST, BASH, BASH_RESULT, ANSWER], BASH_RESULT.id, false)).toBe(BASH_RESULT.id)
  })
})

describe('placeWhereTaken', () => {
  const echo = (patch: Partial<MobileNativeChatPendingMessage> = {}): MobileNativeChatPendingMessage => ({
    id: 'desk-1',
    text: '3. Move Stop into the message box, as Claude does?',
    expectedOccurrence: 0,
    baselineTailMessageId: FIRST.id,
    baselineResolved: true,
    ...patch
  })

  it('returns the same list when nothing moves, empty or not', () => {
    const none: MobileNativeChatPendingMessage[] = []
    expect(placeWhereTaken(none, [FIRST], true)).toBe(none)
    const one = [echo()]
    expect(placeWhereTaken(one, [FIRST], true)).toBe(one)
  })

  it('moves only where it is drawn, from the row it is drawn after now', () => {
    const [placed] = placeWhereTaken([echo()], [FIRST, BASH, BASH_RESULT, ANSWER], true)
    expect(placed!.drawAfterId).toBe(BASH_RESULT.id)
    expect(placed!.baselineTailMessageId).toBe(FIRST.id)
    const [followed] = placeWhereTaken([echo({ drawAfterId: BASH.id })], [FIRST, BASH, BASH_RESULT, ANSWER], true)
    expect(followed!.drawAfterId).toBe(BASH_RESULT.id)
  })

  it('leaves an echo whose read had not settled where it is', () => {
    const unsettled = [echo({ baselineResolved: false })]
    expect(placeWhereTaken(unsettled, [FIRST, BASH, BASH_RESULT], true)).toBe(unsettled)
  })

  // The primitive moves whatever it is given; the overlay hands the phone's
  // own sends to placeSentElsewhereWhereTaken (below), which leaves them be.
  it('moves a queue-box reading and any other echo it is given as it moves a desk copy', () => {
    const rows = [FIRST, BASH, BASH_RESULT, ANSWER]
    const [absorbed] = placeWhereTaken([echo({ id: `absorbed-3. Move Stop@${FIRST.id}` })], rows, true)
    expect(absorbed!.drawAfterId).toBe(BASH_RESULT.id)
    const [own] = placeWhereTaken([echo({ id: 'pending-7', sentAt: at('18:31:32.087') })], rows, true)
    expect(own!.drawAfterId).toBe(BASH_RESULT.id)
  })
})

// The overlay's own-send pass: the pending store holds the phone's own sends
// and the witnesses it remembered of messages sent elsewhere. Only the second
// move to the take point; the Claude app draws its own sends where it sent
// them (docs/claude-app-parity.md item 14, 2026-10-11).
describe('placeSentElsewhereWhereTaken', () => {
  const rows = [FIRST, BASH, BASH_RESULT, ANSWER]
  const item = (id: string): MobileNativeChatPendingMessage => ({
    id,
    text: '3. Move Stop into the message box, as Claude does?',
    expectedOccurrence: 0,
    baselineTailMessageId: FIRST.id,
    baselineResolved: true,
    sentAt: at('18:31:32.087')
  })

  it('returns the same list when there is nothing in it', () => {
    const none: MobileNativeChatPendingMessage[] = []
    expect(placeSentElsewhereWhereTaken(none, rows, true)).toBe(none)
  })

  it('leaves a lone phone send where it was sent, the same list back', () => {
    const own = [item('pending-7')]
    expect(placeSentElsewhereWhereTaken(own, rows, true)).toBe(own)
  })

  it('moves a remembered desk copy and queue-box reading beside a phone send it leaves alone', () => {
    const placed = placeSentElsewhereWhereTaken(
      [item('desk-status:0954729d:1'), item('pending-7'), item(`absorbed-3. Move Stop@${FIRST.id}`), item('queued-0')],
      rows,
      true
    )
    expect(placed.map((entry) => entry.drawAfterId)).toEqual([BASH_RESULT.id, undefined, BASH_RESULT.id, BASH_RESULT.id])
  })

  it('names the copies of messages sent elsewhere by their ids', () => {
    expect(['desk-x', 'absorbed-x', 'queued-x', 'pending-x', ''].map(isSentElsewhere)).toEqual([true, true, true, false, false])
  })
})
