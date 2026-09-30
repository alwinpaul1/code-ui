// A Codex code-mode `exec` cell (Codex 0.153.4) is JavaScript source that
// calls one tool, as Codex writes it:
//
//   text(await tools.exec_command({cmd:"sleep 90",yield_time_ms:1000}));
//
// Its argument object used to be matched as `{[^{}]*}`, so a brace anywhere
// in it failed the match: an awk program (`awk '{print $1}'`), a shell
// `${VAR}`, a JSON body, a nested `env: {}`. The start went unread and a poll
// of it counted as a second command (review, 2026-09-30). The object is now
// scanned: string literals skipped whole, with their escapes, and brackets
// balanced. Only a cell that is exactly one such call is read. Anything the
// scan cannot vouch for (an unterminated string, unbalanced brackets, a
// comment, a template literal that interpolates, a second statement) reads as
// no call at all, so it counts the way it always did.

/** The call one cell makes: the tool, and its argument object's top-level
 *  entries, each key with its value's source text. `props` is null when an
 *  entry is not a written-out `key: value` (a spread, a shorthand), so no key
 *  can be said to be absent. */
export type CodeModeCall = { tool: string; props: ReadonlyMap<string, string> | null }

const CALL_HEAD = /^\s*(text\(\s*)?await\s+tools\.(exec_command|write_stdin)\(\s*(?=\{)/
/** After the object: the tool call's `)`, then the `text(` wrapper's own `)`
 *  when it has one, and at most a `;`. */
const TAIL_WRAPPED = /^\s*\)\s*\)\s*;?\s*$/
const TAIL_BARE = /^\s*\)\s*;?\s*$/
const CLOSER: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
const QUOTES = new Set(['"', "'", '`'])
/** `key: value`, the key an identifier or a plain quoted name. */
const ENTRY = /^(?:([A-Za-z_$][\w$]*)|"([^"\\]*)"|'([^'\\]*)')\s*:([\s\S]*)$/

/** Scans the object that opens at `start`: where it ends, and the source of
 *  each of its top-level entries. Null when the scan cannot be sure of
 *  either. */
function scanObject(source: string, start: number): { end: number; entries: string[] } | null {
  const closers: string[] = []
  const entries: string[] = []
  let entryStart = start + 1
  let quote: string | null = null
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!
    if (quote !== null) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        quote = null
      } else if (quote === '`' && ch === '$' && source[i + 1] === '{') {
        return null
      }
      continue
    }
    const closer = CLOSER[ch]
    if (QUOTES.has(ch)) {
      quote = ch
    } else if (ch === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      return null
    } else if (closer) {
      closers.push(closer)
    } else if (ch === '}' || ch === ']' || ch === ')') {
      if (closers.pop() !== ch) {
        return null
      }
      if (closers.length === 0) {
        entries.push(source.slice(entryStart, i))
        return { end: i + 1, entries }
      }
    } else if (ch === ',' && closers.length === 1) {
      entries.push(source.slice(entryStart, i))
      entryStart = i + 1
    }
  }
  return null
}

/** The top-level entries as keys and value sources, the last of a repeated
 *  key winning as it does in JavaScript. Null when one is not `key: value`;
 *  undefined when the object is not well formed (an empty entry that is not
 *  a trailing comma's). */
function entryProps(entries: readonly string[]): Map<string, string> | null | undefined {
  const props = new Map<string, string>()
  let written = true
  for (const [index, raw] of entries.entries()) {
    const entry = raw.trim()
    if (entry === '') {
      if (index === entries.length - 1) {
        continue
      }
      return undefined
    }
    const match = ENTRY.exec(entry)
    if (!match) {
      written = false
      continue
    }
    props.set(match[1] ?? match[2] ?? match[3]!, match[4]!.trim())
  }
  return written ? props : null
}

/** The one tool call a code-mode cell makes, or null when the cell is
 *  anything more or less than one `text(await tools.<name>({…}));`. */
export function readCodeModeCall(source: string): CodeModeCall | null {
  const head = CALL_HEAD.exec(source)
  if (!head) {
    return null
  }
  const scanned = scanObject(source, head[0].length)
  if (!scanned) {
    return null
  }
  const tail = source.slice(scanned.end)
  if (!(head[1] ? TAIL_WRAPPED : TAIL_BARE).test(tail)) {
    return null
  }
  const props = entryProps(scanned.entries)
  return props === undefined ? null : { tool: head[2]!, props }
}
