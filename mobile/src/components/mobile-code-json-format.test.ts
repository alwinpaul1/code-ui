import { describe, expect, it } from 'vitest'
import { formatMinifiedJsonForReading } from './mobile-code-json-format'

describe('opening a minified JSON file', () => {
  it('pretty-prints a file that is all on one line', () => {
    expect(formatMinifiedJsonForReading('{"name":"orca","tags":["a","b"],"on":true,"n":null}')).toBe(
      [
        '{',
        '  "name": "orca",',
        '  "tags": [',
        '    "a",',
        '    "b"',
        '  ],',
        '  "on": true,',
        '  "n": null',
        '}'
      ].join('\n')
    )
  })

  it('pretty-prints one line that ends in a newline, as most tools write it', () => {
    expect(formatMinifiedJsonForReading('[1,2]\n')).toBe('[\n  1,\n  2\n]')
  })

  it('never rewrites a value: big numbers, escapes and duplicate keys stay exactly as written', () => {
    // JSON.parse + JSON.stringify would round the number, decode the escape
    // and drop the first "a". Reading a file must not change what it says.
    const minified = '{"n":12345678901234567890,"s":"caf\\u00e9 \\"q\\" [x] {y}","a":1,"a":2}'
    expect(formatMinifiedJsonForReading(minified)).toBe(
      [
        '{',
        '  "n": 12345678901234567890,',
        '  "s": "caf\\u00e9 \\"q\\" [x] {y}",',
        '  "a": 1,',
        '  "a": 2',
        '}'
      ].join('\n')
    )
  })

  it('keeps empty objects and arrays on one line', () => {
    expect(formatMinifiedJsonForReading('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}')
  })
})

describe('leaving a JSON file as it is', () => {
  it('shows an already formatted file untouched', () => {
    expect(formatMinifiedJsonForReading('{\n  "a": 1\n}\n')).toBeNull()
  })

  it('shows a file that does not parse untouched, JSONC comments included', () => {
    expect(formatMinifiedJsonForReading('{"a":')).toBeNull()
    expect(formatMinifiedJsonForReading('{"a":1 /* c */}')).toBeNull()
    expect(formatMinifiedJsonForReading('not json at all')).toBeNull()
  })

  it('leaves empty files, bare values and already-minimal documents alone', () => {
    expect(formatMinifiedJsonForReading('')).toBeNull()
    expect(formatMinifiedJsonForReading('   \n')).toBeNull()
    expect(formatMinifiedJsonForReading('42')).toBeNull()
    expect(formatMinifiedJsonForReading('"text"')).toBeNull()
    expect(formatMinifiedJsonForReading('[]')).toBeNull()
    expect(formatMinifiedJsonForReading('{}')).toBeNull()
  })
})
