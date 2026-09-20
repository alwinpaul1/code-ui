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

describe('peer message rows Claude Code paints when a subagent or session writes to it', () => {
  it('reads the sender off the real screen', () => {
    expect(peerNoticesFromScreen(screen)).toEqual(['probe'])
  })

  it('keeps one entry per row, so five replies from one agent are five', () => {
    const rows = Array.from({ length: 5 }, () => '› Message from @probe (ctrl+o to expand)')
    expect(peerNoticesFromScreen(rows)).toEqual(['probe', 'probe', 'probe', 'probe', 'probe'])
  })

  it('reads a cross-session row the same way', () => {
    expect(peerNoticesFromScreen(['› Cross-session message from @observer-sessions-17 (ctrl+o to expand)'])).toEqual([
      'observer-sessions-17'
    ])
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
