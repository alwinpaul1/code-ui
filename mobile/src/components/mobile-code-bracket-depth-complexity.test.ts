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
