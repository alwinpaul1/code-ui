/**
 * How deeply brackets nest at a line, without colouring the lines above it.
 *
 * A big file is coloured a chunk of lines at a time (mobile-code-document.ts),
 * and a chunk that started at depth zero drew every bracket after the first
 * chunk a colour off: the methods of a long class came out in the class's
 * colour. Colouring every chunk above the one on screen would cost what the
 * chunks exist to avoid, so this is a lexical pass instead: it counts
 * brackets and skips what the colourer skips, strings and comments (and
 * JavaScript's regex literals), by each language's delimiters. It is not a
 * tokenizer: where the highlighter calls other code a string (the braces of a
 * JSX attribute) or loses its own place, the chunks below can still be a
 * colour off. It runs once per document, a chunk at a time as the reader goes
 * down: 42 ms under Node for a 3.9 MB file read from the top to its end.
 */

type LexProfile = {
  /** Comments that run to the end of the line. */
  line: readonly string[]
  /** A line comment only after whitespace or at the start: the shell's `$#`
   *  and `${#name}` are not comments. */
  lineAfterSpace?: boolean
  /** Comments with an end, which may run over lines. Tried before `line`, so
   *  Lua's `--[[` is not read as `--`. */
  block: readonly (readonly [string, string])[]
  /** Strings that end with their line when nothing closes them. */
  quotes: string
  /** Strings that may run over lines (Python's `"""`, Go's backquote). */
  multi: readonly string[]
  /** `'` opens a character (`'x'`, `'\n'`) and is otherwise code: a Rust
   *  lifetime, a Swift or Kotlin apostrophe does not open a string. */
  charQuote?: boolean
  /** JavaScript's backquoted template, `${…}` included, and its regex
   *  literals: `/\[/` holds a bracket the tokenizer calls a string. */
  script?: boolean
}

const C_BLOCK = [['/*', '*/']] as const
const C_LIKE: LexProfile = { line: ['//'], block: C_BLOCK, quotes: '"', multi: [], charQuote: true }
const SCRIPT: LexProfile = { line: ['//'], block: C_BLOCK, quotes: `"'`, multi: [], script: true }
const HASH: LexProfile = { line: ['#'], block: [], quotes: `"'`, multi: [] }
const SHELL: LexProfile = { ...HASH, lineAfterSpace: true }
const STYLES: LexProfile = { line: ['//'], block: C_BLOCK, quotes: `"'`, multi: [] }
const PHP: LexProfile = { line: ['//', '#'], block: C_BLOCK, quotes: `"'`, multi: [] }
const MARKUP: LexProfile = { line: [], block: [['<!--', '-->']], quotes: '', multi: [] }
/** Anything else: only double-quoted strings are skipped. */
const DEFAULT_PROFILE: LexProfile = { line: [], block: [], quotes: '"', multi: [] }

const PROFILES: Record<string, LexProfile> = {
  arduino: C_LIKE,
  c: C_LIKE,
  cpp: C_LIKE,
  csharp: C_LIKE,
  java: C_LIKE,
  objectivec: C_LIKE,
  rust: C_LIKE,
  go: { ...C_LIKE, multi: ['`'] },
  kotlin: { ...C_LIKE, multi: ['"""'] },
  swift: { ...C_LIKE, multi: ['"""'] },
  javascript: SCRIPT,
  typescript: SCRIPT,
  php: PHP,
  'php-template': PHP,
  css: { ...STYLES, line: [] },
  scss: STYLES,
  less: STYLES,
  python: { ...HASH, multi: ['"""', "'''"] },
  'python-repl': { ...HASH, multi: ['"""', "'''"] },
  ruby: { ...HASH, block: [['=begin', '=end']] },
  perl: HASH,
  r: HASH,
  bash: SHELL,
  shell: SHELL,
  makefile: SHELL,
  yaml: SHELL,
  graphql: { line: ['#'], block: [], quotes: '"', multi: ['"""'] },
  sql: { line: ['--'], block: C_BLOCK, quotes: `"'`, multi: [] },
  lua: { line: ['--'], block: [['--[[', ']]']], quotes: `"'`, multi: [] },
  ini: { line: [';', '#'], block: [], quotes: '"', multi: [] },
  vbnet: { line: ["'"], block: [], quotes: '"', multi: [] },
  xml: MARKUP,
  markdown: MARKUP,
  json: DEFAULT_PROFILE
}

/** Where a scan stopped: the depth, and a comment or string it is inside. */
export type BracketScanState = {
  depth: number
  /** What ends the comment or string the scan is inside; null in code. */
  closing: string | null
  /** Open `${` levels inside a template, whose braces belong to it. */
  substitutions: number
}

export function startBracketScan(): BracketScanState {
  return { depth: 0, closing: null, substitutions: 0 }
}

/**
 * Runs the scan over `lines[from, to)`, from `state`, and returns where it
 * stops. A closer never takes the depth below zero, as in colorBracketPairs,
 * so a stray one cannot shift every chunk after it.
 */
export function scanBracketDepth(
  lines: readonly string[],
  from: number,
  to: number,
  language: string,
  state: BracketScanState
): BracketScanState {
  const profile = PROFILES[language] ?? DEFAULT_PROFILE
  const next = { ...state }
  for (let index = from; index < to; index += 1) {
    scanLine(lines[index] ?? '', profile, next)
  }
  return next
}

