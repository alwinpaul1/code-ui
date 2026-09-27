import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { peerNoticesFromScreen } from './mobile-terminal-peer-notices'

// `tmux capture-pane -p -S -300` of Claude Code 2.1.278 at 46 columns,
// 2026-09-20, after a subagent named probe sent its parent one message:
//
//     › Message from @probe (ctrl+o to expand)
//
//     ⏺ received
//
// The marker is `›` (U+203A) with a plain space, the row Claude paints for a
// landed peer message; the message itself is behind ctrl+o and never on
// screen. A finished teammate's `⏺ Teammate @probe finished` row is not a
// message and is not read.
const screen = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-peer-message-2.1.278.txt', import.meta.url)),
  'utf8'
).split('\n')

// And, same build and width, a message from a SEPARATE Claude session
// (sent with SendMessage from this session, named code-ui-6f, and approved
// on the receiving side; fixtures/claude-screen-cross-session-message-2.1.278.txt).
// This form carries the message inline and wraps at column 0, the
// "(ctrl+o to expand)" tail itself wrapping across two rows:
//
//     › Message from @code-ui-6f: Capture probe from
//     the Code UI session: reply with the single
//     word received and nothing else. (ctrl+o to
//     expand)
//
// The name after @ is the sender's session name, which is the transcript
// record's from-name for the same message (checked in that session's JSONL).
const crossSession = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-cross-session-message-2.1.278.txt', import.meta.url)),
  'utf8'
).split('\n')

describe('peer message rows Claude Code paints when a subagent or session writes to it', () => {
  it('reads the sender off the real screen', () => {
    expect(peerNoticesFromScreen(screen)).toEqual([{ sender: 'probe' }])
  })

  it('reads the sender AND the message off the real cross-session screen, unwrapped', () => {
    expect(peerNoticesFromScreen(crossSession)).toEqual([
      {
        sender: 'code-ui-6f',
        body: 'Capture probe from the Code UI session: reply with the single word received and nothing else.'
      }
    ])
  })

  it('keeps one entry per row, so five replies from one agent are five', () => {
    const rows = Array.from({ length: 5 }, () => '› Message from @probe (ctrl+o to expand)')
    expect(peerNoticesFromScreen(rows).map((row) => row.sender)).toEqual(Array.from({ length: 5 }, () => 'probe'))
  })

  it('reads a bodied row that fits on one line, and one whose tail wraps alone', () => {
    expect(peerNoticesFromScreen(['› Message from @a: hi there (ctrl+o to expand)'])).toEqual([{ sender: 'a', body: 'hi there' }])
    expect(peerNoticesFromScreen(['› Message from @a: hi there (ctrl+o to', 'expand)'])).toEqual([{ sender: 'a', body: 'hi there' }])
  })

  it('refuses a bodied row whose tail never closes, and still reads the next row', () => {
    expect(
      peerNoticesFromScreen(['› Message from @a: the screen cut this row', '', '› Message from @b (ctrl+o to expand)'])
    ).toEqual([{ sender: 'b' }])
  })

  it('does not read a finished-teammate row, a prompt, or prose that mentions a message', () => {
    expect(
      peerNoticesFromScreen([
        '⏺ Teammate @probe finished',
        '  Sent "hello from probe" to team-lead.',
        '❯ Message from @probe (ctrl+o to expand)',
        '  Message from @probe (ctrl+o to expand)',
        '⏺ A message from @probe arrived.'
      ])
    ).toEqual([])
  })

  // Combined review of fix/prompt-leak, 2026-09-27: a peer message waiting in
  // the queue box (the 2.1.281 layout) is not in the turn yet. Read there, it
  // was counted again once Claude took it and painted it in the turn.
  it('leaves out a row waiting in the queue box, and reads the one in the turn above it', () => {
    const RULE = '────────────────────────────────────────────────────────────────────────────────'
    const screen = [
      '⏺ The suite is green; reading the dump for the render counts now.',
      '',
      '› Message from @probe (ctrl+o to expand)',
      '',
      '● Running 1 shell command · 14s…',
      '',
      '› Message from @a9d5c2f85e94ca47f (ctrl+o to expand)',
      '❯ We miss this[Image #102]',
      '  ctrl+x ctrl+s to send now',
      '',
      '✻ Incubating… (31m 27s · ↓ 67.8k tokens)',
      '',
      RULE,
      '❯ Press up to edit queued messages',
      RULE
    ]
    expect(peerNoticesFromScreen(screen).map((row) => row.sender)).toEqual(['probe'])
  })

  it('finds nothing on an empty screen', () => {
    expect(peerNoticesFromScreen([])).toEqual([])
  })
})
