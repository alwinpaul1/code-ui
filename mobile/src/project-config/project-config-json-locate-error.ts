/**
 * Finds the line and column of the first JSON syntax error in a source
 * string, without trusting `JSON.parse`'s own error message.
 *
 * Why not just parse and read `error.message`: V8 (this repo's test runner,
 * and Chrome DevTools) writes `Unexpected token } in JSON at position 123`;
 * Hermes (what actually runs the app on an Android device) does not promise
 * the same text or even a position at all. A settings-file parse error that
 * only worked under `vitest` would be a defect this suite could never catch
 * — so this is a small hand-rolled scanner instead, one JSON grammar, same
 * answer on every engine.
 *
 * It is deliberately not a validator for anything beyond "where does this
 * stop being JSON": it does not check for duplicate keys, trailing data
 * shape, etc. — `permission-rules-parse.ts` and `mcp-config-parse.ts` do
 * their own shape checks once the text is known to parse.
 */
export type JsonLocateError = {
  line: number
  column: number
  message: string
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

function lineAndColumnAt(source: string, index: number): { line: number; column: number } {
  let line = 1
  let column = 1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

function fail(source: string, index: number, message: string): JsonLocateError {
  const { line, column } = lineAndColumnAt(source, index)
  return { line, column, message }
}

/** Returns null when `source` is valid JSON; otherwise the first point that
 *  is not. Never throws. */
export function locateJsonError(source: string): JsonLocateError | null {
  let i = 0
  const n = source.length

  function skipWhitespace(): void {
    while (i < n && WHITESPACE.has(source[i]!)) {
      i += 1
    }
  }

  function parseValue(): JsonLocateError | null {
    skipWhitespace()
    if (i >= n) {
      return fail(source, i, 'Unexpected end of input')
    }
    const c = source[i]!
    if (c === '{') {
      return parseObject()
    }
    if (c === '[') {
      return parseArray()
    }
    if (c === '"') {
      return parseString()
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      return parseNumber()
    }
    if (source.startsWith('true', i)) {
      i += 4
      return null
    }
    if (source.startsWith('false', i)) {
      i += 5
      return null
    }
    if (source.startsWith('null', i)) {
      i += 4
      return null
    }
    return fail(source, i, `Unexpected token '${c}'`)
  }

  function parseString(): JsonLocateError | null {
    const start = i
    i += 1 // opening quote
    while (true) {
      if (i >= n) {
        return fail(source, start, 'Unterminated string')
      }
      const c = source[i]!
      if (c === '"') {
        i += 1
        return null
      }
      if (c === '\\') {
        i += 1
        if (i >= n) {
          return fail(source, start, 'Unterminated string')
        }
        const escaped = source[i]!
        if (escaped === 'u') {
          const hex = source.slice(i + 1, i + 5)
          if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            return fail(source, i - 1, 'Invalid unicode escape')
          }
          i += 5
        } else if ('"\\/bfnrt'.includes(escaped)) {
          i += 1
        } else {
          return fail(source, i - 1, `Invalid escape '\\${escaped}'`)
        }
      } else if (c.charCodeAt(0) < 0x20) {
        return fail(source, i, 'Unescaped control character in string')
      } else {
        i += 1
      }
    }
  }

  function parseNumber(): JsonLocateError | null {
    const start = i
    if (source[i] === '-') {
      i += 1
    }
    if (i >= n || !(source[i]! >= '0' && source[i]! <= '9')) {
      return fail(source, start, 'Invalid number')
    }
    if (source[i] === '0') {
      i += 1
    } else {
      while (i < n && source[i]! >= '0' && source[i]! <= '9') {
        i += 1
      }
    }
    if (source[i] === '.') {
      i += 1
      if (i >= n || !(source[i]! >= '0' && source[i]! <= '9')) {
        return fail(source, start, 'Invalid number')
      }
      while (i < n && source[i]! >= '0' && source[i]! <= '9') {
        i += 1
      }
    }
    if (source[i] === 'e' || source[i] === 'E') {
      i += 1
      if (source[i] === '+' || source[i] === '-') {
        i += 1
      }
      if (i >= n || !(source[i]! >= '0' && source[i]! <= '9')) {
        return fail(source, start, 'Invalid number')
      }
      while (i < n && source[i]! >= '0' && source[i]! <= '9') {
        i += 1
      }
    }
    return null
  }

  function parseObject(): JsonLocateError | null {
    i += 1 // '{'
    skipWhitespace()
    if (source[i] === '}') {
      i += 1
      return null
    }
    while (true) {
      skipWhitespace()
      if (source[i] !== '"') {
        return fail(source, i, "Expected a property name in double quotes")
      }
      const keyError = parseString()
      if (keyError) {
        return keyError
      }
      skipWhitespace()
      if (source[i] !== ':') {
        return fail(source, i, "Expected ':' after property name")
      }
      i += 1
      const valueError = parseValue()
      if (valueError) {
        return valueError
      }
      skipWhitespace()
      if (source[i] === ',') {
        i += 1
        skipWhitespace()
        if (source[i] === '}') {
          return fail(source, i, "Trailing comma before '}'")
        }
        continue
      }
      if (source[i] === '}') {
        i += 1
        return null
      }
      return fail(source, i, "Expected ',' or '}'")
    }
  }

  function parseArray(): JsonLocateError | null {
    i += 1 // '['
    skipWhitespace()
    if (source[i] === ']') {
      i += 1
      return null
    }
    while (true) {
      const valueError = parseValue()
      if (valueError) {
        return valueError
      }
      skipWhitespace()
      if (source[i] === ',') {
        i += 1
        skipWhitespace()
        if (source[i] === ']') {
          return fail(source, i, "Trailing comma before ']'")
        }
        continue
      }
      if (source[i] === ']') {
        i += 1
        return null
      }
      return fail(source, i, "Expected ',' or ']'")
    }
  }

  const valueError = parseValue()
  if (valueError) {
    return valueError
  }
  skipWhitespace()
  if (i < n) {
    return fail(source, i, 'Unexpected trailing content after JSON value')
  }
  return null
}