/** The characters that can start a comment, a string or a regex in each
 *  profile: every other character is skipped without a lookup. */
const triggersByProfile = new WeakMap<LexProfile, Set<string>>()

function triggersFor(profile: LexProfile): Set<string> {
  let triggers = triggersByProfile.get(profile)
  if (!triggers) {
    const starts = [...profile.line, ...profile.block.map(([open]) => open), ...profile.multi, ...profile.quotes]
    if (profile.script) {
      starts.push('/', '`')
    }
    if (profile.charQuote) {
      starts.push("'")
    }
    triggers = new Set(starts.map((start) => start[0]!))
    triggersByProfile.set(profile, triggers)
  }
  return triggers
}

function scanLine(line: string, profile: LexProfile, state: BracketScanState): void {
  const triggers = triggersFor(profile)
  let at = 0
  while (at < line.length) {
    if (state.closing !== null) {
      at = state.closing === '`' && profile.script ? skipTemplate(line, at, state) : skipTo(line, at, state)
      continue
    }
    const char = line[at]!
    if (char === '(' || char === '[' || char === '{') {
      state.depth += 1
      at += 1
      continue
    }
    if (char === ')' || char === ']' || char === '}') {
      state.depth = Math.max(0, state.depth - 1)
      at += 1
      continue
    }
    if (!triggers.has(char)) {
      at += 1
      continue
    }
    const block = profile.block.find(([open]) => line.startsWith(open, at))
    if (block) {
      state.closing = block[1]
      at += block[0].length
      continue
    }
    if (profile.line.some((start) => line.startsWith(start, at)) && (!profile.lineAfterSpace || at === 0 || /\s/.test(line[at - 1]!))) {
      return
    }
    const multi = profile.multi.find((delimiter) => line.startsWith(delimiter, at))
    if (multi) {
      state.closing = multi
      at += multi.length
      continue
    }
    if (char === '/' && profile.script && opensRegex(line, at)) {
      at = skipRegex(line, at)
      continue
    }
    if (char === '`' && profile.script) {
      state.closing = '`'
      state.substitutions = 0
      at += 1
      continue
    }
    if (char === "'" && profile.charQuote) {
      at = skipCharacter(line, at)
      continue
    }
    at = profile.quotes.includes(char) ? skipString(line, at + 1, char) : at + 1
  }
}

/** Past the end of the comment or multi-line string the scan is inside, or
 *  to the end of the line when it goes on. */
function skipTo(line: string, at: number, state: BracketScanState): number {
  const end = line.indexOf(state.closing!, at)
  if (end === -1) {
    return line.length
  }
  const past = end + state.closing!.length
  state.closing = null
  return past
}

function skipTemplate(line: string, at: number, state: BracketScanState): number {
  let index = at
  while (index < line.length) {
    const char = line[index]!
    if (char === '\\') {
      index += 2
    } else if (char === '`' && state.substitutions === 0) {
      state.closing = null
      return index + 1
    } else if (char === '$' && line[index + 1] === '{') {
      state.substitutions += 1
      index += 2
    } else if (char === '{' && state.substitutions > 0) {
      state.substitutions += 1
      index += 1
    } else if (char === '}' && state.substitutions > 0) {
      state.substitutions -= 1
      index += 1
    } else {
      index += 1
    }
  }
  return line.length
}

/** Whether a `/` here starts a regex rather than dividing: nothing before it
 *  on the line, or an operator, an opening bracket or a keyword that cannot
 *  end a value. The usual heuristic; a tokenizer knows better. */
function opensRegex(line: string, at: number): boolean {
  const before = line.slice(0, at).trimEnd()
  if (before.length === 0) {
    return true
  }
  return /[(,=:[!&|?{};+\-*%<>~^]$/.test(before) || /\b(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/.test(before)
}

/** Past a regex literal: a `/` inside `[…]` or after a backslash does not
 *  end it. One the line does not close was a division after all. */
function skipRegex(line: string, at: number): number {
  let inClass = false
  let index = at + 1
  while (index < line.length) {
    const char = line[index]!
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '[') {
      inClass = true
    } else if (char === ']') {
      inClass = false
    } else if (char === '/' && !inClass) {
      return index + 1
    }
    index += 1
  }
  return at + 1
}

/** Past a quoted string, escapes included; the line's end closes one left open. */
function skipString(line: string, at: number, quote: string): number {
  let index = at
  while (index < line.length) {
    const char = line[index]!
    if (char === '\\') {
      index += 2
    } else if (char === quote) {
      return index + 1
    } else {
      index += 1
    }
  }
  return line.length
}

/** Past `'x'` or `'\n'`; otherwise only past the quote, which is code. */
function skipCharacter(line: string, at: number): number {
  if (line[at + 1] === '\\') {
    // The escaped character is at + 2, and may itself be a quote: '\''.
    const end = line.indexOf("'", at + 3)
    return end === -1 ? at + 1 : end + 1
  }
  const width = (line.codePointAt(at + 1) ?? 0) > 0xffff ? 2 : 1
  return line[at + 1 + width] === "'" ? at + 2 + width : at + 1
}
