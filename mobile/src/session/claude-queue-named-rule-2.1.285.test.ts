import { describe, expect, it } from 'vitest'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import {
  NAMED_RULES,
  QUEUED_ROW_TEXT,
  queuedScreen2_1_285,
  takenScreen2_1_285
} from './fixtures/claude-queued-named-rule-2.1.285'
import { claudeQueueViewFromScreen, queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'

// Claude Code 2.1.285 (reported 2026-09-30). The fixture's provenance, and what
// only a live capture can settle, are in the fixture file.
describe('Claude Code 2.1.285 queue under a named prompt rule', () => {
  it('keeps a queued message queued when the rule under the spinner carries the session name, as captured from a live 2.1.285 tab', () => {
    expect(queuedMessagesFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152))).toEqual([QUEUED_ROW_TEXT])
  })

  it('reads the same with the blank rows a real terminal has and Orca drops', () => {
    const screen = queuedScreen2_1_285(NAMED_RULES.captured1152)
    const spinner = screen.findIndex((line) => line.startsWith('*'))
    const withBlanks = [...screen.slice(0, spinner), '', screen[spinner]!, '', ...screen.slice(spinner + 1)]
    expect(queuedMessagesFromScreen(withBlanks)).toEqual([QUEUED_ROW_TEXT])
  })

  it('is not a selection: the view reads the entry with nothing marked', () => {
    const view = claudeQueueViewFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152))
    expect(view.entries).toEqual([QUEUED_ROW_TEXT])
    expect(view.selecting).toBe(false)
  })

  it('still reads the unnamed rule 2.1.284 and older draw', () => {
    expect(queuedMessagesFromScreen(queuedScreen2_1_285(NAMED_RULES.bare))).toEqual([QUEUED_ROW_TEXT])
  })

  it('drops the row once Claude takes the message (no send-now row, no placeholder)', () => {
    for (const rule of Object.values(NAMED_RULES)) {
      expect(queuedMessagesFromScreen(takenScreen2_1_285(rule))).toEqual([])
    }
  })

  it('refuses when the send-now row has no marked row above it', () => {
    const screen = queuedScreen2_1_285(NAMED_RULES.captured1152).filter((line) => !line.startsWith('❯ Can'))
    expect(queuedMessagesFromScreen(screen)).toEqual([])
  })

  it('does not treat a row of text that merely starts with rule glyphs as a rule', () => {
    const screen = queuedScreen2_1_285('──── and then some words')
    expect(queuedMessagesFromScreen(screen)).toEqual([])
  })

  it('reads an empty screen and a lone queue row without throwing', () => {
    expect(queuedMessagesFromScreen([])).toEqual([])
    expect(queuedMessagesFromScreen(['❯ Press up to edit queued messages'])).toEqual([])
  })

  it('leaves Codex alone: it has its own reader and this screen is no Codex queue', () => {
    expect(codexQueuedMessagesFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152))).toEqual([])
  })

  // How Claude Code builds the row (2.1.285 `fv`, 2.1.284 `Ub`, rebuilt byte for
  // byte by the review): glyphs = columns - name width - 3, then " name ─"; fast
  // mode takes a tag and two more columns; a name wider than columns - 3 is cut
  // with "…" and the row then starts with a space. Widths are the review's.
  const rowOf = (columns: number, name: string, tag = '') => {
    const label = tag ? `${name} ${tag}` : name
    if (label.length > columns - 3) {
      return ` ${label.slice(0, columns - 6)}… ─`
    }
    return '─'.repeat(columns - label.length - 3) + ` ${label} ─`
  }

  it.each([
    ['40 columns, a 30-character name (7 glyphs)', rowOf(40, 'n'.repeat(30))],
    ['46 columns, a 40-character name (3 glyphs)', rowOf(46, 'x'.repeat(40))],
    ['a name over 81 characters at 126 columns', rowOf(126, 'y'.repeat(100))],
    ['an overflowing name, cut with an ellipsis, no leading glyph', rowOf(30, 'z'.repeat(60))],
    ['fast mode at a narrow width', rowOf(40, 'paper-review', '↯ /fast')],
    ['fast mode with no name', '─'.repeat(30) + ' ↯ /fast ─']
  ])('keeps the queue for a rule Claude builds with %s', (_name, rule) => {
    expect(queuedMessagesFromScreen(queuedScreen2_1_285(rule))).toEqual([QUEUED_ROW_TEXT])
  })

  it('does not take a row that ends in words rather than the rule glyph for a rule', () => {
    expect(queuedMessagesFromScreen(queuedScreen2_1_285('─'.repeat(40) + ' paper-review'))).toEqual([])
  })
})

// Orca publishes `draft` only when its composer detector accepts the row above
// Claude's `❯`, and it accepts only a bare rule: under a named rule `draft` is ''
// while the queue shows (captured 2026-09-30, Claude Code 2.1.285; 2.1.286 keeps
// the strings). recallNativeQueue refuses the edit then, so a pencil there was
// one that could only ever say "Edit this queued message on the desktop".
describe('the queue box offers editing only where Orca can read the input box', () => {
  const HINT = 'Press up to edit queued messages'

  it('offers no editing under a named rule, where Orca publishes no draft', () => {
    const read = queueBoxReadFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152), 'claude', '')
    expect(read).toMatchObject({ entries: [QUEUED_ROW_TEXT], readable: true, editable: false })
  })

  it('offers no editing when the read carried no draft at all', () => {
    const read = queueBoxReadFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152), 'claude')
    expect(read.editable).toBe(false)
  })

  it('offers editing under the bare rule, where the draft is the queue hint', () => {
    const read = queueBoxReadFromScreen(queuedScreen2_1_285(NAMED_RULES.bare), 'claude', HINT)
    expect(read).toMatchObject({ entries: [QUEUED_ROW_TEXT], editable: true })
  })

  it('offers editing for Codex, which recalls its latest entry whatever the draft', () => {
    const codex = ['• Queued follow-up inputs', '  ↳ mobile task', '    alt + ↑ edit last queued message', '› ']
    expect(queueBoxReadFromScreen(codex, 'codex', '')).toMatchObject({
      entries: ['mobile task'],
      editable: true
    })
  })

  it('degenerate: offers no editing for an empty box or a screen it cannot read', () => {
    expect(queueBoxReadFromScreen(takenScreen2_1_285(NAMED_RULES.bare), 'claude', HINT).editable).toBe(false)
    expect(queueBoxReadFromScreen([], 'claude', HINT).editable).toBe(false)
    expect(queueBoxReadFromScreen(['some', 'lines'], 'gemini', HINT).editable).toBe(false)
  })
})
