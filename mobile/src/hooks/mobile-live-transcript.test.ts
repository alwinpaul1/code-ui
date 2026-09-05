import { describe, expect, it } from 'vitest'
import { applyLiveTranscript, composeLiveTranscript } from './mobile-live-transcript'

describe('live transcript', () => {
  it('joins closed segments with the open one', () => {
    expect(composeLiveTranscript([], 'hel')).toBe('hel')
    expect(composeLiveTranscript(['hello there.'], 'how are')).toBe('hello there. how are')
    expect(composeLiveTranscript(['a', ''], '  ')).toBe('a')
  })

  it('keeps the text that was in the composer and appends the live words', () => {
    expect(applyLiveTranscript('', 'fix the bug')).toBe('fix the bug')
    expect(applyLiveTranscript('please ', 'fix the bug')).toBe('please fix the bug')
    expect(applyLiveTranscript('please', '')).toBe('please')
  })
})
