import { describe, expect, it } from 'vitest'
import {
  CODE_VIEW_HIGHLIGHT_CHUNK_LINES,
  CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS,
  buildMobileCodeDocument,
  codeDocumentChunkCount,
  codeDocumentChunkRange,
  highlightCodeDocumentChunk
} from './mobile-code-document'
import { colorBracketPairs } from './mobile-syntax-brackets'
import { splitSyntaxIntoLines } from './mobile-syntax-lines'
import { highlightMobileCode, type MobileSyntaxSegment } from '../session/mobile-file-syntax'

function bracketKinds(line: readonly MobileSyntaxSegment[]): string[] {
  return line.filter((segment) => /^[()[\]{}]$/.test(segment.text)).map((s) => `${s.text}${s.kind}`)
}

/** Every line, past the first chunk, whose brackets the chunked colouring
 *  draws in other colours than one pass over the whole file does. */
function linesColouredApart(source: string, language: string): string[] {
  const doc = buildMobileCodeDocument(source, language)
  expect(doc.highlight).toBe('chunked')
  const whole = colorBracketPairs(
    splitSyntaxIntoLines(highlightMobileCode(source, language, Infinity, Infinity).segments)
  )
  const apart: string[] = []
  for (let chunk = 1; chunk < codeDocumentChunkCount(doc); chunk += 1) {
    const { start } = codeDocumentChunkRange(doc, chunk)
    highlightCodeDocumentChunk(doc, chunk).forEach((line, offset) => {
      const index = start + offset
      const expected = bracketKinds(whole[index] ?? [])
      if (bracketKinds(line).join(' ') !== expected.join(' ')) {
        apart.push(`${index + 1}: ${doc.lines[index]} -> ${bracketKinds(line).join(' ')} (whole: ${expected.join(' ')})`)
      }
    })
  }
  return apart
}

/** A body repeated until the file is too big to colour in one pass. */
function bigFile(head: string, body: string, tail: string): string {
  const count = Math.ceil(CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS / body.length) + 10
  return `${head}${body.repeat(count)}${tail}`
}

describe('bracket colours in a file coloured a chunk at a time', () => {
  it('gives a bracket the colour the whole-file pass gives it, past the first chunk', () => {
    // A class body, as most large source files are: every method sits one
    // level deep, so its parentheses are the second bracket colour.
    const methods = Array.from(
      { length: Math.ceil(CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS / 40) + 10 },
      (_, i) => `  method${i}(value) { return value + ${i} }`
    )
    const source = ['class Store {', ...methods, '}', ''].join('\n')
    const doc = buildMobileCodeDocument(source, 'typescript')
    expect(doc.highlight).toBe('chunked')
    const whole = colorBracketPairs(
      splitSyntaxIntoLines(highlightMobileCode(source, 'typescript', Infinity, Infinity).segments)
    )
    const line = CODE_VIEW_HIGHLIGHT_CHUNK_LINES + 5
    const chunk = highlightCodeDocumentChunk(doc, 1)[line - CODE_VIEW_HIGHLIGHT_CHUNK_LINES]!
    expect(bracketKinds(chunk)).toEqual(bracketKinds(whole[line]!))
    expect(bracketKinds(chunk)).toEqual(['(bracket2', ')bracket2', '{bracket2', '}bracket2'])
  })

  it('does not count brackets inside Python strings and comments toward the depth', () => {
    // Eight lines under a one-line head, so every chunk edge (a multiple of
    // 400) falls after the return line. An edge inside the docstring would
    // test the chunk's own tokenizer, which cannot see the opening quotes.
    const body = [
      '    def render(self, rows):',
      '        print("(( unbalanced [", rows)  # closes nothing: ) ]',
      "        label = 'a { brace'",
      '        doc = """',
      '        a docstring with ( and [ in it',
      '        """',
      '        items = {"key": [1, 2]}',
      '        return [row for row in rows if row]',
      ''
    ].join('\n')
    expect(linesColouredApart(bigFile('class Table:\n', body, ''), 'python')).toEqual([])
  })

  it('does not count brackets inside TypeScript strings, templates, regexes and comments toward the depth', () => {
    const body = [
      '  render(rows: Row[]): string {',
      "    const open = '(' // and a ) in a comment",
      '    /* a block comment with { in it */',
      '    const text = `${open}[${rows.length}`',
      '    return rows.map((row) => row.name).join(", ")',
      '  }',
      '  parse(text: string): number {',
      '    const index = /\\[(\\d+)/.exec(text)?.[1] ?? "0" // a regex holding an unmatched [ and (',
      '    return (Number(index) + 1) / 2 + [text.length / 4][0]!',
      '  }',
      ''
    ].join('\n')
    expect(linesColouredApart(bigFile('export class Table {\n', body, '}\n'), 'typescript')).toEqual([])
  })

  it('reads a Rust lifetime as code, not as the start of a character', () => {
    const body = [
      "    fn name<'a>(&self, rows: &'a [Row]) -> &'a str {",
      "        let open = '(';",
      '        rows[0].name.as_str()',
      '    }',
      ''
    ].join('\n')
    expect(linesColouredApart(bigFile('impl Table {\n', body, '}\n'), 'rust')).toEqual([])
  })

  it('starts the first chunk at depth zero, and a stray closer at a chunk edge cannot take it below zero', () => {
    const lines = Array.from({ length: CODE_VIEW_HIGHLIGHT_CHUNK_LINES * 3 }, (_, i) =>
      i === CODE_VIEW_HIGHLIGHT_CHUNK_LINES ? '}) // a stray closer opens the second chunk' : `call(${'x'.repeat(250)})`
    )
    const doc = buildMobileCodeDocument(lines.join('\n'), 'javascript')
    expect(doc.highlight).toBe('chunked')
    expect(bracketKinds(highlightCodeDocumentChunk(doc, 0)[0]!)).toEqual(['(bracket1', ')bracket1'])
    const second = highlightCodeDocumentChunk(doc, 1)
    expect(bracketKinds(second[0]!)).toEqual(['}bracket1', ')bracket1'])
    expect(bracketKinds(second[1]!)).toEqual(['(bracket1', ')bracket1'])
    expect(bracketKinds(highlightCodeDocumentChunk(doc, 2).at(-1)!)).toEqual(['(bracket1', ')bracket1'])
  })
})
