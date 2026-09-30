import { describe, expect, it } from 'vitest'
import {
  projectMobileChatQueue,
  queueBlockLineIndices,
  queuedMessagesFromScreen
} from './mobile-terminal-queued-messages'

// Claude Code's legacy queue box (2.1.263 to about 2.1.276): each entry an
// indented "  ❯ " row, its further lines at the four-column continuation
// indent, above a "Press up to edit queued messages" composer. A line of a
// queued message made only of dashes, a Markdown rule "---", was skipped as
// the box's own separator, because the scan tested for a rule before it had
// seen the entry's marked row. The reading then differed from the text sent,
// the 24-character prefix rule could not match a row with its middle
// missing, and the phone's own send was drawn as a bubble AND as a queue row;
// the pencil's whole-queue recall handed back the altered text (2026-09-30).
//
// The rows follow the 2.1.263 capture in mobile-terminal-queued-messages.test.ts
// (`tmux capture-pane -p`, 80 columns: entries at "  ❯ ", continuation at four
// spaces, a blank row, a column-zero rule, the composer "❯" whose placeholder
// Orca publishes as the draft). That capture held no "---" line; this one is
// typed into a message on that shape, not captured.

const DRAFT = 'Press up to edit queued messages'
const SENT = 'Summary of plan\n---\nthen the details follow here'
const LEGACY = [
  '❯ old prompt',
  '',
  '✻ Calculating…',
  '',
  '  ❯ Summary of plan',
  '    ---',
  '    then the details follow here',
  '',
  '────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────'
]

describe('a queued message with a Markdown rule in it, on the legacy queue box', () => {
  it('reads the rule as a line of the message', () => {
    expect(queuedMessagesFromScreen(LEGACY, DRAFT)).toEqual([SENT])
  })

  it("keeps the phone's own send in the box only, not as a bubble too", () => {
    expect(projectMobileChatQueue([{ text: SENT }], queuedMessagesFromScreen(LEGACY, DRAFT))).toEqual({
      pending: [],
      queue: [{ text: SENT, images: [], caption: SENT }]
    })
  })

  it('counts the rule among the lines the box takes up', () => {
    expect([...queueBlockLineIndices(LEGACY, DRAFT)].sort((a, b) => a - b)).toEqual([4, 5, 6])
  })

  it('reads a rule that ends a message, and one between two entries', () => {
    expect(
      queuedMessagesFromScreen(
        ['✻ Working…', '', '  ❯ first entry', '    ---', '  ❯ second entry', '', '────────', '❯'],
        DRAFT
      )
    ).toEqual(['first entry\n---', 'second entry'])
  })

  it('still reads the column-zero rule under the box as its separator, and a one-line box as one entry', () => {
    expect(queuedMessagesFromScreen(['✻ Working…', '', '  ❯ only entry', '────────', '❯'], DRAFT)).toEqual([
      'only entry'
    ])
    expect(queuedMessagesFromScreen(['✻ Working…', '', '────────', '❯'], DRAFT)).toEqual([])
  })

  // The control: 2.1.277 and later draw the entry at column zero, its lines
  // at two spaces, over a send-now row, and read the same message whole.
  it('reads the same message whole on the column-zero layout', () => {
    expect(
      queuedMessagesFromScreen(
        [
          '✻ Frolicking… (1s)',
          '❯ Summary of plan',
          '  ---',
          '  then the details follow here',
          '  ctrl+x ctrl+s to send now',
          '────────',
          '❯'
        ],
        DRAFT
      )
    ).toEqual([SENT])
  })
})
