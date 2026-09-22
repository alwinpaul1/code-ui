import { describe, expect, it } from 'vitest'
import {
  applyLiveTranscript,
  composeLiveTranscript,
  joinDictationAtCursor,
  paintSpokenAtCursor
} from './mobile-live-transcript'

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

describe('dictation inserted at the caret', () => {
  it('puts the words where the caret is and leaves the rest of the draft', () => {
    expect(joinDictationAtCursor('hello', ' world', 'there')).toBe('hello there world')
    expect(joinDictationAtCursor('please ', '', 'fix the bug')).toBe('please fix the bug')
    expect(joinDictationAtCursor('', '', 'fix the bug')).toBe('fix the bug')
    expect(joinDictationAtCursor('keep', ' this', '')).toBe('keep this')
  })

  it('paints the open phrase lighter than the words already finished', () => {
    expect(paintSpokenAtCursor('hello', ' world', 'there', 'there')).toEqual({
      before: 'hello ',
      interim: 'there',
      after: ' world',
      text: 'hello there world'
    })
    expect(paintSpokenAtCursor('', '', 'hello there. how', 'how')).toEqual({
      before: 'hello there. ',
      interim: 'how',
      after: '',
      text: 'hello there. how'
    })
    expect(paintSpokenAtCursor('please ', '', 'fix the bug', '')).toEqual({
      before: 'please fix the bug',
      interim: '',
      after: '',
      text: 'please fix the bug'
    })
    expect(paintSpokenAtCursor('hello', '', 'there', 'missing')).toEqual({
      before: 'hello there',
      interim: '',
      after: '',
      text: 'hello there'
    })
  })
})
