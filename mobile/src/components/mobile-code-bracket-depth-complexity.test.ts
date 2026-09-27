import { afterEach, describe, expect, it } from 'vitest'
import { scanBracketDepth, startBracketScan } from './mobile-code-bracket-depth'

/**
 * How much string work a call does, counted without a clock: every character
 * a string method returns, searches or tests. A scan that is linear in the
 * line does a small multiple of the line's length; one that copies or tests
 * the line so far at every character does thousands of times more. Hermes
 * has no JIT, so the second froze the JS thread for seconds on one minified
 * line (review, 2026-09-27: 11.6 s on mermaid.min.js's 325 KB line).
 */
type Counted = { work: number }

const patched: [object, string, unknown][] = []

function patch<T extends object>(target: T, name: keyof T & string, cost: (self: unknown, args: unknown[], result: unknown) => number, counted: Counted): void {
  const original = target[name] as (...args: unknown[]) => unknown
  patched.push([target, name, original])
  ;(target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
    const result = original.apply(this, args)
    counted.work += cost(this, args, result)
    return result
  }
}

function stringWork(run: () => void): number {
  const counted: Counted = { work: 0 }
  const length = (value: unknown) => (typeof value === 'string' ? value.length : 0)
  const returned = (_self: unknown, _args: unknown[], result: unknown) => length(result)
  const searched = (self: unknown, args: unknown[], result: unknown) => {
    const from = typeof args[1] === 'number' ? args[1] : 0
    return typeof result === 'number' && result >= 0 ? result - from + length(args[0]) : length(self) - from
  }
  const whole = (self: unknown) => length(self)
  const tested = (_self: unknown, args: unknown[]) => length(args[0])
  patch(String.prototype, 'slice', returned, counted)
  patch(String.prototype, 'substring', returned, counted)
  patch(String.prototype, 'trimEnd', whole, counted)
  patch(String.prototype, 'trim', whole, counted)
  patch(String.prototype, 'indexOf', searched, counted)
  patch(String.prototype, 'startsWith', (_self, args) => length(args[0]), counted)
  patch(RegExp.prototype, 'test', tested, counted)
  patch(RegExp.prototype, 'exec', tested, counted)
  try {
    run()
  } finally {
    restore()
  }
  return counted.work
}

function restore(): void {
  for (const [target, name, original] of patched.splice(0).toReversed()) {
    ;(target as Record<string, unknown>)[name] = original
  }
}

afterEach(restore)

const LINE_CHARS = 20_000

function line(unit: string): string {
  return unit.repeat(Math.ceil(LINE_CHARS / unit.length)).slice(0, LINE_CHARS)
}

function scanWork(text: string, language: string): number {
  return stringWork(() => {
    scanBracketDepth([text], 0, 1, language, startBracketScan())
  })
}

describe('finding the bracket depth of a long minified line without freezing', () => {
  it('copies no more of a line than a few times its length, where divisions follow one another', () => {
    // The review's probe: each `/` copied the whole line up to it.
    const text = line('a=b/c;d=(e/f)*g;')
    let copied = 0
    const original = String.prototype.slice
    String.prototype.slice = function (this: string, ...args: [number?, number?]) {
      const result = original.apply(this, args)
      copied += result.length
      return result
    }
    try {
      scanBracketDepth([text], 0, 1, 'javascript', startBracketScan())
    } finally {
      String.prototype.slice = original
    }
    expect(copied).toBeLessThan(text.length * 20)
  })

  it.each([
    ['divisions', 'a=b/c;d=(e/f)*g;', 'javascript'],
    ['regex literals', 'x=/a[/]b/g;y=(z);', 'javascript'],
    ['slashes that open no regex', ' / [', 'javascript'],
    ['returns of regexes', 'return /x/.test(y)||', 'typescript'],
    ['templates', 'q=`a${b(c)}d`;', 'javascript'],
    ['strings with escapes', 'v="a\\"(b";w=\'c)\';', 'javascript'],
    ['block comments', 'a(/*x*/b);', 'javascript'],
    ['JSX closing tags', '<Text>{a(b)}</Text>', 'typescript'],
    ['character literals that do not close', "c='\\q(", 'c'],
    ['Rust lifetimes', "fn f<'a>(x:&'a[u8]){", 'rust'],
    ['Python strings and comments', "f('(')  # )\n", 'python'],
    ['shell comments after words', 'a$# ${#b[@]} # (', 'bash'],
    ['Lua block comments', 'x=1 --[[ ( ]] y()', 'lua']
  ])('stays linear through %s', (_shape, unit, language) => {
    const text = line(unit)
    expect(scanWork(text, language)).toBeLessThan(text.length * 20)
  })

  it('still reads a regex after an operator and after return, and a division after a value', () => {
    const depth = (text: string) => scanBracketDepth([text], 0, 1, 'javascript', startBracketScan()).depth
    expect(depth('x = /(/')).toBe(0)
    expect(depth('return /[(]/.test(s) && (')).toBe(1)
    expect(depth('total = (a + b) / (2')).toBe(1)
    expect(depth('n = count / (2')).toBe(1)
    expect(depth('typeof /(/')).toBe(0)
  })
})

