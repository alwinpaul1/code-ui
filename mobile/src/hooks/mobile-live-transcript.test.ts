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

  // The Claude app (1.261009.20, `ox20.e`): a space after the spoken words only when the next
  // character is neither whitespace nor one of ,.;:!?)]}. Dictating before "." or ")" left
  // "word ." in Code UI.
  it('puts no space between the spoken words and punctuation that follows the caret', () => {
    for (const mark of [',', '.', ';', ':', '!', '?', ')', ']', '}']) {
      expect(joinDictationAtCursor('fix the', `${mark} then ship`, 'login bug')).toBe(
        `fix the login bug${mark} then ship`
      )
    }
    expect(paintSpokenAtCursor('(see', ')', 'the logs', 'logs').text).toBe('(see the logs)')
    // Any other character still gets its space, as before.
    expect(joinDictationAtCursor('fix the', 'bug', 'login')).toBe('fix the login bug')
    expect(joinDictationAtCursor('fix the', '"bug"', 'login')).toBe('fix the login "bug"')
  })

  it('splits the open phrase from the finished words, and puts the caret after the spoken words', () => {
    expect(paintSpokenAtCursor('hello', ' world', 'there', 'there')).toEqual({
      before: 'hello ',
      interim: 'there',
      after: ' world',
      text: 'hello there world',
      caret: 'hello there'.length
    })
    expect(paintSpokenAtCursor('', '', 'hello there. how', 'how')).toEqual({
      before: 'hello there. ',
      interim: 'how',
      after: '',
      text: 'hello there. how',
      caret: 'hello there. how'.length
    })
    expect(paintSpokenAtCursor('please ', '', 'fix the bug', '')).toEqual({
      before: 'please fix the bug',
      interim: '',
      after: '',
      text: 'please fix the bug',
      caret: 'please fix the bug'.length
    })
    expect(paintSpokenAtCursor('hello', '', 'there', 'missing')).toEqual({
      before: 'hello there',
      interim: '',
      after: '',
      text: 'hello there',
      caret: 'hello there'.length
    })
  })
})
