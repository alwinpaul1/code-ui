// Reported from the phone on 2026-09-27, Claude Code 2.1.283, session
// 790eafa8, a tab with no prompt hook. A background subagent sent the lead a
// message mid-turn. The session's own records (1-based transcript lines):
//   17706 queue-operation enqueue            17:38:59.103Z
//   17713 queue-operation remove, reason `absorbed_mid_turn`, 17:39:02.111Z
//   17714 attachment, `attachment.type: "queued_command"`, `origin: {kind:
//         "peer", from: "ae2d5e1c5fd6e774f", name: "general-purpose", …}`,
//         `isMeta: true`, parentUuid the PostToolUse hook record of the Bash
//         call 9241eb9b
// The lead then messaged the subagent back (a9807473) and wrote its final
// text (7d464ce8, 17:39:16). Orca's reader drops the attachment, so the phone
// knows of the message only from the row the desktop TUI paints for it:
//   › Message from @general-purpose (ctrl+o to expand)
// between "Ran 1 shell command" and the lead's final text. The phone drew its
// "Message from general-purpose" row at the tail, after that final text.
//
// The chat anchors a screen row at the last row it holds when a screen read
// first shows it. That read was the chat's first after it came back to the
// session: the row had been painted while it was not looking, and the lead
// had answered since.
//
// The rows are the transcript's own records (uuid, role, time, text where the
// reduced records kept it). The screen lines are transcribed from the
// phone's screenshot of the desktop terminal (peer-row-terminal.png); a tmux
// capture of this row's form (Claude Code 2.1.278, 46 columns) is pinned in
// mobile-terminal-peer-notices.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import { peerNoticesFromScreen } from './mobile-terminal-peer-notices'
import { landingHarness } from './mobile-chat-phone-photo-landing.test-support'
import { resetScreenPeerNoticesForTests, useScreenPeerNotices } from './use-screen-peer-notices'
import type { RpcClient } from '../transport/rpc-client'
import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { useMobileNativeChatSession } from './use-mobile-native-chat-session'
import { transcriptSettled } from './mobile-native-chat-whole-session'

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

const at = (clock: string) => Date.parse(`2026-09-27T${clock}Z`)
const text = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})
const tool = (callId: string, resultId: string, name: string, called: string, returned: string): NativeChatMessage[] => [
  { id: callId, role: 'assistant', blocks: [{ type: 'tool-call', name, input: {} }], timestamp: at(called), source: 'transcript' },
  { id: resultId, role: 'tool', blocks: [{ type: 'tool-result', output: '' }], timestamp: at(returned), source: 'transcript' }
]

const COMMITTING = '1c179b5c-4632-4f9c-b33c-6db3a7ba0a2b'
const FINAL = '7d464ce8-8958-4250-b3f9-110f3016079e'
const BEFORE_COMMIT = [
  ...tool('4cacf5a5-adbd-429e-8cfd-6894e6f370d6', '93a40c38-ef7d-4c75-ac5e-c72b047254fb', 'Bash', '17:38:51.984', '17:38:55.102'),
  text(COMMITTING, 'The Troubleshooting fix passes typecheck, lint and all 460 diagnostics tests. Committing it.', '17:38:57.069')
]
// Claude Code took the message after the commit's Bash call (17:39:02).
const TAKEN = [
  ...BEFORE_COMMIT,
  ...tool('9241eb9b-dede-4384-be27-23f95c0597b6', 'f34f9d8f-8f86-4243-a566-59e883d95fc7', 'Bash', '17:39:00.975', '17:39:01.837')
]
const ANSWERED = [
  ...TAKEN,
  ...tool('a9807473-ca20-4351-8016-0146ea8195ab', 'fee69d76-47fa-4a10-b754-0a033ef038ca', 'SendMessage', '17:39:07.407', '17:39:08.177'),
  text(
    FINAL,
    "I've removed the Troubleshooting line you pointed at, and the change is committed on a separate branch (`fix/troubleshoot-relay-row`). It isn't merged yet.",
    '17:39:16.654'
  )
]
/** The desktop terminal around the row, as the phone's terminal view showed it. */
const SCREEN = [
  '⏺ The Troubleshooting fix passes typecheck, lint and all 460 diagnostics tests. Committing it.',
  '',
  '  Ran 1 shell command',
  '',
  '› Message from @general-purpose (ctrl+o to expand)',
  '  ⎿  Message queued for delivery to ae2d5e1c5fd6e774f at its next tool round.',
  '  ⎿  Allowed by auto mode classifier',
  '',
  "⏺ I've removed the Troubleshooting line you pointed at, and the change is committed on a separate",
  "  branch (fix/troubleshoot-relay-row). It isn't merged yet."
]
const ROWS = peerNoticesFromScreen(SCREEN)

