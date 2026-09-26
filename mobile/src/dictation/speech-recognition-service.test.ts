import { describe, expect, it } from 'vitest'
import {
  chooseSpeechService,
  GOOGLE_SPEECH_SERVICES,
  readSpeechServices,
  shouldRetryOnSystemDefault
} from './speech-recognition-service'

// Package names as expo-speech-recognition 3.1.3 documents them for
// getSpeechRecognitionServices(). Not captured from the S23 Ultra itself
// (no adb in this pass); the phone's real list is the device check.
const GOOGLE_APP = 'com.google.android.googlequicksearchbox'
const GOOGLE_SPEECH = 'com.google.android.tts'
const SAMSUNG = 'com.samsung.android.bixby.agent'
const NONE_FAILED: ReadonlySet<string> = new Set()

describe("which phone speech engine dictation listens with", () => {
  it("dictates with Google's engine on a Samsung phone whose default is Samsung's", () => {
    expect(
      chooseSpeechService({ listed: [SAMSUNG, GOOGLE_APP], defaultPackage: SAMSUNG }, NONE_FAILED)
    ).toBe(GOOGLE_APP)
  })

  it("keeps the phone's default engine when no Google engine is installed", () => {
    expect(chooseSpeechService({ listed: [SAMSUNG], defaultPackage: SAMSUNG }, NONE_FAILED)).toBeNull()
  })

  it('keeps the default engine when the phone lists no engines at all', () => {
    expect(chooseSpeechService({ listed: [], defaultPackage: '' }, NONE_FAILED)).toBeNull()
  })

  it("leaves a phone that already defaults to a Google engine exactly as it was", () => {
    expect(
      chooseSpeechService({ listed: [GOOGLE_APP, GOOGLE_SPEECH], defaultPackage: GOOGLE_SPEECH }, NONE_FAILED)
    ).toBeNull()
    expect(
      chooseSpeechService({ listed: [GOOGLE_APP], defaultPackage: GOOGLE_APP }, NONE_FAILED)
    ).toBeNull()
  })

  it('prefers the Google app over Speech Services by Google when both are listed', () => {
    expect(GOOGLE_SPEECH_SERVICES[0]).toBe(GOOGLE_APP)
    expect(
      chooseSpeechService({ listed: [GOOGLE_SPEECH, SAMSUNG, GOOGLE_APP], defaultPackage: SAMSUNG }, NONE_FAILED)
    ).toBe(GOOGLE_APP)
  })

  it('uses Speech Services by Google when the Google app is missing or disabled', () => {
    expect(
      chooseSpeechService({ listed: [SAMSUNG, GOOGLE_SPEECH], defaultPackage: SAMSUNG }, NONE_FAILED)
    ).toBe(GOOGLE_SPEECH)
  })

  it("goes back to the phone's default once Google's engine has failed to start", () => {
    expect(
      chooseSpeechService({ listed: [SAMSUNG, GOOGLE_APP], defaultPackage: SAMSUNG }, new Set([GOOGLE_APP]))
    ).toBeNull()
    expect(
      chooseSpeechService(
        { listed: [SAMSUNG, GOOGLE_APP, GOOGLE_SPEECH], defaultPackage: SAMSUNG },
        new Set([GOOGLE_APP])
      )
    ).toBe(GOOGLE_SPEECH)
  })
})

describe("when Google's engine fails to start", () => {
  const pinnedTake = { servicePackage: GOOGLE_APP, heardWords: false, stopping: false }

  it("retries on the phone's default engine when it fails before hearing a word", () => {
    // ERROR_CLIENT (bind failed), the library's own "no service found" (sent as
    // audio-capture), a crashed service, a language it will not take.
    for (const error of ['client', 'audio-capture', 'network', 'language-not-supported', 'busy', 'unknown']) {
      expect(shouldRetryOnSystemDefault(pinnedTake, error)).toBe(true)
    }
  })

  it('does not retry the default engine, which has nothing left to fall back to', () => {
    expect(shouldRetryOnSystemDefault({ ...pinnedTake, servicePackage: null }, 'client')).toBe(false)
  })

  it('does not retry once words were heard, so nothing spoken is dropped or repeated', () => {
    expect(shouldRetryOnSystemDefault({ ...pinnedTake, heardWords: true }, 'network')).toBe(false)
  })

  it('does not retry after the user stopped the take', () => {
    expect(shouldRetryOnSystemDefault({ ...pinnedTake, stopping: true }, 'client')).toBe(false)
  })

  it('does not retry a cancel, a quiet room, or a missing microphone permission', () => {
    for (const error of ['aborted', 'no-speech', 'speech-timeout', 'not-allowed', 'interrupted']) {
      expect(shouldRetryOnSystemDefault(pinnedTake, error)).toBe(false)
    }
  })
})

describe('reading the installed engines', () => {
  it('reads the listed services and the default package', () => {
    expect(
      readSpeechServices({
        getSpeechRecognitionServices: () => [SAMSUNG, GOOGLE_APP],
        getDefaultRecognitionService: () => ({ packageName: SAMSUNG })
      })
    ).toEqual({ listed: [SAMSUNG, GOOGLE_APP], defaultPackage: SAMSUNG })
  })

  it('reads nothing, and so keeps the default engine, when the listing throws', () => {
    const listing = readSpeechServices({
      getSpeechRecognitionServices: () => {
        throw new Error('package manager gone')
      },
      getDefaultRecognitionService: () => ({ packageName: SAMSUNG })
    })
    expect(listing).toEqual({ listed: [], defaultPackage: SAMSUNG })
    expect(chooseSpeechService(listing, NONE_FAILED)).toBeNull()
  })

  it('reads nothing on a recognizer without the Android listing calls', () => {
    expect(readSpeechServices({})).toEqual({ listed: [], defaultPackage: '' })
  })
})
