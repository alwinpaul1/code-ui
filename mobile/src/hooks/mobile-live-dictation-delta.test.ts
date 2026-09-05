import { describe, expect, it } from 'vitest'
import { liveDictationDelta } from './mobile-live-dictation-delta'

describe('liveDictationDelta', () => {
  it('appends when the transcript only grows', () => {
    expect(liveDictationDelta('', 'fix the')).toBe('fix the')
    expect(liveDictationDelta('fix the', 'fix the bug')).toBe(' bug')
  })
  it('backspaces only the revised tail', () => {
    expect(liveDictationDelta('fix the bag', 'fix the bug')).toBe('\u007f\u007fug')
    expect(liveDictationDelta('hello', '')).toBe('\u007f'.repeat(5))
  })
  it('counts code points, not UTF-16 units', () => {
    expect(liveDictationDelta('go 😀', 'go 🚀')).toBe('\u007f🚀')
  })
})
