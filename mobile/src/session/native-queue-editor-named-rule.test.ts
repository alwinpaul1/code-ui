import { describe, expect, it, vi } from 'vitest'
import { detectTerminalComposerDraft } from '../../../src/shared/terminal-composer-draft'
import { recallNativeQueue, type QueueScreen } from './native-queue-editor'

// Claude Code 2.1.285. Orca publishes `terminal.read`'s `draft` only when its
// own composer detector (src/shared/terminal-composer-draft.ts, vendored from
// Orca 1.4.217) accepts the row above `❯` as a bare frame line
// (`/^[─━-]{8,}\s*$/`). A rule that carries the session name (captured
// 2026-09-30 from Claude Code 2.1.285 via orca terminal read --screen: 119 x
// "─", " 1152 ", one "─") or the fast-mode tag ("─… ↯ /fast ─") fails it, so
// `draft` is '' there even while Claude paints its queue placeholder. The phone
// then cannot see that the recall moved the whole queue into the input, and the
// next send clears it. So the phone must refuse to edit before any key is sent.
const HINT = 'Press up to edit queued messages'
const QUEUE = ['alpha first', 'bravo second']

const orcaRead = (rule: string): QueueScreen => {
  const lines = [
    '⏺ Bash(sleep 60)',
    '❯ alpha first',
    '❯ bravo second',
    '  ctrl+enter to send now',
    '* Manifesting… (1m 35s · ↓ 6.6k tokens)',
    rule,
    `❯ ${HINT}`,
    '─'.repeat(126)
  ]
  const composer = detectTerminalComposerDraft({
    rows: [...lines.slice(0, 6), '❯'],
    typedRows: [...lines.slice(0, 6), '❯'],
    promptGlyphBoldRows: lines.slice(0, 7).map(() => false),
    rowsBelow: [lines[7]!],
    typedRowsBelow: [lines[7]!],
    beforeCursor: '❯ ',
    afterCursor: '',
    rawAfterCursor: HINT,
    cursorHidden: false,
    cursorViewportRow: 20
  })
  return { source: 'screen', lines, draft: composer?.text ?? '' }
}

describe('recalling a queued message on Claude Code 2.1.285', () => {
  it('still edits under a bare rule, where Orca finds the composer', async () => {
    const bare = orcaRead('─'.repeat(126))
    expect(bare.draft).toBe(HINT)
    const read = vi.fn().mockResolvedValueOnce(bare).mockResolvedValue({ ...bare, draft: 'alpha first\n\nbravo second' })
    const write = vi.fn().mockResolvedValue(undefined)
    const edit = await recallNativeQueue({ read, write, pause: async () => {} }, 'claude', 0)
    expect(edit.text).toBe('alpha first')
  })

  it.each([
    ['the captured named rule', '─'.repeat(119) + ' 1152 ─'],
    ['a fast-mode rule with no name', '─'.repeat(100) + ' ↯ /fast ─'],
    ['a named fast-mode rule', '─'.repeat(90) + ' 1152 ↯ /fast ─']
  ])('refuses before any key when the rule is %s, and leaves the queue alone', async (_name, rule) => {
    const screen = orcaRead(rule)
    expect(screen.draft).toBe('')
    const read = vi.fn().mockResolvedValue(screen)
    const write = vi.fn().mockResolvedValue(undefined)
    await expect(
      recallNativeQueue({ read, write, pause: async () => {} }, 'claude', 0, QUEUE[0])
    ).rejects.toThrow(/on the desktop/i)
    expect(write).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
  })
})