/** highlight.js 11.11.1, lib/languages/xquery.js line 226 (BSD-3-Clause): a
 *  regex literal of 1919 characters whose first class holds ' and ". */
const XQUERY_LINE_226 = "      { begin: /[^</$:'\"-]\\b(?:abs|accumulator-(?:after|before)|adjust-(?:date(?:Time)?|time)-to-timezone|analyze-string|apply|available-(?:environment-variables|system-properties)|avg|base-uri|boolean|ceiling|codepoints?-(?:equal|to-string)|collation-key|collection|compare|concat|contains(?:-token)?|copy-of|count|current(?:-)?(?:date(?:Time)?|time|group(?:ing-key)?|output-uri|merge-(?:group|key))?data|dateTime|days?-from-(?:date(?:Time)?|duration)|deep-equal|default-(?:collation|language)|distinct-values|document(?:-uri)?|doc(?:-available)?|element-(?:available|with-id)|empty|encode-for-uri|ends-with|environment-variable|error|escape-html-uri|exactly-one|exists|false|filter|floor|fold-(?:left|right)|for-each(?:-pair)?|format-(?:date(?:Time)?|time|integer|number)|function-(?:arity|available|lookup|name)|generate-id|has-children|head|hours-from-(?:dateTime|duration|time)|id(?:ref)?|implicit-timezone|in-scope-prefixes|index-of|innermost|insert-before|iri-to-uri|json-(?:doc|to-xml)|key|lang|last|load-xquery-module|local-name(?:-from-QName)?|(?:lower|upper)-case|matches|max|minutes-from-(?:dateTime|duration|time)|min|months?-from-(?:date(?:Time)?|duration)|name(?:space-uri-?(?:for-prefix|from-QName)?)?|nilled|node-name|normalize-(?:space|unicode)|not|number|one-or-more|outermost|parse-(?:ietf-date|json)|path|position|(?:prefix-from-)?QName|random-number-generator|regex-group|remove|replace|resolve-(?:QName|uri)|reverse|root|round(?:-half-to-even)?|seconds-from-(?:dateTime|duration|time)|snapshot|sort|starts-with|static-base-uri|stream-available|string-?(?:join|length|to-codepoints)?|subsequence|substring-?(?:after|before)?|sum|system-property|tail|timezone-from-(?:date(?:Time)?|time)|tokenize|trace|trans(?:form|late)|true|type-available|unordered|unparsed-(?:entity|text)?-?(?:public-id|uri|available|lines)?|uri-collection|xml-to-json|years?-from-(?:date(?:Time)?|duration)|zero-or-one)\\b/ },"

/** Counts every `line[i]` read a scan makes: a String object behind a proxy
 *  (string methods still run on the string itself). */
function countedLine(text: string, reads: { count: number }): string {
  const target = new String(text)
  return new Proxy(target, {
    get(object, key) {
      if (typeof key === 'string' && key.length > 0 && key.charCodeAt(0) >= 48 && key.charCodeAt(0) <= 57) {
        reads.count += 1
      }
      const value = Reflect.get(object, key, object)
      return typeof value === 'function' ? value.bind(object) : value
    }
  }) as unknown as string
}

describe('a regex literal the scan cannot close within its reach', () => {
  const depthsOf = (lines: string[]) => {
    let state = startBracketScan()
    return lines.map((_, index) => {
      state = scanBracketDepth(lines, index, index + 1, 'javascript', state)
      return state.depth
    })
  }

  it('does not read a 1,919-character regex from highlight.js as code', () => {
    // Past a 1,000-character cap the body was scanned as code: its quotes
    // opened strings, its brackets counted, and 136 lines below it went a
    // colour off (review, 2026-09-27).
    const lines = ['    contains: [', XQUERY_LINE_226, '      {', '        begin: /\\blocal:/,', '      }', '    ]']
    expect(depthsOf(lines)).toEqual([1, 1, 2, 2, 1, 0])
    expect(scanBracketDepth(lines, 0, lines.length, 'javascript', startBracketScan()).closing).toBeNull()
  })

  it('does not open a template at a backtick inside a regex longer than 1,000 characters', () => {
    const words = Array.from({ length: 150 }, (_, i) => `word${i}`).join('|')
    const lines = [`const KEYWORDS = /\\b(?:${words})\\b|\`/g`, 'function f(a) {', '  return g(a)', '}', 'const x = [1, 2]']
    expect(lines[0]!.length).toBeGreaterThan(1_000)
    expect(depthsOf(lines)).toEqual([0, 1, 1, 0, 0])
    expect(scanBracketDepth(lines, 0, lines.length, 'javascript', startBracketScan()).closing).toBeNull()
  })

  it.each([',/[', '}/[', 'a=(/[x'])('reads a line of %s no more than a few times over', (unit) => {
    // Each slash opened a regex whose class never closed, and scanned 1,000
    // characters for its end: 5.0 s for a 325 KB line on Hermes.
    const text = line(unit)
    const reads = { count: 0 }
    const counted = countedLine(text, reads)
    const work = stringWork(() => {
      scanBracketDepth([counted], 0, 1, 'javascript', startBracketScan())
    })
    expect(reads.count + work).toBeLessThan(text.length * 20)
  })
})
