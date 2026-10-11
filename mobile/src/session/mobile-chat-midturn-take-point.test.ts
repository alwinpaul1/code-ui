// Reported from the phone on 2026-10-11 with two screenshots of the same
// moment, Claude Code 2.1.296. The Claude app drew, in order: the user's
// "[Image #94] Can't send messages due to this…", the tool row "Ran Pull the
// phone's log lines about the refused send", the user's "3. Move Stop into the
// message box…", then the status line. Code UI drew both messages back to back
// with the tool row under them.
//
// The session's own records (0954729d…, 1-based lines):
//   16176 user 01d0b4ff, "[Image #94] Can't send messages…", 18:31:15.739
//   16179 user 5a952af2 (isMeta), the photo's `[Image: source: …]`, 18:31:15.740
//   16189 queue-operation enqueue of "3. Move Stop…", 18:31:32.355
//   16190 assistant thinking 02162f50 (redacted, empty), 18:31:41.423
//   16191 assistant tool_use 6eb82b9b, Bash "Pull the phone's log lines about
//         the refused send", 18:31:42.642
//   16193 user tool_result 9bc170c9, 18:31:49.230
//   16195 queue-operation remove, 18:31:49.301
//   16196 attachment `queued_command` 0bb13daf, "3. Move Stop…", STAMPED
//         18:31:32.087 (the send) but WRITTEN here, after the result
//   16200 assistant text ed14dac4, "Your answers to 3 and 4 came through…",
//         18:32:00.120
//   16201 assistant tool_use aadaccc4 (Agent), 18:32:13.155; 16203 its result
//         1f4f053e, 18:32:16.997
// Orca drops the queued_command, so the phone drew the message from the tab
// status's copy (its log: `[desk-prompt] drawn: "3. Move Stop into the message
// bo…" (watched arriving) placed from 2026-10-11T18:31:32.206Z, its status
// stamp`). Placed by that stamp, its row was the user's first message: the
// Bash call was stamped ten seconds AFTER the send, so it drew below.
//
// Claude took the message between tool calls, after the result of the call
// that was running, and the transcript puts it there. The rows below keep the
// records' uuids and times of day; the date is the harness's (2026-09-29),
// whose clock drives the chat. The empty thinking records are left out: Orca
// draws nothing for them.
import { describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  at,
  call,
  drawn,
  midturnChat,
  oneLine,
  paneStatus,
  result,
  statusReader,
  text,
  user
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

const FIRST = "[Image #94] Can't send messages due to this see how claude does manage these"
const SECOND =
  '3. Move Stop into the message box, as Claude does?\n4. Tap a queued message to edit it?\n\nSee how claude does it from decompiled code'
const EARLIER_PROMPT = 'the prompt before'

const REPLY_BEFORE = text('0fc34552-57d9-4476-a71c-2fa84e100dd0', '18:29:08.220')
const FIRST_ROW = user('01d0b4ff-b079-442e-8ccb-9df647c67f72', ` ${FIRST}`, '18:31:15.739')
const PHOTO_ROW = user(
  '5a952af2-ccf8-4382-9bae-da597b6ccca7',
  '[Image: source: /var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1791743434902-78d22169-f9b3-48d2-88ed-c87086c69ca5.png]',
  '18:31:15.740'
)
const BASH = call('6eb82b9b-c4e5-4dc3-a701-460f111e2450', '18:31:42.642')
const BASH_RESULT = result('9bc170c9-de09-424b-a9cf-425daa3e6ea7', '18:31:49.230')
const ANSWER = text('ed14dac4-e417-48eb-99b8-83bd9377f5d5', '18:32:00.120')
const AGENT = call('aadaccc4-6721-47f8-b174-f2a72b2cdd09', '18:32:13.155')
const AGENT_RESULT = result('1f4f053e-d080-416c-b2d6-4cac14a2ded6', '18:32:16.997')

const TURN_START = '18:31:15.800'
const BEFORE_TURN = [{ state: 'done', prompt: EARLIER_PROMPT, startedAt: at('18:29:09.100') }]
const idleBefore = () => paneStatus('done', EARLIER_PROMPT, '18:29:09.100', '18:29:09.100')
const workingOn = (prompt: string, stamped: string) => paneStatus('working', prompt, stamped, TURN_START, BEFORE_TURN)

describe('a message sent mid-turn is drawn where Claude took it', () => {
  const { unmount, showAt } = midturnChat(frames, () => 'claude')

  it('draws a message sent before the agent wrote any row of its turn right under the prompt that opened it', async () => {
    const reader = statusReader()
    await upToTheSend(showAt, reader)
    const rows = drawnOrder()
    const second = rows.indexOf(SECOND_BUBBLE)
    expect(rows.filter((row) => row === SECOND_BUBBLE)).toHaveLength(1)
    expect(second).toBe(rows.length - 1)
    expect(rows[second - 1]).toContain("Can't send messages")
    reader.unmount()
    unmount()
  })

  it('keeps a mid-turn message at the live end, below the call that started after it was sent, while Claude has not taken it', async () => {
    const reader = statusReader()
    const prompts = await upToTheSend(showAt, reader)
    await showAt('18:31:43.000', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW, BASH], prompts)
    const rows = drawnOrder()
    expect(rows.filter((row) => row === SECOND_BUBBLE)).toHaveLength(1)
    expect(rows.at(-1)).toBe(SECOND_BUBBLE)
    reader.unmount()
    unmount()
  })

  it('draws the 2026-10-11 message after the tool row Claude ran before taking it, as the Claude app does', async () => {
    const reader = statusReader()
    const prompts = await upToTheSend(showAt, reader)
    await showAt('18:31:43.000', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW, BASH], prompts)
    await showAt('18:31:49.500', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW, BASH, BASH_RESULT], prompts)
    const whole: NativeChatMessage[] = [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW, BASH, BASH_RESULT, ANSWER, AGENT, AGENT_RESULT]
    await showAt('18:32:17.100', whole, prompts)
    const rows = drawnOrder()
    const first = rows.findIndex((row) => row.startsWith('user:') && row.includes("Can't send messages"))
    const second = rows.indexOf(SECOND_BUBBLE)
    const bash = rows.indexOf(BASH.id)
    expect(rows.filter((row) => row === SECOND_BUBBLE)).toHaveLength(1)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(bash)
    expect(bash).toBeLessThan(second)
    expect(second).toBeLessThan(rows.indexOf(ANSWER.id))
    reader.unmount()
    unmount()
  })
})

