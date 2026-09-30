// ─── The `meta` literal of a Workflow script, read without running it ───────
// A Workflow tool call carries the whole script, and it opens with
// `export const meta = { name, description, phases: [{ title, detail, … }] }`
// (Claude Code 2.1.284, fixtures/claude-workflow-2.1.284.ts). The phone names
// the workflow and its phases from that literal.
//
// The script is code the model wrote, so it is never evaluated: this is a
// reader for the JSON-like subset a literal uses (objects, arrays, quoted
// strings, numbers, booleans, null, comments, trailing commas). Anything else
// (a call, a computed value, a template interpolation, a literal cut short)
// refuses the whole meta, and the card draws without one.

export type WorkflowMeta = {
  name: string | null
  description: string | null
  /** Null when the meta names none; an empty list when it names an empty one. */
  phases: { title: string; detail: string | null }[] | null
}

const META_OPENING = /^export\s+const\s+meta\s*=\s*/
/** How Orca's mobile wire ends a tool input string it cut (~4000 characters). */
const TRUNCATION_MARKER = '… (truncated)'
const IDENTIFIER = /[A-Za-z_$][\w$]*/y
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }
/** Deep enough for any real meta, shallow enough that a hostile script cannot
 *  spend the stack. */
const MAX_DEPTH = 8

export function parseWorkflowMeta(script: string): WorkflowMeta | null {
  // A script the wire cut ends in its marker. The literal opens the script, so
  // a cut usually lands after it; when it lands inside, what was read whole
  // before the cut is kept and the rest is left out (never half a string).
  const cut = script.endsWith(TRUNCATION_MARKER)
  const source = cut ? script.slice(0, -TRUNCATION_MARKER.length) : script
  const start = findMetaValue(source)
  if (start === null) {
    return null
  }
  const value = new LiteralReader(source, start, cut).readValue(0)
  if (!isRecord(value)) {
    return null
  }
  return {
    name: nonEmptyString(value.name),
    description: nonEmptyString(value.description),
    phases: readPhases(value.phases)
  }
}

/** Where the value of the first top-level `export const meta =` begins.
 *  Comments and strings are skipped, so a mention of it in either is not it,
 *  and only code outside every bracket counts. */
function findMetaValue(source: string): number | null {
  let depth = 0
  let at = 0
  while (at < source.length) {
    const char = source[at]!
    if (source.startsWith('//', at)) {
      const end = source.indexOf('\n', at)
      at = end === -1 ? source.length : end + 1
    } else if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2)
      at = end === -1 ? source.length : end + 2
    } else if (char === "'" || char === '"' || char === '`') {
      at = endOfString(source, at)
    } else {
      if (depth === 0 && char === 'e') {
        const opening = META_OPENING.exec(source.slice(at, at + 64))
        if (opening) {
          return at + opening[0].length
        }
      }
      if ('{(['.includes(char)) {
        depth += 1
      } else if ('})]'.includes(char)) {
        depth = Math.max(0, depth - 1)
      }
      at += 1
    }
  }
  return null
}

function endOfString(source: string, from: number): number {
  const quote = source[from]
  let at = from + 1
  while (at < source.length) {
    if (source[at] === '\\') {
      at += 2
    } else if (source[at] === quote || (quote !== '`' && source[at] === '\n')) {
      return at + 1
    } else {
      at += 1
    }
  }
  return source.length
}

