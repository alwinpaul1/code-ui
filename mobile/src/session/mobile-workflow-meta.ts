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

const META_OPENING = /export\s+const\s+meta\s*=\s*/
const IDENTIFIER = /[A-Za-z_$][\w$]*/y
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }
/** Deep enough for any real meta, shallow enough that a hostile script cannot
 *  spend the stack. */
const MAX_DEPTH = 8

export function parseWorkflowMeta(script: string): WorkflowMeta | null {
  const opening = META_OPENING.exec(script)
  if (!opening) {
    return null
  }
  const reader = new LiteralReader(script, opening.index + opening[0].length)
  const value = reader.readValue(0)
  if (!isRecord(value)) {
    return null
  }
  return {
    name: nonEmptyString(value.name),
    description: nonEmptyString(value.description),
    phases: readPhases(value.phases)
  }
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

class LiteralReader {
  private at: number

  constructor(
    private readonly source: string,
    start: number
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

  private value(depth: number): unknown {
    if (depth > MAX_DEPTH) {
      throw new Refusal()
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
  }

  private array(depth: number): unknown[] {
    const result: unknown[] = []
    this.at += 1
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
        throw new Refusal()
      }
      this.at += 1
      if (char === quote) {
        return text
      }
      if (quote !== '`' && char === '\n') {
        throw new Refusal()
      }
      if (quote === '`' && char === '$' && this.source[this.at] === '{') {
        throw new Refusal()
      }
      text += char === '\\' ? this.escape() : char
    }
  }

  private escape(): string {
    const char = this.source[this.at]
    if (char === undefined) {
      throw new Refusal()
    }
    this.at += 1
    if (char === 'u' || char === 'x') {
      const width = char === 'u' ? 4 : 2
      const digits = this.source.slice(this.at, this.at + width)
      if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(digits)) {
        throw new Refusal()
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
          throw new Refusal()
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
      throw new Refusal()
    }
  }

  private match(pattern: RegExp): string {
    pattern.lastIndex = this.at
    const found = pattern.exec(this.source)
    if (!found) {
      throw new Refusal()
    }
    this.at += found[0].length
    return found[0]
  }
}