const SECOND_BUBBLE = `user:${oneLine(SECOND)}`

/** The drawn rows of the last frame as one line each: a user bubble by its
 *  words, any other row by its id. */
function drawnOrder(): string[] {
  return drawn(frames.at(-1)!).map((row) => (row.role === 'user' ? `user:${row.text}` : row.id))
}

type ShowAt = ReturnType<typeof midturnChat>['showAt']

/** The report's turn up to the second send, watched from the phone. */
async function upToTheSend(showAt: ShowAt, reader: ReturnType<typeof statusReader>) {
  vi.setSystemTime(at('18:31:00.000'))
  let prompts = reader.read(idleBefore())
  await showAt('18:31:00.100', [REPLY_BEFORE], prompts, false)
  vi.setSystemTime(at('18:31:16.100'))
  prompts = reader.read(workingOn(FIRST, '18:31:15.839'))
  await showAt('18:31:16.200', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW], prompts)
  vi.setSystemTime(at('18:31:32.500'))
  prompts = reader.read(workingOn(SECOND, '18:31:32.206'))
  await showAt('18:31:32.600', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW], prompts)
  return prompts
}

// Session 0954729d, lines 9360–9439 (Claude Code 2.1.296, 2026-10-10): a
// message enqueued at 16:25:17.094 (its `queued_command` stamped 16:25:16.920)
// while the agent was between a run of three WebSearch calls and a run of two
// WebFetch calls. Claude took it after BOTH WebFetch results (lines 9400 and
// 9403; the remove is 16:25:27.306), then called Bash. The statuses are
// modeled (none was captured): stamped just after each enqueue.
describe('a message sent mid-turn during a run of parallel calls', () => {
  const { unmount, showAt } = midturnChat(frames, () => 'claude')
  const MESSAGE = 'What abt showing images previews is it in orca ade latest update'
  const OPENING = 'Search on web multiple places and confirm'
  const opening = user('f0b243f4-3ea7-49f6-81b6-ce5803fa167f', OPENING, '16:24:52.828')
  const searches = [
    call('1484d4fd-b877-4a67-92ee-4ebdffad57c6', '16:25:03.831'),
    call('8e388b39-c50f-44c8-ab52-3292e48e839c', '16:25:04.591'),
    call('a1bc6d1f-ce19-4ec9-b017-870ea8ed7592', '16:25:05.230'),
    result('25970519-7b23-4d48-9371-36dc3df29eb1', '16:25:12.529'),
    result('b4360984-4c72-4613-a79e-7c3114ab19b8', '16:25:12.592'),
    result('666c59cb-cb43-4e2d-a6cb-cf10a0a81269', '16:25:12.656')
  ]
  const fetches = [call('191a736c-92d7-4ce6-bfef-34db7a8b4545', '16:25:26.100'), call('265f7dd2-cd3b-4e7b-81b4-8adfe24ad7f7', '16:25:26.175')]
  const fetchResults = [
    result('472ea04b-e20e-4b08-9e6f-c04329451431', '16:25:27.228'),
    result('65b8dd47-61ea-4489-b109-748a5030a9a2', '16:25:27.290')
  ]
  const bash = call('85c1d3b1-7770-4f29-b753-504b8142fafc', '16:25:43.403')
  const later = [bash, result('71513a50-f4fc-4f44-89cb-ee4210d6e221', '16:25:46.316')]
  const since = '16:24:52.900'
  const history = [{ state: 'done', prompt: 'the turn before', startedAt: at('16:23:09.000') }]
  const bubble = `user:${MESSAGE}`

  it('draws it after the last result of the calls that ran while it waited, and above the call after them', async () => {
    const reader = statusReader()
    vi.setSystemTime(at('16:25:13.000'))
    let prompts = reader.read(paneStatus('working', OPENING, '16:25:12.700', since, history))
    await showAt('16:25:13.100', [opening, ...searches], prompts)
    vi.setSystemTime(at('16:25:17.300'))
    prompts = reader.read(paneStatus('working', MESSAGE, '16:25:17.200', since, history))
    await showAt('16:25:17.400', [opening, ...searches], prompts)
    // One of the two results is in: the step has not finished, so Claude has
    // not taken it, and it stays at the live end.
    await showAt('16:25:27.250', [opening, ...searches, ...fetches, fetchResults[0]!], prompts)
    expect(drawnOrder().at(-1)).toBe(bubble)
    await showAt('16:25:47.000', [opening, ...searches, ...fetches, ...fetchResults, ...later], prompts)
    const rows = drawnOrder()
    expect(rows.filter((row) => row === bubble)).toHaveLength(1)
    const message = rows.indexOf(bubble)
    // The searches and the fetches fold above it; the Bash call that came
    // after the take starts a row of its own below it.
    expect(rows.indexOf(searches[0]!.id)).toBeGreaterThan(-1)
    expect(rows.indexOf(searches[0]!.id)).toBeLessThan(message)
    expect(rows[message + 1]).toBe(bash.id)
    reader.unmount()
    unmount()
  })
})

