import { describe, expect, it } from 'vitest'
import { capToolDetailOutput } from './mobile-native-chat-tool-detail-sections'

// A failed call's sheet showed Claude Code's raw wrapper:
// "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>".
// The Claude app unwraps it before display (1.261013.20, `u5a.i`:
// `<tool_use_error[^>]*>([\s\S]*?)</tool_use_error>` → its text).

describe('a failed call’s error in the tool sheet', () => {
  it('shows the error’s words without the <tool_use_error> tags', () => {
    expect(
      capToolDetailOutput('<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>').text
    ).toBe('File has not been read yet. Read it first before writing to it.')
  })

  it('unwraps a tag with attributes and keeps a multi-line error whole', () => {
    expect(capToolDetailOutput('<tool_use_error code="x">line one\nline two</tool_use_error>')).toEqual({
      text: 'line one\nline two',
      hiddenLines: 0
    })
  })

  it('leaves output with no wrapper, and an empty one, as it was', () => {
    expect(capToolDetailOutput('exit 1').text).toBe('exit 1')
    expect(capToolDetailOutput('').text).toBe('')
    expect(capToolDetailOutput('<tool_use_error></tool_use_error>').text).toBe('')
  })
})
