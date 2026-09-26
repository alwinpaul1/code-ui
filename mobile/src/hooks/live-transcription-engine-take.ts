import type { ExpoSpeechRecognitionOptions } from 'expo-speech-recognition'
import { DICTATION_SILENCE_STOP_MS } from './mobile-live-transcript'
import {
  chooseSpeechService,
  readSpeechServices,
  shouldRetryOnSystemDefault,
  type PinnedTake
} from '../dictation/speech-recognition-service'

type ServiceLister = Parameters<typeof readSpeechServices>[0]

function logDictation(message: string): void {
  console.log(`[dictation] ${message}`)
}

export function liveTranscriptionStartOptions(
  lang: string,
  servicePackage: string | null
): ExpoSpeechRecognitionOptions {
  return {
    lang,
    interimResults: true,
    continuous: true,
    maxAlternatives: 1,
    addsPunctuation: true,
    volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
    // Hold-to-talk: never stop on a pause; the release stops it.
    androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: DICTATION_SILENCE_STOP_MS },
    // Only when pinned: a phone on its default engine starts exactly as before.
    ...(servicePackage ? { androidRecognitionServicePackage: servicePackage } : {})
  }
}

export type EngineTake = {
  /** Picks the engine for a new take, logs it, and returns its start options. */
  begin: (lang: string) => ExpoSpeechRecognitionOptions
  heardWords: () => void
  /** The user, the silence timer or leaving the screen ended the take. */
  ending: () => void
  /** True when this error is absorbed because the take will retry on the
   *  phone's default engine once the failed attempt ends. */
  absorbsError: (error: string, message: string) => boolean
  /** Start options for the retry a failed engine owes, or null. Consumes it. */
  takeRetry: () => ExpoSpeechRecognitionOptions | null
  /** True for an `end` the failed attempt still owes after its retry began:
   *  the library posts one per error it reports (review of 5c7643bd: the
   *  second ended the retry's take and left its mic open, unstoppable). */
  swallowsStaleEnd: () => boolean
}

/**
 * One per mounted recognizer. An engine that failed to start stays skipped
 * while the screen is mounted, so each take does not pay for the same failed
 * bind again.
 */
export function createEngineTake(recognizer: ServiceLister): EngineTake {
  const failed = new Set<string>()
  let take: PinnedTake & { retryPending: boolean; absorbed: number; staleEnds: number; defaultPackage: string; lang: string } = {
    servicePackage: null,
    heardWords: false,
    stopping: false,
    retryPending: false,
    absorbed: 0,
    staleEnds: 0,
    defaultPackage: '',
    lang: ''
  }
  const phoneDefault = () => take.defaultPackage || '(none set)'
  return {
    begin(lang) {
      const listing = readSpeechServices(recognizer)
      const servicePackage = chooseSpeechService(listing, failed)
      take = {
        servicePackage,
        heardWords: false,
        stopping: false,
        retryPending: false,
        absorbed: 0,
        staleEnds: 0,
        defaultPackage: listing.defaultPackage,
        lang
      }
      logDictation(
        servicePackage
          ? `engine ${servicePackage} (phone default ${phoneDefault()})`
          : `engine: phone default ${phoneDefault()}`
      )
      return liveTranscriptionStartOptions(lang, servicePackage)
    },
    heardWords() {
      take.heardWords = true
    },
    ending() {
      take.stopping = true
      take.retryPending = false
    },
    absorbsError(error, message) {
      if (take.retryPending) {
        // The same failed attempt reporting again: it will post another end.
        take.absorbed += 1
        return true
      }
      if (take.servicePackage === null || !shouldRetryOnSystemDefault(take, error, message)) {
        return false
      }
      failed.add(take.servicePackage)
      take.retryPending = true
      take.absorbed = 1
      logDictation(
        `${take.servicePackage} failed before it heard a word (${error}: ${message}); ` +
          `retrying on the phone default ${phoneDefault()}`
      )
      return true
    },
    takeRetry() {
      if (!take.retryPending) {
        return null
      }
      take.retryPending = false
      take.servicePackage = null
      take.staleEnds = take.absorbed - 1
      take.absorbed = 0
      return liveTranscriptionStartOptions(take.lang, null)
    },
    swallowsStaleEnd() {
      if (take.staleEnds <= 0) {
        return false
      }
      take.staleEnds -= 1
      return true
    }
  }
}
