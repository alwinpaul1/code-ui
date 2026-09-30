import { describe, expect, it } from 'vitest'
import { createMarkdownLinkFinder } from '../components/markdown-inline-links'
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

  // CommonMark 4.2: a closing run of '#' set apart by a space is markup, one
  // touching the last word is the word's (swept 2026-09-30).
  it('drops a heading closing run of hashes but keeps a hash in the last word', () => {
    expect(notificationPlainText('## Summary ##')).toBe(styleText('Summary', 'bold'))
    expect(notificationPlainText('## Ported to C#')).toBe(styleText('Ported to C#', 'bold'))
    expect(styleText('Ported to C#', 'bold').endsWith('#')).toBe(true)
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

/**
 * Where the table ends. The row run stops at the first line with no pipe, which
 * is what keeps it from swallowing the prose after a table — and is also why a
 * pipe-bearing line that follows a table with NO blank line between them is
 * read as one more row. That is the cost of having no blank line to go on, and
 * it is pinned here so a future change has to argue with it rather than
 * discover it.
 */
describe('where a table stops', () => {
  it('drops a separator with prose above it rather than a header', () => {
    expect(notificationPlainText('Some prose\n\n| --- | --- |')).toBe('Some prose')
  })

  it('leaves the line above alone when it is prose, not a header', () => {
    expect(notificationPlainText('Some prose\n--- | ---\ntsc | clean')).toBe(
      'Some prose\ntsc \u00b7 clean'
    )
  })

  it('stops at a blank line, so prose with a pipe keeps it', () => {
    expect(
      notificationPlainText('| Check |\n| --- |\n| tsc | clean |\n\nrun a | b to pipe it')
    ).toBe('Check\ntsc \u00b7 clean\n\nrun a | b to pipe it')
  })

  it('reads a pipe line that abuts the table as one more row, having nothing else to go on', () => {
    expect(
      notificationPlainText('| Check |\n| --- |\n| tsc | clean |\nrun a | b to pipe it')
    ).toBe('Check\ntsc \u00b7 clean\nrun a \u00b7 b to pipe it')
  })
})

// Seen on the Galaxy S23 (2026-09-18, 12:04): "main is merged into the PR and
// everything is verified locally. | | | |---|---| | Backend | 7365 passed / 0
// failed (up from 7294 — the extra 71 are #972's pricing tests) | | …". The
// desktop collapses every run of whitespace in a body to one space
// (`replace(/\s+/g, ' ')` in Orca 1.4.205's notification composer), so a
// table that was four lines arrives as ONE, and the line-based reader above
// saw no separator line and left every pipe standing.
describe('a table the desktop flattened onto one line', () => {
  const body =
    '`main` is merged into the PR and everything is verified locally. | | | |---|---| ' +
    "| Backend | **7365 passed / 0 failed** (up from 7294 — the extra 71 are #972's pricing tests) | " +
    '| Frontend | **412 passed / 0 failed** |'

  it('leaves no pipes in the shade', () => {
    expect(notificationPlainText(body)).not.toContain('|')
  })

  it('puts the prose on its own line and each row on its own line', () => {
    const lines = notificationPlainText(body).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/is merged into the PR and everything is verified locally\.$/)
    expect(lines[1]).toMatch(/^Backend · /)
    expect(lines[1]).toContain("(up from 7294 — the extra 71 are #972's pricing tests)")
    expect(lines[2]).toMatch(/^Frontend · /)
  })

  it('drops a header whose cells are all empty', () => {
    expect(notificationPlainText(body)).not.toMatch(/\n\s*·|·\s*\n/)
  })

  it('keeps a header with words in it as the first row', () => {
    const lines = notificationPlainText(
      'Results: | Suite | Result | |---|---| | tsc | clean | | tests | 6620 |'
    ).split('\n')
    expect(lines).toEqual(['Results:', 'Suite · Result', 'tsc · clean', 'tests · 6620'])
  })

  it('keeps prose that follows the last row', () => {
    const lines = notificationPlainText('|---|---| | a | b | Then I stopped.').split('\n')
    expect(lines).toEqual(['a · b', 'Then I stopped.'])
  })

  it('reads a one-column table', () => {
    expect(notificationPlainText('|---| | only | | one |')).toBe('only\none')
  })

  it('leaves a shell pipe in prose alone', () => {
    expect(notificationPlainText('ran ls | wc -l and got 3')).toBe('ran ls | wc -l and got 3')
  })

  // A dash is an ordinary cell ("no change"); only a run of three or more is
  // the delimiter agents write. Reflowing this row would have cut it in two.
  it('leaves a row whose cell is a single dash as one row', () => {
    expect(notificationPlainText('| tsc | - |')).toBe('tsc \u00b7 -')
  })
})

/** Review, 2026-09-30: `* * *` and `- - -` are rules, as `---` is, but the
 *  list-marker rewrite ran before the rule check and made them "\u2022 * *" and
 *  "\u2022 - -", a bullet with two stray marks in a turn's preview. The fixtures
 *  are built in the shapes each agent writes a turn summary (bold lead-in and
 *  `-` bullets for Claude Code, a heading and `*` bullets for Codex); they
 *  were not captured from a live session. */
describe('a spaced rule between the parts of a turn summary', () => {
  it('drops a Claude-style "* * *" and keeps the bullets around it', () => {
    const summary = [
      '**Fixed** the flaky queue test.',
      '',
      '- `parseQueue` now waits for the prompt row',
      '- Added a regression test',
      '',
      '* * *',
      '',
      'All tests pass.'
    ].join('\n')
    expect(notificationPlainText(summary)).toBe(
      [
        `${styleText('Fixed', 'bold')} the flaky queue test.`,
        '',
        `\u2022 ${styleText('parseQueue', 'mono')} now waits for the prompt row`,
        '\u2022 Added a regression test',
        '',
        'All tests pass.'
      ].join('\n')
    )
  })

  it('drops a Codex-style "- - -" and keeps the bullets around it', () => {
    const summary = [
      '## Summary',
      '',
      '* Updated `relay.ts`',
      '* Ran `pnpm test`',
      '',
      '- - -',
      '',
      'Next: ship it.'
    ].join('\n')
    expect(notificationPlainText(summary)).toBe(
      [
        styleText('Summary', 'bold'),
        '',
        `\u2022 Updated ${styleText('relay.ts', 'mono')}`,
        `\u2022 Ran ${styleText('pnpm test', 'mono')}`,
        '',
        'Next: ship it.'
      ].join('\n')
    )
  })

  it('drops every spelling of a rule, spaced or not', () => {
    for (const rule of ['* * *', '- - -', '_ _ _', '***', '---', '___', '*  *  *  *', '  - - -']) {
      expect(notificationPlainText(`a\n\n${rule}\n\nb`), rule).toBe('a\n\nb')
    }
  })

  it('leaves a one-item bullet and a bullet holding marks as bullets', () => {
    expect(notificationPlainText('- item')).toBe('\u2022 item')
    expect(notificationPlainText('* a')).toBe('\u2022 a')
    expect(notificationPlainText('- - item')).toBe('\u2022 - item')
    // Mixed marks are no rule (CommonMark 4.1): a bullet holding "* -".
    expect(notificationPlainText('- * -')).toBe('\u2022 * -')
  })

  it('reads a rule that is the whole body as nothing', () => {
    expect(notificationPlainText('* * *')).toBe('')
  })
})

// Review, 2026-09-30: the chat ends a link's address at the `)` that balances
// it (markdown-inline-links.ts), but the shade still cut the address at its
// first `)`, so a Wikipedia link left its tail after the words, and a README
// badge drew `![CI](r)`. The shade now reads links the way the chat does.
describe('a link in the shade reads as its words, however its address is spelled', () => {
  it('leaves no stray ")" after a link whose address holds parentheses', () => {
    expect(notificationPlainText('[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) done')).toBe('Foo done')
  })

  it('keeps the alt text of an image whose address holds parentheses', () => {
    expect(notificationPlainText('![alt](x_(y).png)')).toBe('alt')
  })

  it('reads a README badge as the words of its image', () => {
    expect(notificationPlainText('[![CI](b.svg)](r)')).toBe('CI')
    expect(notificationPlainText('Build [![CI](https://x.dev/b.svg?a=(1))](https://x.dev/r) green')).toBe(
      'Build CI green'
    )
  })

  it('reads two links on one line, the first holding parentheses', () => {
    expect(notificationPlainText('See [Foo](https://w.org/Foo_(bar)) and [Baz](https://w.org/Baz) now')).toBe(
      'See Foo and Baz now'
    )
  })

  it('keeps a link that never closes as written', () => {
    expect(notificationPlainText('[a](b(c')).toBe('[a](b(c')
    expect(notificationPlainText('[a](b(c) tail')).toBe('[a](b(c) tail')
  })

  it('keeps a link with no words as written, as the chat draws it', () => {
    expect(notificationPlainText('[](x)')).toBe('[](x)')
    // An image may have no words: it reads as nothing, as before.
    expect(notificationPlainText('a ![](x_(y).png) b')).toBe('a  b')
  })

  it('still styles the words of a link after it drops the address', () => {
    expect(notificationPlainText('[**Foo**](https://w.org/Foo_(bar)) done')).toBe(
      `${styleText('Foo', 'bold')} done`
    )
  })

  // The shade reads nested words in one pass with a stack, so a body nesting
  // images deeply cannot run out of stack. Held here to the obvious reading:
  // each link's words read again, on their own, as a line.
  it('reads every nesting of links and images as the obvious recursion does', () => {
    const fragments = ['[', ']', '(', ')', '!', 'a', ' ', '[a](b)', '![a](b)', '[![a](b)](c)', '](', '![', '(b(c))']
    let seed = 12345
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    for (let run = 0; run < 5000; run += 1) {
      const text = Array.from({ length: 1 + (random() % 40) }, () => fragments[random() % fragments.length]).join('')
      expect(notificationPlainText(text), text).toBe(recursiveLinkWords(text).trim())
    }
  })

  // A call per label threw "Maximum call stack size exceeded" here in Node
  // (and spent 6 s getting there); Hermes has less stack than Node. The one
  // pass takes a few milliseconds.
  it('reads twenty thousand images nested in each other without running out of stack', () => {
    const depth = 20_000
    const nested = `${'!['.repeat(depth)}deep${'](x_(1))'.repeat(depth)}`
    expect(notificationPlainText(nested)).toBe('deep')
  })
})

function recursiveLinkWords(text: string): string {
  const find = createMarkdownLinkFinder(text, true)
  let out = ''
  let at = 0
  for (let link = find(0); link; link = find(link.end)) {
    const words = text.slice(link.index + (link.image ? 2 : 1), link.labelEnd)
    out += text.slice(at, link.index) + recursiveLinkWords(words)
    at = link.end
  }
  return out + text.slice(at)
}
