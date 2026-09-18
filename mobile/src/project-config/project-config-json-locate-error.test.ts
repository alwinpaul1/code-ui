import { describe, expect, it } from 'vitest'
import { locateJsonError } from './project-config-json-locate-error'

describe('locating a JSON syntax error engine-independently', () => {
  it('returns null for valid JSON, including nested structures', () => {
    expect(locateJsonError('{"mcpServers":{"a":{"command":"npx","args":["x"]}}}')).toBeNull()
  })

  it('returns null for the degenerate empty object', () => {
    expect(locateJsonError('{}')).toBeNull()
  })

  it('returns null for whitespace-padded JSON', () => {
    expect(locateJsonError('  \n  { "a": 1 }  \n')).toBeNull()
  })

  it('treats a whitespace-only file as invalid, not as an empty object', () => {
    const result = locateJsonError('   \n\t  ')
    expect(result).not.toBeNull()
    expect(result?.message).toMatch(/unexpected end of input/i)
  })

  it('treats a genuinely empty file as invalid', () => {
    const result = locateJsonError('')
    expect(result).not.toBeNull()
  })

  it('finds a trailing comma before the closing brace, on its own line', () => {
    const source = '{\n  "permissions": {\n    "allow": ["Read"],\n  }\n}'
    const result = locateJsonError(source)
    expect(result).not.toBeNull()
    // Line 4 is the "}" that follows the stray comma.
    expect(result?.line).toBe(4)
  })

  it('finds a raw newline inside a string (a JSON string may not contain one unescaped)', () => {
    const source = '{\n  "name": "unterminated\n}'
    const result = locateJsonError(source)
    expect(result).not.toBeNull()
    expect(result?.line).toBe(2)
    expect(result?.message).toMatch(/unescaped control character/i)
  })

  it('finds a string left open at end of input', () => {
    const source = '{\n  "name": "unterminated'
    const result = locateJsonError(source)
    expect(result).not.toBeNull()
    expect(result?.line).toBe(2)
    expect(result?.message).toMatch(/unterminated string/i)
  })

  it('finds a missing colon after a property name', () => {
    const source = '{"a" 1}'
    const result = locateJsonError(source)
    expect(result).not.toBeNull()
    expect(result?.column).toBe(6)
  })

  it('finds trailing content after an otherwise-valid value', () => {
    const result = locateJsonError('{}{}')
    expect(result).not.toBeNull()
    expect(result?.message).toMatch(/trailing content/i)
  })

  it('rejects a bare unquoted token instead of throwing', () => {
    const result = locateJsonError('{"a": undefined}')
    expect(result).not.toBeNull()
  })
})