function readPhases(value: unknown): WorkflowMeta['phases'] {
  if (!Array.isArray(value)) {
    return null
  }
  const phases: { title: string; detail: string | null }[] = []
  for (const entry of value) {
    const title = isRecord(entry) ? nonEmptyString(entry.title) : null
    if (title !== null) {
      phases.push({ title, detail: isRecord(entry) ? nonEmptyString(entry.detail) : null })
    }
  }
  return phases
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

class Refusal extends Error {}
/** The source ended inside the literal: a refusal, unless the cut was the wire's. */
class EndOfInput extends Refusal {}

class LiteralReader {
  private at: number

  constructor(
    private readonly source: string,
    start: number,
    private readonly cut: boolean
  ) {
    this.at = start
  }

  /** The literal's value, or null for anything this reader will not take. */
  readValue(depth: number): unknown {
    try {
      return this.value(depth)
    } catch (error) {
      if (error instanceof Refusal) {
        return null
      }
      throw error
    }
  }

  /** Ending at the end of the source is EndOfInput; anything else is a Refusal. */
  private fail(): Refusal {
    return this.at >= this.source.length ? new EndOfInput() : new Refusal()
  }

  private value(depth: number): unknown {
    if (depth > MAX_DEPTH) {
      throw this.fail()
    }
    this.skipTrivia()
    const char = this.source[this.at]
    if (char === '{') {
      return this.object(depth)
    }
    if (char === '[') {
      return this.array(depth)
    }
    if (char === "'" || char === '"' || char === '`') {
      return this.string(char)
    }
    return this.bare()
  }

  private object(depth: number): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    this.at += 1
    try {
      for (;;) {
        this.skipTrivia()
        if (this.take('}')) {
          return result
        }
        const key = this.key()
        this.skipTrivia()
        this.expect(':')
        // Own keys only: a `__proto__` key must land as data, not as a prototype.
        Object.defineProperty(result, key, {
          value: this.value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true
        })
        this.skipTrivia()
        if (!this.take(',')) {
          this.skipTrivia()
          this.expect('}')
          return result
        }
      }
    } catch (error) {
      return this.keepWhatWasRead(error, result)
    }
  }

  private array(depth: number): unknown[] {
    const result: unknown[] = []
    this.at += 1
    try {
      for (;;) {
        this.skipTrivia()
        if (this.take(']')) {
          return result
        }
        result.push(this.value(depth + 1))
        this.skipTrivia()
        if (!this.take(',')) {
          this.skipTrivia()
          this.expect(']')
          return result
        }
      }
    } catch (error) {
      return this.keepWhatWasRead(error, result)
    }
  }

  /** A literal the wire cut: what was read whole so far. Any other failure,
   *  and any end of input in a script that was not cut, refuses. */
  private keepWhatWasRead<T>(error: unknown, partial: T): T {
    if (this.cut && error instanceof EndOfInput) {
      return partial
    }
    throw error
  }

  private key(): string {
    const char = this.source[this.at]
    if (char === "'" || char === '"') {
      return this.string(char)
    }
    return this.match(IDENTIFIER)
  }

  private bare(): unknown {
    const rest = this.source.slice(this.at, this.at + 6)
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null]
    ] as const) {
      if (rest.startsWith(word) && !/[\w$]/.test(rest[word.length] ?? '')) {
        this.at += word.length
        return value
      }
    }
    return Number(this.match(NUMBER))
  }

  private string(quote: string): string {
    this.at += 1
    let text = ''
    for (;;) {
      const char = this.source[this.at]
      if (char === undefined) {
        throw this.fail()
      }
      this.at += 1
      if (char === quote) {
        return text
      }
      if (quote !== '`' && char === '\n') {
        throw this.fail()
      }
      if (quote === '`' && char === '$' && this.source[this.at] === '{') {
        throw this.fail()
      }
      text += char === '\\' ? this.escape() : char
    }
  }

  private escape(): string {
    const char = this.source[this.at]
    if (char === undefined) {
      throw this.fail()
    }
    this.at += 1
    if (char === 'u' || char === 'x') {
      const width = char === 'u' ? 4 : 2
      const digits = this.source.slice(this.at, this.at + width)
      if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(digits)) {
        throw this.fail()
      }
      this.at += width
      return String.fromCharCode(Number.parseInt(digits, 16))
    }
    if (char === '\n') {
      return ''
    }
    return SIMPLE_ESCAPES[char] ?? char
  }

  private skipTrivia(): void {
    for (;;) {
      const char = this.source[this.at]
      if (char !== undefined && /\s/.test(char)) {
        this.at += 1
      } else if (this.source.startsWith('//', this.at)) {
        const end = this.source.indexOf('\n', this.at)
        this.at = end === -1 ? this.source.length : end + 1
      } else if (this.source.startsWith('/*', this.at)) {
        const end = this.source.indexOf('*/', this.at + 2)
        if (end === -1) {
          throw this.fail()
        }
        this.at = end + 2
      } else {
        return
      }
    }
  }

  private take(char: string): boolean {
    if (this.source[this.at] === char) {
      this.at += 1
      return true
    }
    return false
  }

  private expect(char: string): void {
    if (!this.take(char)) {
      throw this.fail()
    }
  }

  private match(pattern: RegExp): string {
    pattern.lastIndex = this.at
    const found = pattern.exec(this.source)
    if (!found) {
      throw this.fail()
    }
    this.at += found[0].length
    return found[0]
  }
}