describe('a subagent’s message taken mid-turn, on a tab with no prompt hook', () => {
  const { show, unmount } = landingHarness(frames)
  afterEach(() => vi.restoreAllMocks())
  /** The harness's clock is a day earlier; move to this day's time first. */
  async function showAt(
    clock: string,
    messages: NativeChatMessage[],
    peerRows: ReturnType<typeof peerNoticesFromScreen> | null,
    loading = false
  ) {
    const delta = at(clock) - Date.now()
    if (delta > 0) {
      await act(async () => {
        vi.advanceTimersByTime(delta)
      })
    }
    await show('00:00:00.000', { messages, working: true, promptHook: false, peerRows, loading })
  }
  function placement(): { row: number; committing: number; final: number; rows: number } {
    const folded = (frames.at(-1)!.folded as NativeChatMessage[]) ?? []
    const index = (id: string) => folded.findIndex((message) => message.id === id)
    const rows = folded.filter((message) => agentMessageOf(message)?.sender === 'general-purpose')
    return {
      row: folded.findIndex((message) => agentMessageOf(message)?.sender === 'general-purpose'),
      committing: index(COMMITTING),
      final: index(FINAL),
      rows: rows.length
    }
  }

  it('reads the TUI’s row as a subagent’s, with no words', () => {
    expect(ROWS).toEqual([{ sender: 'general-purpose' }])
  })

  it('keeps a subagent’s message the chat did not watch arrive above the lead’s reply to it', async () => {
    vi.setSystemTime(at('17:38:58.000'))
    // The chat was open, reading the screen, before the message came…
    await showAt('17:38:58.000', BEFORE_COMMIT, null)
    await showAt('17:38:58.500', BEFORE_COMMIT, [])
    // …and was left.
    unmount()
    // Back after the lead answered: the screen is not read yet, then is.
    await showAt('17:40:00.000', ANSWERED, null)
    await showAt('17:40:01.000', ANSWERED, ROWS)
    await showAt('17:40:02.000', ANSWERED, ROWS)
    const where = placement()
    expect(where.rows).toBe(1)
    expect(where.row).toBeGreaterThan(where.committing)
    expect(where.row).toBeLessThan(where.final)
  })

  // The overlay hands the reader whether its transcript has settled: the
  // screen read can come before the transcript does (re-review of 1045e43b).
  it('keeps it above the lead’s reply when the screen was read before the transcript loaded', async () => {
    vi.setSystemTime(at('17:38:58.000'))
    await showAt('17:38:58.000', BEFORE_COMMIT, null)
    await showAt('17:38:58.500', BEFORE_COMMIT, [])
    unmount()
    await showAt('17:40:00.000', [], null, true)
    await showAt('17:40:01.000', [], ROWS, true)
    await showAt('17:40:02.000', ANSWERED, ROWS)
    const where = placement()
    expect(where.rows).toBe(1)
    expect(where.row).toBeGreaterThan(where.committing)
    expect(where.row).toBeLessThan(where.final)
  })

  it('keeps it above the lead’s reply when the link was down while it came', async () => {
    vi.setSystemTime(at('17:38:58.000'))
    await showAt('17:38:58.000', BEFORE_COMMIT, null)
    await showAt('17:38:58.500', BEFORE_COMMIT, [])
    // The link drops; the chat stays mounted and does not read the screen.
    await showAt('17:38:59.000', BEFORE_COMMIT, null)
    await showAt('17:40:00.000', ANSWERED, null)
    await showAt('17:40:01.000', ANSWERED, ROWS)
    const where = placement()
    expect(where.rows).toBe(1)
    expect(where.row).toBeGreaterThan(where.committing)
    expect(where.row).toBeLessThan(where.final)
  })

  it('is not drawn, and says so once, when the chat never read this screen before', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.setSystemTime(at('17:40:00.000'))
    await showAt('17:40:00.000', ANSWERED, null)
    await showAt('17:40:01.000', ANSWERED, ROWS)
    await showAt('17:40:02.000', ANSWERED, ROWS)
    expect(placement().rows).toBe(0)
    expect(info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[peer-row]'))).toEqual([
      '[peer-row] not drawn: the row from @general-purpose was on the screen when the chat first read it, and the chat holds no earlier reading of this session to place it by'
    ])
  })

  // What the chat did before, and must go on doing: a row it watched arrive
  // is drawn after the step it came in.
  it('stays after the step it came in when the chat was reading the screen as it arrived', async () => {
    vi.setSystemTime(at('17:38:58.000'))
    await showAt('17:38:58.000', BEFORE_COMMIT, null)
    await showAt('17:38:58.500', BEFORE_COMMIT, [])
    await showAt('17:39:02.500', TAKEN, ROWS)
    await showAt('17:39:17.000', ANSWERED, ROWS)
    await showAt('17:39:18.000', ANSWERED, ROWS)
    const where = placement()
    expect(where.rows).toBe(1)
    expect(where.row).toBeGreaterThan(where.committing)
    expect(where.row).toBeLessThan(where.final)
  })

  it('keeps a row the chat watched arrive where it was drawn when the chat comes back', async () => {
    vi.setSystemTime(at('17:38:58.000'))
    await showAt('17:38:58.000', BEFORE_COMMIT, null)
    await showAt('17:38:58.500', BEFORE_COMMIT, [])
    await showAt('17:39:02.500', TAKEN, ROWS)
    unmount()
    await showAt('17:40:00.000', ANSWERED, null)
    await showAt('17:40:01.000', ANSWERED, ROWS)
    const where = placement()
    expect(where.rows).toBe(1)
    expect(where.row).toBeLessThan(where.final)
  })

  // Degenerate: the chat held one row when it last read the screen.
  it('sits right after the only row the chat held when it last read the screen', async () => {
    vi.setSystemTime(at('17:38:58.000'))
    const only = [BEFORE_COMMIT.at(-1)!]
    await showAt('17:38:58.000', only, null)
    await showAt('17:38:58.500', only, [])
    unmount()
    const later = [only[0]!, ...ANSWERED.slice(BEFORE_COMMIT.length)]
    await showAt('17:40:00.000', later, null)
    await showAt('17:40:01.000', later, ROWS)
    const folded = (frames.at(-1)!.folded as NativeChatMessage[]) ?? []
    const index = folded.findIndex((message) => agentMessageOf(message)?.sender === 'general-purpose')
    expect(folded[index - 1]?.id).toBe(COMMITTING)
  })

  // Degenerate: the chat held no row when it last read the screen, so no
  // reading places the row.
  it('is not drawn when the chat held no row when it last read the screen', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.setSystemTime(at('17:38:58.000'))
    await showAt('17:38:58.000', [], null)
    await showAt('17:38:58.500', [], [])
    unmount()
    await showAt('17:40:00.000', ANSWERED, null)
    await showAt('17:40:01.000', ANSWERED, ROWS)
    expect(placement().rows).toBe(0)
  })
})

