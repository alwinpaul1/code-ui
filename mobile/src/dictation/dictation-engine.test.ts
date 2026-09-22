import { describe, expect, it } from 'vitest'
import { chooseDictationEngine } from './dictation-engine'

describe('speech to text while the mic is open', () => {
  it('uses the phone recognizer so words appear while you speak', () => {
    expect(chooseDictationEngine(true)).toBe('live')
  })

  it('uses the desktop when the phone has no recognizer', () => {
    expect(chooseDictationEngine(false)).toBe('desktop')
  })
})