// Session 0954729d, lines 13995–14054 (Claude Code 2.1.296, 2026-10-11): two
// messages enqueued 33 s apart (14:57:21.304, 14:57:54.504) while one long
// Bash call ran ("Commit, rebuild with the new icon, and install", 14:57:18).
// Both were taken after its result (15:04:27.195; both removes 15:04:27.236),
// in the order sent. Statuses modeled, as above.
describe('two messages sent quickly mid-turn', () => {
  const { unmount, showAt } = midturnChat(frames, () => 'claude')
  const OPENING = 'I mean exactly the app drawer'
  const FIRST_MESSAGE =
    'What stayed red: the splash screen and the small logo inside the app. Black would vanish on the dark splash and on the dark screens. If you want those changed too, I can make them black and white in light mode and white on dark in dark mode.\n\nDo thia'
  const SECOND_MESSAGE = "also what about showing the image previews I didn't see any image previous like in claude"
  const opening = user('99931c7b-29f0-47e1-883b-16025ef4c2ad', OPENING, '14:56:45.162')
  const before = [
    call('2d5faccd-9b9e-4370-a2df-3a86a3fd5f2b', '14:56:49.124'),
    result('f2800329-bee4-4df3-9cf8-425088480d6c', '14:56:51.764'),
    call('f981945c-ccb0-4bb9-b8e8-13dacccf2ebe', '14:56:57.717'),
    result('d9e500aa-8766-40ef-b994-d2d916dadb55', '14:56:59.701'),
    call('dc2ac3f2-9794-4498-bc4a-17f000394bce', '14:57:08.394'),
    result('e0f12e77-7dc2-41c9-8c28-5d678c75623a', '14:57:12.806'),
    call('28a4a029-c10f-464a-93a7-962292324fe3', '14:57:18.431')
  ]
  const took = result('ea8488ec-81f8-4f4f-aafe-cb629df37d0e', '15:04:27.195')
  const next = call('f3549e97-7d5b-4944-9525-aad85e561bf7', '15:04:36.596')
  const after = [next, result('506a9f39-8dc7-4f47-bb93-40511ea91c94', '15:04:37.124')]
  const since = '14:56:45.300'
  const history = [{ state: 'done', prompt: 'the turn before', startedAt: at('14:56:00.000') }]

  it('draws both at the live end while the call runs, then both after its result, in the order sent', async () => {
    const reader = statusReader()
    vi.setSystemTime(at('14:57:19.000'))
    let prompts = reader.read(paneStatus('working', OPENING, '14:57:18.500', since, history))
    await showAt('14:57:19.100', [opening, ...before], prompts)
    vi.setSystemTime(at('14:57:21.500'))
    prompts = reader.read(paneStatus('working', FIRST_MESSAGE, '14:57:21.400', since, history))
    await showAt('14:57:21.600', [opening, ...before], prompts)
    vi.setSystemTime(at('14:57:54.700'))
    prompts = reader.read(paneStatus('working', SECOND_MESSAGE, '14:57:54.600', since, history))
    await showAt('14:57:54.800', [opening, ...before], prompts)
    // The tab status carries 200 characters of a prompt (Orca's cap), so the
    // first is drawn as its first 200.
    const isFirst = (row: string) => row.startsWith('user:What stayed red: the splash screen')
    const second = `user:${oneLine(SECOND_MESSAGE)}`
    let rows = drawnOrder()
    expect(isFirst(rows.at(-2)!)).toBe(true)
    expect(rows.at(-1)).toBe(second)
    await showAt('15:04:38.000', [opening, ...before, took, ...after], prompts)
    rows = drawnOrder()
    expect(rows.filter(isFirst)).toHaveLength(1)
    expect(rows.filter((row) => row === second)).toHaveLength(1)
    const firstAt = rows.findIndex(isFirst)
    expect(rows[firstAt + 1]).toBe(second)
    expect(rows[firstAt + 2]).toBe(next.id)
    expect(rows.indexOf(before[0]!.id)).toBeGreaterThan(-1)
    expect(rows.indexOf(before[0]!.id)).toBeLessThan(firstAt)
    reader.unmount()
    unmount()
  })
})

