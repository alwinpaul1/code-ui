import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the voice speech-model sheet', () => {
  it('does not offer Gemma', () => {
    const settings = readFileSync(new URL('../../app/voice-settings.tsx', import.meta.url), 'utf8')
    const session = readFileSync(
      new URL('../session/use-mobile-session-native-chat-dictation.ts', import.meta.url),
      'utf8'
    )
    expect(settings.toLowerCase()).not.toContain('gemma')
    expect(session.toLowerCase()).not.toContain('gemma')
  })
})
