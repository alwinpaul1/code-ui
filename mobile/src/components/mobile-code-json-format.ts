/** Past this a file is not reformatted: the pass is linear, but a document
 *  this size is not something to re-lay on a phone's JS thread. */
const MAX_JSON_FORMAT_CHARS = 4_000_000
const INDENT = '  '

/**
 * A minified JSON document laid out one value per line, for reading. Null
 * when the file should be shown as it is: it already has line breaks, it does
 * not parse (JSONC comments, a truncated read), or it is a bare value or an
 * empty container that has nothing to lay out.
 *
 * Only whitespace changes. Values are copied from the source text, never
 * parsed and re-printed, since JSON.stringify would round a big number,
 * decode an escape and drop a duplicate key — and a reader must not change
 * what the file says. JSON.parse is only the gate that says it is JSON.
 *
 * Two spaces an indent: a phone is narrow, and the guides follow the step.
 */
export function formatMinifiedJsonForReading(content: string): string | null {
  const text = content.trim()
  if (text.length < 2 || text.length > MAX_JSON_FORMAT_CHARS || /[\r\n]/.test(text)) {
    return null
  }
  if (text[0] !== '{' && text[0] !== '[') {
    return null
  }
  try {
    JSON.parse(text)
  } catch {
    return null
  }
  const laidOut = layOutJson(text)
  return laidOut === text ? null : laidOut
}

function layOutJson(text: string): string {
  const out: string[] = []
  let depth = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    if (char === '"') {
      const end = endOfString(text, index)
      out.push(text.slice(index, end))
      index = end
      continue
    }
    if (char === '{' || char === '[') {
      const next = skipSpace(text, index + 1)
      if (text[next] === (char === '{' ? '}' : ']')) {
        out.push(char, text[next]!)
        index = next + 1
        continue
      }
      depth += 1
      out.push(char, '\n', INDENT.repeat(depth))
    } else if (char === '}' || char === ']') {
      depth -= 1
      out.push('\n', INDENT.repeat(depth), char)
    } else if (char === ',') {
      out.push(',\n', INDENT.repeat(depth))
    } else if (char === ':') {
      out.push(': ')
    } else if (!isSpace(char)) {
      // A number or a literal: copy the whole run as written.
      const end = endOfBareValue(text, index)
      out.push(text.slice(index, end))
      index = end
      continue
    }
    index += 1
  }
  return out.join('')
}

/** Index just past the closing quote of the string that opens at `start`. */
function endOfString(text: string, start: number): number {
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') {
      return index + 1
    }
    index += 1
  }
  return text.length
}

function endOfBareValue(text: string, start: number): number {
  let index = start
  while (index < text.length && !/[\s,:[\]{}"]/.test(text[index]!)) {
    index += 1
  }
  return index
}

function skipSpace(text: string, start: number): number {
  let index = start
  while (index < text.length && isSpace(text[index]!)) {
    index += 1
  }
  return index
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}