// The report's first message: sent while the agent was idle (the turn before
// ended at 18:29:09), so Claude wrote it as its turn's own user row.
describe('a message sent while the agent is idle', () => {
  const { unmount, showAt } = midturnChat(frames, () => 'claude')

  it('is drawn once, at its own row, above the calls of the turn it opened', async () => {
    const reader = statusReader()
    vi.setSystemTime(at('18:31:00.000'))
    let prompts = reader.read(idleBefore())
    await showAt('18:31:00.100', [REPLY_BEFORE], prompts, false)
    // The status reaches the phone before the row does.
    vi.setSystemTime(at('18:31:15.900'))
    prompts = reader.read(workingOn(FIRST, '18:31:15.839'))
    await showAt('18:31:16.000', [REPLY_BEFORE], prompts)
    let rows = drawnOrder()
    expect(rows.filter((row) => row.includes("Can't send messages"))).toHaveLength(1)
    expect(rows.at(-1)).toContain("Can't send messages")
    await showAt('18:31:50.000', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW, BASH, BASH_RESULT], prompts)
    rows = drawnOrder()
    const bubbles = rows.flatMap((row, index) => (row.includes("Can't send messages") ? [index] : []))
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]!).toBeLessThan(rows.indexOf(BASH.id))
    reader.unmount()
    unmount()
  })
})

// Degenerate: a turn with no tool rows. The message waits for a result that
// never comes; at the turn's end Claude writes it as a user row of its own.
// The report's rows with the calls left out.
describe('a message sent mid-turn in a turn with no tool rows', () => {
  const { unmount, showAt } = midturnChat(frames, () => 'claude')

  it('sits at the live end under the words while the agent works, and keeps its place by the send once it stops', async () => {
    const reader = statusReader()
    const prompts = await upToTheSend(showAt, reader)
    await showAt('18:32:00.500', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW, ANSWER], prompts)
    let rows = drawnOrder()
    expect(rows.at(-1)).toBe(SECOND_BUBBLE)
    expect(rows.indexOf(ANSWER.id)).toBeGreaterThan(-1)
    // The turn ends with no result and no row of its words: nothing says it
    // was taken mid-turn, and a live end would follow every later reply.
    await showAt('18:32:01.000', [REPLY_BEFORE, FIRST_ROW, PHOTO_ROW, ANSWER], prompts, false)
    rows = drawnOrder()
    expect(rows.filter((row) => row === SECOND_BUBBLE)).toHaveLength(1)
    expect(rows.indexOf(SECOND_BUBBLE)).toBeLessThan(rows.indexOf(ANSWER.id))
    reader.unmount()
    unmount()
  })
})
