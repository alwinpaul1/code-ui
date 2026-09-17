import { describe, expect, it } from 'vitest'
import { notificationPlainText, styleText } from './notification-plain-text'

// Seen on the Galaxy S23 (2026-09-09): Claude's turn summary arrives as
// Markdown and Android showed the raw asterisks and backticks in the shade.
// The user wants the emphasis kept, not dropped, so it rides on Unicode
// letterforms — the only styling a plain notification string can carry.
describe('notification text keeps its emphasis without Markdown markers', () => {
  it('renders bold, italic and code as styled letterforms and links as their text', () => {
    expect(
      notificationPlainText('**Done** — fixed `parseQueue` in *two* files, see [the diff](https://x.y/z)')
    ).toBe(
      `${styleText('Done', 'bold')} — fixed ${styleText('parseQueue', 'mono')} in ${styleText('two', 'italic')} files, see the diff`
    )
    expect(styleText('Done', 'bold')).toBe('𝗗𝗼𝗻𝗲')
    expect(styleText('two', 'italic')).toBe('𝘵𝘸𝘰')
    expect(styleText('parseQueue', 'mono')).toBe('𝚙𝚊𝚛𝚜𝚎𝚀𝚞𝚎𝚞𝚎')
  })

  it('turns headings bold, list markers into bullets, and drops fences', () => {
    expect(
      notificationPlainText(
        '## Summary\n\n* Added the test\n- Fixed the bug\n\n```ts\nconst a = 1\n```\n\n1. next step'
      )
    ).toBe(`${styleText('Summary', 'bold')}\n\n• Added the test\n• Fixed the bug\n\nconst a = 1\n\n1. next step`)
  })

  it('leaves ordinary punctuation, digits in prose, and non-ASCII alone', () => {
    expect(notificationPlainText('Claude finished.')).toBe('Claude finished.')
    expect(notificationPlainText('2 * 3 = 6 and snake_case_name stays')).toBe(
      '2 * 3 = 6 and snake_case_name stays'
    )
    expect(styleText('Ärger 42!', 'bold')).toBe('Ä𝗿𝗴𝗲𝗿 𝟰𝟮!')
  })

  it('collapses runs of blank lines', () => {
    expect(notificationPlainText('a\n\n\n\nb')).toBe('a\n\nb')
  })
})

/** Reported from the phone 2026-09-17: a wall of "||||" in the shade. The
 *  converter stripped a table's `|---|---|` separator but left every content
 *  row's pipes, so an agent that answered with a table filled the notification
 *  with punctuation and no readable summary. A table is a layout, and a
 *  notification has no columns; the cells are what the reader wants. */
describe('a table an agent wrote', () => {
  const table = [
    '| Check | Result |',
    '| --- | --- |',
    '| tsc | clean |',
    '| tests | 6620 |'
  ].join('\n')

  it('leaves no pipes in the shade', () => {
    expect(notificationPlainText(table)).not.toContain('|')
  })

  it('keeps every cell, so the summary still says what happened', () => {
    const out = notificationPlainText(table)
    for (const cell of ['Check', 'Result', 'tsc', 'clean', 'tests', '6620']) {
      expect(out).toContain(cell)
    }
  })

  it('reads a row as one line', () => {
    expect(notificationPlainText('| tsc | clean |')).toBe('tsc \u00b7 clean')
  })

  // Degenerate shapes: one cell, and an empty cell that must not leave a stray
  // separator dangling.
  it('handles a single-cell row', () => {
    expect(notificationPlainText('| done |')).toBe('done')
  })

  it('drops empty cells rather than printing a bare separator', () => {
    expect(notificationPlainText('| tsc |  | clean |')).toBe('tsc \u00b7 clean')
  })

  // A pipe inside prose is not a table and must survive untouched.
  it('leaves a pipe in ordinary prose alone', () => {
    expect(notificationPlainText('run a | b to pipe it')).toBe('run a | b to pipe it')
  })
})

/**
 * GFM makes a table's outer pipes OPTIONAL, and agents emit them both ways.
 * Every fixture above has them, which is why the first fix looked complete and
 * a raw `--- | ---` still reached the shade.
 *
 * The blank line matters more than it looks: Android's collapsed banner shows
 * two lines. If the dropped separator leaves an empty one behind, the header
 * eats the first and the blank eats the second, so the content row — the part
 * worth reading — falls below the fold.
 */
describe('a table an agent wrote without outer pipes', () => {
  it('reads as lines, not as a separator row', () => {
    expect(notificationPlainText('Check | Result\n--- | ---\ntsc | clean\ntests | 6620')).toBe(
      'Check \u00b7 Result\ntsc \u00b7 clean\ntests \u00b7 6620'
    )
  })

  it('leaves no blank line where the separator was', () => {
    expect(notificationPlainText('| Check | Result |\n| --- | --- |\n| tsc | clean |')).toBe(
      'Check \u00b7 Result\ntsc \u00b7 clean'
    )
  })

  it('reads an aligned separator', () => {
    expect(notificationPlainText('| A | B |\n|:--- | ---:|\n| 1 | 2 |')).toBe(
      'A \u00b7 B\n1 \u00b7 2'
    )
  })

  // The safeguard that must survive loosening the outer-pipe rule: a pipe in
  // ordinary prose is not a table and must be left exactly as typed.
  it('leaves a pipe in prose alone', () => {
    expect(notificationPlainText('Run ls | wc -l to count them')).toBe('Run ls | wc -l to count them')
  })

  // Deliberately NOT tested as prose: a line fenced by pipes on both sides is
  // read as a row even with no header or delimiter, because a body is an
  // excerpt and can begin part-way through a table. Prose wrapped in pipes
  // loses that bet, and that is the right way round.

  // Degenerate: a separator with nothing above it. Written the other way round
  // at first, on the reasoning that a delimiter needs a header to mean
  // anything. It does not: an excerpt can begin AT one, `---` alone is already
  // dropped as a thematic break, and nothing in prose looks like `--- | ---`.
  // Showing it is the |||| symptom in miniature.
  it('drops a bare separator even with nothing above it', () => {
    expect(notificationPlainText('--- | ---')).toBe('')
  })

  it('keeps a one-column table readable', () => {
    expect(notificationPlainText('| Check |\n| --- |\n| tsc |')).toBe('Check\ntsc')
  })
})

/**
 * A body is an excerpt, so it can begin ANYWHERE in a table — including at the
 * delimiter row itself. The first fix treated the delimiter as an anchor but
 * never as a veto: it only classified when a header sat above it, so an excerpt
 * starting at one left the whole table raw, and a piped delimiter with no
 * header was flattened into "--- · ---" by the outer-pipe rule instead.
 *
 * Nothing else in Markdown looks like `--- | ---`, so it is unambiguous on its
 * own evidence and is dropped whatever precedes it.
 */
describe('an excerpt that begins at the separator row', () => {
  it('drops a bare separator and still reads the rows under it', () => {
    expect(notificationPlainText('--- | ---\ntsc | clean\ntests | 6620')).toBe(
      'tsc \u00b7 clean\ntests \u00b7 6620'
    )
  })

  it('does not flatten a piped separator into a row of dashes', () => {
    expect(notificationPlainText('| --- | --- |\n| tsc | clean |')).toBe('tsc \u00b7 clean')
  })

  it('drops a separator that is the only thing in the body', () => {
    expect(notificationPlainText('| --- | --- |')).toBe('')
  })
})
