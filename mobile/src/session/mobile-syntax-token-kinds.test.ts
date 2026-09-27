import { describe, expect, it } from 'vitest'
import { highlightMobileCode, type MobileSyntaxSegment } from './mobile-file-syntax'

// Lines from lever_energy.py as the desktop drew them (screenshot 2026-09-26,
// Orca's Monaco editor, Dark+). The phone drew the same file with fewer
// colours: `import` and `def` alike, `None` as a number, a class name as a
// function. Each expectation below is the colour role the desktop gave it.
const LEVER_ENERGY_PY = `#!/usr/bin/env python3
import dataclasses, json, os, sys
from blade_review_energy import arch
out = {}


def cell(em, ds, K, T=None, **bridge):
    sets = paper_rate_sets(ds)
    cfg = arch(K) if not bridge else dataclasses.replace(arch(K), name=f'K{K}_var', **bridge)
    tots, parts = [], None
    for r in sets[K]:
        e = em.estimate_heterogeneous(cfg, hetero, spike_rates=list(r) if K else None, event_input_rate=1.0)
    return dict(total=sum(tots) / len(tots), snn=t.get('snn_energy_mj'))


class Lever(Base):
    pass
`

function kindsOf(segments: readonly MobileSyntaxSegment[], text: string): string[] {
  return segments.filter((segment) => segment.text === text).map((segment) => segment.kind)
}

function highlight(code: string, language: string): MobileSyntaxSegment[] {
  const result = highlightMobileCode(code, language)
  expect(result.highlighted).toBe(true)
  return result.segments
}

describe('colouring a Python file the way the desktop does', () => {
  const segments = highlight(LEVER_ENERGY_PY, 'python')

  it('tells flow keywords (purple on desktop) from declaration keywords (blue)', () => {
    for (const word of ['import', 'from', 'for', 'if', 'else', 'return']) {
      expect(kindsOf(segments, word), word).toContain('control')
      expect(kindsOf(segments, word), word).not.toContain('keyword')
    }
    for (const word of ['def', 'not', 'class']) {
      expect(kindsOf(segments, word), word).toContain('keyword')
    }
  })

  it('colours None as a literal, not as a number', () => {
    expect(kindsOf(segments, 'None')).toEqual(['literal', 'literal', 'literal'])
    expect(kindsOf(segments, '1.0')).toEqual(['number'])
  })

  it('colours a defined function yellow and built-ins like len and dict as built-ins', () => {
    expect(kindsOf(segments, 'cell')).toEqual(['function'])
    for (const word of ['dict', 'sum', 'len', 'list']) {
      expect(kindsOf(segments, word), word).toEqual(['builtIn'])
    }
  })

  it('colours a class name and its base as types, not as functions', () => {
    expect(kindsOf(segments, 'Lever')).toEqual(['type'])
    expect(kindsOf(segments, 'Base')).toEqual(['type'])
  })

  it('colours parameter names, but not the commas and stars between them', () => {
    expect(kindsOf(segments, 'bridge')).toContain('variable')
    const params = segments.slice(
      segments.findIndex((segment) => segment.text === 'cell'),
      segments.findIndex((segment) => segment.text === 'sets')
    )
    for (const segment of params) {
      if (/^[\s,=*():]+$/.test(segment.text)) {
        expect(segment.kind, JSON.stringify(segment.text)).toBe('plain')
      }
    }
  })

  it('keeps strings and the shebang comment in their own colours', () => {
    expect(kindsOf(segments, "'snn_energy_mj'")).toEqual(['string'])
    expect(kindsOf(segments, '#!/usr/bin/env python3')).toEqual(['comment'])
  })

  it('never loses a character while recolouring', () => {
    expect(segments.map((segment) => segment.text).join('')).toBe(LEVER_ENERGY_PY)
  })
})

describe('colouring JSON, YAML, TypeScript and HTML', () => {
  it('colours JSON keys as attributes, values by type, and : and , as punctuation', () => {
    const segments = highlight('{"name": "orca", "count": 2, "ok": true, "gone": null}', 'json')
    expect(kindsOf(segments, '"name"')).toEqual(['attribute'])
    expect(kindsOf(segments, '"orca"')).toEqual(['string'])
    expect(kindsOf(segments, '2')).toEqual(['number'])
    expect(kindsOf(segments, 'true')).toEqual(['literal'])
    expect(kindsOf(segments, 'null')).toEqual(['literal'])
    expect(segments.find((segment) => segment.text.trim() === ':')?.kind).toBe('punctuation')
  })

  it('colours a YAML key as an attribute', () => {
    const segments = highlight('name: orca\nretries: 3\n', 'yaml')
    expect(kindsOf(segments, 'name:')).toEqual(['attribute'])
    expect(kindsOf(segments, '3')).toEqual(['number'])
  })

  it('keeps TypeScript primitive types as types and a method name as a function', () => {
    const segments = highlight(
      'export class Store extends Base {\n  async run(arg: string): Promise<void> {\n    return undefined\n  }\n}\n',
      'typescript'
    )
    expect(kindsOf(segments, 'string')).toEqual(['type'])
    expect(kindsOf(segments, 'Store')).toEqual(['type'])
    expect(kindsOf(segments, 'run')).toEqual(['function'])
    expect(kindsOf(segments, 'return')).toEqual(['control'])
    expect(kindsOf(segments, 'undefined')).toEqual(['literal'])
    expect(kindsOf(segments, 'class')).toEqual(['keyword'])
  })

  it('colours an HTML tag name as a tag and its attribute as an attribute', () => {
    const segments = highlight('<div class="x">hi</div>', 'xml')
    expect(kindsOf(segments, 'div')).toEqual(['tag', 'tag'])
    expect(kindsOf(segments, 'class')).toEqual(['attribute'])
    expect(kindsOf(segments, '"x"')).toEqual(['string'])
  })
})
