import { describe, expect, it } from 'vitest'
import { nativeChatDraftMirrorLine, planNativeChatDraftMirror } from './mobile-native-chat-draft-mirror'

const CTRL_U = '\x15'
const DEL = '\x7f'

describe('planNativeChatDraftMirror', () => {
  it('clears the line first, as its own write, when nothing is mirrored yet', () => {
    expect(planNativeChatDraftMirror('', 'fix')).toEqual({
      writes: [CTRL_U, 'fix'],
      nextSentText: 'fix'
    })
  })

  it('appends only the typed suffix', () => {
    expect(planNativeChatDraftMirror('fix', 'fix the')).toEqual({
      writes: [' the'],
      nextSentText: 'fix the'
    })
  })

  it('erases the changed suffix with DEL and retypes it', () => {
    // Common prefix is "fix th"; the rest is erased and retyped.
    expect(planNativeChatDraftMirror('fix the bug', 'fix that bug')).toEqual({
      writes: [`${DEL.repeat(5)}at bug`],
      nextSentText: 'fix that bug'
    })
  })

  it('erases everything when the draft is emptied, without a clear', () => {
    expect(planNativeChatDraftMirror('abc', '')).toEqual({
      writes: [DEL.repeat(3)],
      nextSentText: ''
    })
  })

  it('is a no-op when the line already matches', () => {
    expect(planNativeChatDraftMirror('same', 'same')).toEqual({ writes: [], nextSentText: 'same' })
    expect(planNativeChatDraftMirror('', '')).toEqual({ writes: [], nextSentText: '' })
  })

  it('flattens newlines so the mirror never occupies more than one TUI line', () => {
    expect(nativeChatDraftMirrorLine('a\nb\r\nc')).toBe('a b c')
    expect(planNativeChatDraftMirror('', 'a\nb')).toEqual({
      writes: [CTRL_U, 'a b'],
      nextSentText: 'a b'
    })
  })
})
