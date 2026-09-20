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
    expect(peerNoticesFromScreen(rows)).toEqual(Array.from({ length: 5 }, () => ({ sender: 'probe' })))
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

  it('finds nothing on an empty screen', () => {
    expect(peerNoticesFromScreen([])).toEqual([])
  })
})