// Independent review of ce17bce5 (2026-09-27), three findings, each reproduced
// by a probe that failed on it. The hook alone, as the overlay mounts it: the
// screen's rows (null until the chat's first read of a watch), the folded
// chat, the stream scope.
describe('rows found on the first screen read, after the review of the first fix', () => {
  const row = (id: string, role: NativeChatMessage['role'], body: string, clock: string): NativeChatMessage => ({
    id,
    role,
    blocks: [{ type: 'text', text: body }],
    timestamp: at(clock),
    source: 'transcript'
  })
  const U1 = row('u1', 'user', 'start the agents', '17:00:00.000')
  const A1 = row('a1', 'assistant', 'Launched two agents.', '17:00:10.000')
  const A1B = row('a1b', 'assistant', 'Waiting on the agents.', '17:00:40.000')
  const U2 = row('u2', 'user', 'now fix the header', '17:05:00.000')
  const A2 = row('a2', 'assistant', 'Header fixed.', '17:05:30.000')
  const U3 = row('u3', 'user', 'and the footer', '17:10:00.000')
  const A3 = row('a3', 'assistant', 'Footer fixed.', '17:10:30.000')
  const U4 = row('u4', 'user', 'run the suite', '17:15:00.000')
  const A4 = row('a4', 'assistant', 'Running the suite now.', '17:15:30.000')
  const R = [{ sender: 'general-purpose' }]

  /** `settled`: the transcript shown is the host's, read and settled, not the
   *  copy the last visit cached or an empty list while it loads. */
  type Props = { rows: ReturnType<typeof peerNoticesFromScreen> | null; folded: NativeChatMessage[]; scope: string; settled?: boolean }
  function chat() {
    let out: NativeChatMessage[] = []
    let renderer: ReactTestRenderer | null = null
    function Chat(props: Props) {
      out = useScreenPeerNotices(props.rows, props.folded, props.scope, true, undefined, props.settled ?? true)
      return null
    }
    return {
      show(props: Props) {
        act(() => {
          if (renderer) {
            renderer.update(createElement(Chat, props))
          } else {
            renderer = create(createElement(Chat, props))
          }
        })
      },
      unmount() {
        act(() => renderer?.unmount())
        renderer = null
      },
      ids: () => out.map((message) => (agentMessageOf(message) ? `row:${agentMessageOf(message)!.sender}` : message.id))
    }
  }
  const peerLines = (info: { mock: { calls: unknown[][] } }) =>
    info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[peer-row]'))

  beforeEach(() => resetScreenPeerNoticesForTests())
  afterEach(() => vi.restoreAllMocks())

  // The chat read the screen after turn 1 and was left; three turns were
  // worked at the desk and a row came in the last. It is on the screen now,
  // so it is recent; anchored at the chat's last reading it drew three turns
  // early.
  it('does not draw a found row turns before where it came when prompts landed since the chat last read the screen, and says why', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const view = chat()
    view.show({ rows: null, folded: [U1, A1], scope: 'A' })
    view.show({ rows: [], folded: [U1, A1], scope: 'A' })
    view.unmount()
    const now = [U1, A1, U2, A2, U3, A3, U4, A4]
    view.show({ rows: null, folded: now, scope: 'A' })
    view.show({ rows: R, folded: now, scope: 'A' })
    expect(view.ids()).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4'])
    expect(peerLines(info)).toEqual([
      '[peer-row] not drawn: the row from @general-purpose was on the screen when the chat first read it, and a prompt started a turn since the chat last read the screen (after a1), so it may have come in any of them'
    ])
  })

  it('does not draw a found row above the whole page when the row the chat last read is not loaded', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const view = chat()
    view.show({ rows: null, folded: [U1, A1], scope: 'A' })
    view.show({ rows: [], folded: [U1, A1], scope: 'A' })
    view.unmount()
    const page = [U3, A3, U4, A4]
    view.show({ rows: null, folded: page, scope: 'A' })
    view.show({ rows: R, folded: page, scope: 'A' })
    expect(view.ids()).toEqual(['u3', 'a3', 'u4', 'a4'])
  })

  // The overlay stays mounted while the person goes through other tabs and
  // worktrees with the chat hidden; each is its own stream scope, read or not.
  it('keeps a row the chat watched arrive after it rendered under many scopes it never read', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const view = chat()
    view.show({ rows: null, folded: [U1, A1], scope: 'A' })
    view.show({ rows: [], folded: [U1, A1], scope: 'A' })
    view.show({ rows: R, folded: [U1, A1, U2, A2], scope: 'A' })
    for (let index = 0; index < 100; index += 1) {
      view.show({ rows: null, folded: [], scope: `other-${index}` })
    }
    view.show({ rows: null, folded: [U1, A1, U2, A2, U3, A3], scope: 'A' })
    view.show({ rows: R, folded: [U1, A1, U2, A2, U3, A3], scope: 'A' })
    expect(view.ids()).toEqual(['u1', 'a1', 'u2', 'a2', 'row:general-purpose', 'u3', 'a3'])
  })

  // Degenerate: past the cap of scopes it read, the oldest memory goes. A row
  // it drew is then found again with nothing to place it by, and not drawn;
  // the log must say so, not only that it was once drawn.
  it('says a row it drew is no longer drawn when it is found again with nothing to place it by', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const view = chat()
    view.show({ rows: null, folded: [U1, A1], scope: 'A' })
    view.show({ rows: [], folded: [U1, A1], scope: 'A' })
    view.show({ rows: null, folded: [U1, A1], scope: 'A' })
    view.show({ rows: R, folded: [U1, A1, A1B], scope: 'A' })
    expect(view.ids()).toEqual(['u1', 'a1', 'row:general-purpose', 'a1b'])
    for (let index = 0; index < 200; index += 1) {
      view.show({ rows: null, folded: [U1], scope: `other-${index}` })
      view.show({ rows: [], folded: [U1], scope: `other-${index}` })
    }
    view.show({ rows: null, folded: [U1, A1, A1B], scope: 'A' })
    view.show({ rows: R, folded: [U1, A1, A1B], scope: 'A' })
    expect(view.ids()).toEqual(['u1', 'a1', 'a1b'])
    expect(peerLines(info)).toEqual([
      '[peer-row] drawn: the row from @general-purpose was on the screen when the chat first read it, not watched arriving; placed after a1, the last row the chat held when it last read the screen',
      '[peer-row] not drawn: the row from @general-purpose was on the screen when the chat first read it, and the chat holds no earlier reading of this session to place it by'
    ])
  })
  // Re-review of 1045e43b: the placement was decided once, on the first read,
  // against whatever the chat showed then. Until the host's transcript
  // settles it shows the copy the last visit cached, or nothing, and the
  // screen read can come first (a tab switch back, a reconnect).
  it('does not draw a found row turns early when the first read came while the chat showed the cached transcript', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const view = chat()
    view.show({ rows: null, folded: [U1, A1], scope: 'A' })
    view.show({ rows: [], folded: [U1, A1], scope: 'A' })
    view.unmount()
    view.show({ rows: null, folded: [U1, A1], scope: 'A', settled: false })
    view.show({ rows: R, folded: [U1, A1], scope: 'A', settled: false })
    view.show({ rows: R, folded: [U1, A1, U2, A2, U3, A3, U4, A4], scope: 'A' })
    expect(view.ids()).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4'])
  })

  it('still draws the reported row above the answer when the first read came before any transcript was shown', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const view = chat()
    view.show({ rows: null, folded: BEFORE_COMMIT, scope: 'A' })
    view.show({ rows: [], folded: BEFORE_COMMIT, scope: 'A' })
    view.unmount()
    view.show({ rows: null, folded: [], scope: 'A', settled: false })
    view.show({ rows: ROWS, folded: [], scope: 'A', settled: false })
    view.show({ rows: ROWS, folded: ANSWERED, scope: 'A' })
    const ids = view.ids()
    expect(ids.filter((id) => id === 'row:general-purpose')).toHaveLength(1)
    expect(ids.indexOf('row:general-purpose')).toBeGreaterThan(ids.indexOf(COMMITTING))
    expect(ids.indexOf('row:general-purpose')).toBeLessThan(ids.indexOf(FINAL))
  })

  it('says so once for each of two rows from one sender found on the same read', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const view = chat()
    view.show({ rows: null, folded: [U1, A1], scope: 'A' })
    view.show({ rows: [], folded: [U1, A1], scope: 'A' })
    view.unmount()
    view.show({ rows: null, folded: [U1, A1, A1B], scope: 'A' })
    view.show({ rows: [...R, ...R], folded: [U1, A1, A1B], scope: 'A' })
    expect(view.ids().filter((id) => id === 'row:general-purpose')).toHaveLength(2)
    expect(peerLines(info)).toHaveLength(2)
  })
})

