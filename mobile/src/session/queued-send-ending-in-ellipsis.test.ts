import { describe, expect, it } from 'vitest'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import {
  claudeQueueViewFromScreen,
  pendingOutsideVisibleQueue,
  projectMobileChatQueue,
  queueRowIsPendingSend
} from './mobile-terminal-queued-messages'

// A short send that ENDS in an ellipsis, typed while the agent works ("wait...",
// "hmm…"), drew twice until the agent took it: once as the phone's pending
// bubble and once as the queue row. The matcher stripped a trailing "…" or
// "..." off the DRAWN row, as Claude's own shortening mark, and then compared
// it with the sent text, which still had it; under the 24-character floor the
// prefix rule refused, so nothing matched (review, 2026-09-30). The duplicate
// is the one reported twice from the phone on 2026-09-14.

// Claude Code 2.1.281's queue block, above the spinner (2026-09-24, transcribed
// from the phone's terminal view; mobile-terminal-queued-messages.test.ts),
// with the phone's send as the queued entry.
function claudeScreen(queued: string): string[] {
  return [
    '● Running 1 shell command · 14s…',
    "  ⎿  $ python3 - <<'EOF'",
    '     (ctrl+b to run in background)',
    '',
    `❯ ${queued}`,
    '  ctrl+x ctrl+s to send now',
    '',
    '✻ Incubating… (31m 27s · ↓ 67.8k tokens)',
    '  ⎿  Tip: Use /clear to start fresh when switching topics and free up context',
    '',
    '────────────────────────────────────────────────────────────────────────────────',
    '❯ Press up to edit queued messages',
    '────────────────────────────────────────────────────────────────────────────────'
  ]
}

// Codex's pending-input preview (codex-rs/tui/src/bottom_pane/pending_input_preview.rs,
// the layout codex-terminal-queued-messages.test.ts reads), with the send as its entry.
function codexScreen(queued: string): string[] {
  return ['• Queued follow-up inputs', `  ↳ ${queued}`, '    alt + ↑ edit last queued message', '› Ask Codex to do anything']
}

const SENDS = ['wait...', 'hmm…', 'and then...', '…', '...']

describe('a short queued send that ends in an ellipsis', () => {
  it.each(SENDS)('is its own drawn row: %s', (send) => {
    expect(queueRowIsPendingSend(send, send)).toBe(true)
    expect(pendingOutsideVisibleQueue([{ text: send }], [send])).toEqual([])
  })

  it.each(SENDS)('draws once in a Claude queue, as the row: %s', (send) => {
    const queue = claudeQueueViewFromScreen(claudeScreen(send)).entries
    expect(queue).toEqual([send])
    expect(projectMobileChatQueue([{ text: send }], queue)).toEqual({
      pending: [],
      queue: [{ text: send, images: [], caption: send }]
    })
  })

  it.each(SENDS)('draws once in a Codex queue, as the row: %s', (send) => {
    const queue = codexQueuedMessagesFromScreen(codexScreen(send))
    expect(queue).toEqual([send])
    expect(projectMobileChatQueue([{ text: send }], queue)).toEqual({
      pending: [],
      queue: [{ text: send, images: [], caption: send }]
    })
  })

  it('still matches a send with no ellipsis, as before', () => {
    expect(queueRowIsPendingSend('wait now', 'wait now')).toBe(true)
    expect(projectMobileChatQueue([{ text: 'wait now' }], ['wait now']).pending).toEqual([])
  })

  it("never lets a short send claim a longer message's row", () => {
    // Another message that starts the same way, typed on the desk.
    expect(queueRowIsPendingSend('wait...', 'wait... actually run the tests first')).toBe(false)
    expect(queueRowIsPendingSend('hmm…', 'hmm… let me think about it')).toBe(false)
    expect(pendingOutsideVisibleQueue([{ text: 'hmm…' }], ['hmm… let me think about it'])).toEqual([
      { text: 'hmm…' }
    ])
    // Nor a different, shorter one: "wait..." is not the row "wait".
    expect(queueRowIsPendingSend('wait...', 'wait')).toBe(false)
  })

  it('matches nothing to an empty row or an empty send', () => {
    expect(queueRowIsPendingSend('', '')).toBe(false)
    expect(queueRowIsPendingSend('…', '')).toBe(false)
    expect(queueRowIsPendingSend('', '…')).toBe(false)
    expect(pendingOutsideVisibleQueue([{ text: 'wait...' }], [])).toEqual([{ text: 'wait...' }])
  })
})
