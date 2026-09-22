import { describe, expect, it } from 'vitest'
import { formatSpeechModelSize } from './speech-model-size'

describe('speech model size on the voice list', () => {
  it('labels a model bigger than a gigabyte in GB', () => {
    // 2,583,085,056 bytes used to print as "2583 MB".
    expect(formatSpeechModelSize(2_583_085_056)).toBe('2.6 GB')
  })

  it('keeps a model under a gigabyte in whole MB', () => {
    expect(formatSpeechModelSize(600_000_000)).toBe('600 MB')
    expect(formatSpeechModelSize(999_000_000)).toBe('999 MB')
  })

  it('labels an exact gigabyte as 1 GB, and a gigabyte and a half as 1.5 GB', () => {
    expect(formatSpeechModelSize(1_000_000_000)).toBe('1 GB')
    expect(formatSpeechModelSize(2_000_000_000)).toBe('2 GB')
    expect(formatSpeechModelSize(1_040_000_000)).toBe('1 GB')
    expect(formatSpeechModelSize(1_500_000_000)).toBe('1.5 GB')
    expect(formatSpeechModelSize(1_000_000_000)).not.toContain('.0')
  })

  it('shows nothing when the catalog has no size', () => {
    expect(formatSpeechModelSize(null)).toBe('')
    expect(formatSpeechModelSize(undefined)).toBe('')
    expect(formatSpeechModelSize(0)).toBe('')
  })
})