// Third review (of 7270b321), both reproduced with the real transcript hook:
// - The client outlives a reconnect and replays the transcript on the same
//   subscription, so the chat's read stays 'ready' through the drop, and the
//   first screen read after it came before the replay: a row found then was
//   placed against the transcript from before the drop, turns early.
// - While the transcript is a base kept over an empty re-subscribe, which can
//   last the whole visit, the first read never came, so rows the chat watched
//   arrive were never drawn.
describe('rows on the screen, read beside the real transcript hook', () => {
  const text = (id: string, role: NativeChatMessage['role'], body: string, timestamp: number): NativeChatMessage => ({
    id,
    role,
    timestamp,
    source: 'transcript',
    blocks: [{ type: 'text', text: body }]
  })
  const U1 = text('u1', 'user', 'start the agents', 1)
  const A1 = text('a1', 'assistant', 'Launched two agents.', 2)
  const U2 = text('u2', 'user', 'now fix the header', 3)
  const A2 = text('a2', 'assistant', 'Header fixed.', 4)
  const A3 = text('a3', 'assistant', 'Still on the header.', 5)
  const U4 = text('u4', 'user', 'run the suite', 7)
  const A4 = text('a4', 'assistant', 'Running the suite now.', 8)
  const R = [{ sender: 'general-purpose' }]

  type Props = { agent: string | null; rows: ReturnType<typeof peerNoticesFromScreen> | null; lastConnectedAt: number }
  /** The transcript hook and the row reader wired as the overlay wires them. */
  function wired() {
    let out: NativeChatMessage[] = []
    let renderer: ReactTestRenderer | null = null
    let emit: (frame: unknown) => void = () => undefined
    const client = {
      sendRequest: vi.fn(),
      subscribe: vi.fn((_method: string, _params: unknown, onData: (frame: unknown) => void) => {
        emit = onData
        return () => undefined
      })
    } as unknown as RpcClient
    function Chat(props: Props) {
      const session = useMobileNativeChatSession({
        client,
        sourceIdentity: 'host-a\0workspace-a',
        agent: props.agent,
        sessionId: 'session',
        transcriptPath: null,
        lastConnectedAt: props.lastConnectedAt
      })
      out = useScreenPeerNotices(props.rows, session.messages, 'scope-A', true, undefined, transcriptSettled(session))
      return null
    }
    return {
      async show(props: Props) {
        await act(async () => {
          if (renderer) {
            renderer.update(createElement(Chat, props))
          } else {
            renderer = create(createElement(Chat, props))
          }
        })
      },
      async emit(frame: unknown) {
        await act(async () => emit(frame))
      },
      unmount() {
        act(() => renderer?.unmount())
        renderer = null
      },
      ids: () => out.map((message) => (agentMessageOf(message) ? `row:${agentMessageOf(message)!.sender}` : message.id))
    }
  }

  beforeEach(() => {
    resetScreenPeerNoticesForTests()
    resetNativeChatTranscriptCacheForTests()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('does not draw a row found before a reconnect’s replay turns before where it came', async () => {
    const view = wired()
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 1 })
    await view.emit({ type: 'snapshot', messages: [U1, A1], hasMore: false })
    await view.show({ agent: 'claude', rows: [], lastConnectedAt: 1 })
    // The link drops while the person works at the desk; it comes back, and
    // the screen is read before the replay lands.
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 1 })
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 2 })
    await view.show({ agent: 'claude', rows: R, lastConnectedAt: 2 })
    await view.emit({ type: 'snapshot', messages: [U1, A1, U2, A2, U4, A4], hasMore: false })
    await view.show({ agent: 'claude', rows: R, lastConnectedAt: 2 })
    expect(view.ids()).toEqual(['u1', 'a1', 'u2', 'a2', 'u4', 'a4'])
  })

  it('still places the reported row above the answer when the replay lands after the screen read', async () => {
    const COMMIT = text('commit', 'assistant', 'Committing it.', 10)
    const FINAL = text('final', 'assistant', 'Committed on a branch.', 20)
    const view = wired()
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 1 })
    await view.emit({ type: 'snapshot', messages: [U1, COMMIT], hasMore: false })
    await view.show({ agent: 'claude', rows: [], lastConnectedAt: 1 })
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 1 })
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 2 })
    await view.show({ agent: 'claude', rows: R, lastConnectedAt: 2 })
    await view.emit({ type: 'snapshot', messages: [U1, COMMIT, FINAL], hasMore: false })
    await view.show({ agent: 'claude', rows: R, lastConnectedAt: 2 })
    expect(view.ids()).toEqual(['u1', 'commit', 'row:general-purpose', 'final'])
  })

  it('draws a row the chat watches arrive while the transcript is a base kept over an empty re-subscribe', async () => {
    const view = wired()
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 1 })
    await view.emit({ type: 'snapshot', messages: [U1, A1], hasMore: false })
    await view.show({ agent: 'claude', rows: [], lastConnectedAt: 1 })
    // Chat, file tab, chat: the lane subscribes again and the host sends an
    // empty base (a Windows host that failed to read the file).
    await view.show({ agent: null, rows: null, lastConnectedAt: 1 })
    await view.show({ agent: 'claude', rows: null, lastConnectedAt: 1 })
    await view.emit({ type: 'snapshot', messages: [], hasMore: false })
    await view.emit({ type: 'appended', messages: [U2, A2] })
    await view.show({ agent: 'claude', rows: [], lastConnectedAt: 1 })
    // Watching: a subagent's row arrives, and the lead writes on.
    await view.show({ agent: 'claude', rows: R, lastConnectedAt: 1 })
    await view.emit({ type: 'appended', messages: [A3] })
    await view.show({ agent: 'claude', rows: R, lastConnectedAt: 1 })
    expect(view.ids()).toEqual(['u1', 'a1', 'u2', 'a2', 'row:general-purpose', 'a3'])
  })
})

