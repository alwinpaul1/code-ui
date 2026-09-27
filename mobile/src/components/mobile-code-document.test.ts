import { describe, expect, it } from 'vitest'
import { highlightMobileCode, type MobileSyntaxSegment } from '../session/mobile-file-syntax'
import {
  CODE_VIEW_HIGHLIGHT_CHUNK_LINES,
  CODE_VIEW_MAX_HIGHLIGHT_CHARS,
  CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS,
  buildMobileCodeDocument,
  codeDocumentChunkCount,
  codeDocumentChunkOf,
  codeDocumentChunkRange,
  highlightCodeDocumentChunk,
  plainCodeDocumentLine
} from './mobile-code-document'

const PYTHON_BLOCK = [
  'def cell(em, ds, K, T=None, **bridge):',
  '    sets = paper_rate_sets(ds)',
  "    cfg = arch(K) if not bridge else dataclasses.replace(arch(K), name=f'K{K}_var')",
  '    for r in sets[K]:',
  "        e = em.estimate(cfg, rate=1.0, spike_rates=list(r) if K else None)",
  "    return dict(total=sum(tots) / len(tots), snn=t.get('snn_energy_mj'))",
  '',
  ''
].join('\n')

function repeatTo(block: string, minChars: number): string {
  return block.repeat(Math.ceil(minChars / block.length))
}

function coloured(line: readonly MobileSyntaxSegment[]): boolean {
  return line.some((segment) => segment.kind !== 'plain')
}

describe('keeping bigger files coloured', () => {
  it('colours a Python file past the old 48,000-character and 3,000-span caps, to its last line', () => {
    const source = repeatTo(PYTHON_BLOCK, 60_000)
    // The old path gave up on this file entirely: too many spans for one Text.
    expect(highlightMobileCode(source, 'python').highlighted).toBe(false)

    const doc = buildMobileCodeDocument(source, 'python')
    expect(doc.highlight).toBe('whole')
    expect(codeDocumentChunkCount(doc)).toBe(1)
    const lines = highlightCodeDocumentChunk(doc, 0)
    expect(lines).toHaveLength(doc.lines.length)
    const lastCode = doc.lines.findLastIndex((line) => line.startsWith('    return'))
    expect(coloured(lines[lastCode]!)).toBe(true)
  })

  it('colours a file too big for one pass a chunk of lines at a time', () => {
    const source = repeatTo(PYTHON_BLOCK, CODE_VIEW_WHOLE_FILE_HIGHLIGHT_CHARS + 40_000)
    const doc = buildMobileCodeDocument(source, 'python')
    expect(doc.highlight).toBe('chunked')
    const count = codeDocumentChunkCount(doc)
    expect(count).toBe(Math.ceil(doc.lines.length / CODE_VIEW_HIGHLIGHT_CHUNK_LINES))

    const third = codeDocumentChunkRange(doc, 2)
    expect(third).toEqual({
      start: 2 * CODE_VIEW_HIGHLIGHT_CHUNK_LINES,
      end: 3 * CODE_VIEW_HIGHLIGHT_CHUNK_LINES
    })
    expect(codeDocumentChunkOf(doc, third.start)).toBe(2)
    expect(codeDocumentChunkOf(doc, third.end - 1)).toBe(2)
    const lines = highlightCodeDocumentChunk(doc, 2)
    expect(lines).toHaveLength(CODE_VIEW_HIGHLIGHT_CHUNK_LINES)
    const defLine = doc.lines.slice(third.start, third.end).findIndex((line) => line.startsWith('def '))
    expect(coloured(lines[defLine]!)).toBe(true)

    // The last chunk holds only what is left.
    const last = codeDocumentChunkRange(doc, count - 1)
    expect(last.end).toBe(doc.lines.length)
    expect(highlightCodeDocumentChunk(doc, count - 1)).toHaveLength(last.end - last.start)
  })

  it('leaves one chunk plain when it holds a minified line too long to tokenize, and still colours the rest', () => {
    const minified = `var a=${'[1,2,3],'.repeat(40_000)}0;`
    const rest = 'const answer = 42\n'.repeat(CODE_VIEW_HIGHLIGHT_CHUNK_LINES * 2)
    const doc = buildMobileCodeDocument(`${minified}\n${rest}`, 'javascript')
    expect(doc.highlight).toBe('chunked')
    const first = highlightCodeDocumentChunk(doc, 0)
    expect(first[0]).toEqual([{ text: minified, kind: 'plain' }])
    expect(coloured(highlightCodeDocumentChunk(doc, 1)[0]!)).toBe(true)
  })

  it('keeps a guard for huge files, and for text there is nothing to colour', () => {
    const huge = buildMobileCodeDocument('x = 1\n'.repeat(CODE_VIEW_MAX_HIGHLIGHT_CHARS / 6 + 1), 'python')
    expect(huge.highlight).toBe('none')
    expect(codeDocumentChunkCount(huge)).toBe(0)
    expect(buildMobileCodeDocument('plain words', 'plaintext').highlight).toBe('none')
    expect(buildMobileCodeDocument('', 'python').highlight).toBe('none')
  })
})

describe('the document the viewer draws', () => {
  it('has one line and no guides for an empty file', () => {
    const doc = buildMobileCodeDocument('', 'python')
    expect(doc.lines).toEqual([''])
    expect(doc.guides).toEqual([0])
    expect(doc.maxColumns).toBe(0)
    expect(plainCodeDocumentLine(doc, 0)).toEqual([])
  })

  it('measures its widest line with tabs expanded, and draws tabs as spaces', () => {
    const doc = buildMobileCodeDocument('func f() {\n\treturn 1\n}', 'go')
    expect(doc.maxColumns).toBe('    return 1'.length)
    expect(plainCodeDocumentLine(doc, 1)).toEqual([{ text: '    return 1', kind: 'plain' }])
    expect(doc.guides).toEqual([0, 1, 0])
  })

  it('pretty-prints a minified JSON file and says so', () => {
    const doc = buildMobileCodeDocument('{"a":{"b":[1,2]}}', 'json')
    expect(doc.reformatted).toBe(true)
    expect(doc.lines).toEqual(['{', '  "a": {', '    "b": [', '      1,', '      2', '    ]', '  }', '}'])
    expect(doc.indentStep).toBe(2)
    expect(doc.guides).toEqual([0, 1, 2, 3, 3, 2, 1, 0])
  })

  it('shows JSON that is already formatted, or does not parse, exactly as written', () => {
    for (const source of ['{\n    "a": 1\n}', '{"a":']) {
      const doc = buildMobileCodeDocument(source, 'json')
      expect(doc.reformatted).toBe(false)
      expect(doc.lines.join('\n')).toBe(source)
    }
  })

  it('colours JSON brackets by depth once highlighted', () => {
    const doc = buildMobileCodeDocument('{"a":[1]}', 'json')
    const lines = highlightCodeDocumentChunk(doc, 0)
    expect(lines[0]).toEqual([{ text: '{', kind: 'bracket1' }])
    expect(lines[1]).toContainEqual({ text: '[', kind: 'bracket2' })
  })
})