// Fourth review (of 756f2e5d): a row found before the transcript settled
// logged "drawn … placed after null" while it waited, and the line for where
// it was placed never came.
describe('the log line of a row found before the transcript settled', () => {
  const text = (id: string, role: NativeChatMessage['role'], body: string, timestamp: number): NativeChatMessage => ({
    id,
    role,
    timestamp,
    source: 'transcript',
    blocks: [{ type: 'text', text: body }]
  })
  const U1 = text('u1', 'user', 'start the agents', 1)
  const COMMIT = text('commit', 'assistant', 'Committing it.', 10)
  const FINAL = text('final', 'assistant', 'Committed on a branch.', 20)
  const R = [{ sender: 'general-purpose' }]
  type Props = { rows: ReturnType<typeof peerNoticesFromScreen> | null; folded: NativeChatMessage[]; settled: boolean }
  beforeEach(() => resetScreenPeerNoticesForTests())
  afterEach(() => vi.restoreAllMocks())

  it('says where it was placed once it is, and nothing about a place before that', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    let renderer: ReactTestRenderer | null = null
    function Chat(props: Props) {
      useScreenPeerNotices(props.rows, props.folded, 'scope-A', true, undefined, props.settled)
      return null
    }
    const show = (props: Props) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, props))
        } else {
          renderer = create(createElement(Chat, props))
        }
      })
    show({ rows: null, folded: [U1, COMMIT], settled: true })
    show({ rows: [], folded: [U1, COMMIT], settled: true })
    show({ rows: null, folded: [U1, COMMIT], settled: true })
    show({ rows: R, folded: [U1, COMMIT], settled: false })
    show({ rows: R, folded: [U1, COMMIT, FINAL], settled: true })
    act(() => renderer?.unmount())
    expect(info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[peer-row]'))).toEqual([
      '[peer-row] drawn: the row from @general-purpose was on the screen when the chat first read it, not watched arriving; placed after commit, the last row the chat held when it last read the screen'
    ])
  })
})
