/**
 * Which Android speech engine the phone recognizer binds to.
 *
 * Android's default `SpeechRecognizer` is whatever the phone names as its voice
 * recognition service. On Samsung phones that is often Samsung's own, which
 * transcribes worse than the Google engine Gboard's voice typing uses (asked for
 * 2026-09-26). So a take pins Google's engine when the phone has one and the
 * default is not already Google's, and falls back to the default when Google's
 * is missing or fails to start.
 *
 * expo-speech-recognition 3.1.3 takes a package, not a component: it resolves
 * the package to the first `android.speech.RecognitionService` it declares and
 * passes that to `SpeechRecognizer.createSpeechRecognizer(context, component)`.
 * For the Google app that is expected to be
 * `com.google.android.voicesearch.serviceapi.GoogleRecognitionService`; the
 * library logs the one it bound under the `ExpoSpeechService` logcat tag. Its
 * config plugin already adds the `<queries>` entry for that intent, so every
 * installed engine is visible without a manifest change. Not yet verified on a
 * device (2026-09-26).
 */

/** Google's engines, best first: the Google app's recognition service, then
 *  Speech Services by Google (the on-device engine newer phones carry). */
export const GOOGLE_SPEECH_SERVICES = [
  'com.google.android.googlequicksearchbox',
  'com.google.android.tts'
] as const

export type SpeechServiceListing = {
  /** Packages that expose a RecognitionService, as the phone lists them. */
  listed: readonly string[]
  /** The phone's default voice recognition package; '' when none is set. */
  defaultPackage: string
}

function isGoogleSpeechService(servicePackage: string): boolean {
  return (GOOGLE_SPEECH_SERVICES as readonly string[]).includes(servicePackage)
}

/**
 * The package to pin for this take, or null to let Android use its default.
 * A phone that already defaults to a Google engine is left alone, and so is
 * one with no Google engine, or whose Google engines have failed to start.
 */
export function chooseSpeechService(
  listing: SpeechServiceListing,
  failed: ReadonlySet<string>
): string | null {
  if (isGoogleSpeechService(listing.defaultPackage)) {
    return null
  }
  for (const servicePackage of GOOGLE_SPEECH_SERVICES) {
    if (listing.listed.includes(servicePackage) && !failed.has(servicePackage)) {
      return servicePackage
    }
  }
  return null
}

/** Errors that say nothing about whether the pinned engine works: our own
 *  cancel, a quiet room, the app's own missing mic permission, a call. */
const NOT_THE_ENGINES_FAULT = new Set(['aborted', 'no-speech', 'speech-timeout', 'not-allowed', 'interrupted'])

export type PinnedTake = {
  /** The pinned package, or null when the take runs on the default engine. */
  servicePackage: string | null
  /** A partial or final result arrived, so words are already on screen. */
  heardWords: boolean
  /** The user (or the silence timer, or leaving the screen) ended the take. */
  stopping: boolean
}

/**
 * A pinned engine that fails before it heard a word gets one retry on the
 * phone's default. That covers a bind that never happened (ERROR_CLIENT), the
 * library not finding the service (sent as `audio-capture`), a service that
 * crashed or will not take the language, and one that reports ready and then
 * refuses the audio. Once words were heard a retry would drop or repeat them,
 * so the error is shown as it always was.
 */
export function shouldRetryOnSystemDefault(take: PinnedTake, error: string): boolean {
  return take.servicePackage !== null && !take.heardWords && !take.stopping && !NOT_THE_ENGINES_FAULT.has(error)
}

type ServiceLister = {
  getSpeechRecognitionServices?: () => string[]
  getDefaultRecognitionService?: () => { packageName: string }
}

/** Reads the installed engines. Fails open: a listing that throws or is not
 *  there (iOS, web, a test stub) reads as none, which keeps the default. */
export function readSpeechServices(recognizer: ServiceLister): SpeechServiceListing {
  let listed: readonly string[] = []
  let defaultPackage = ''
  try {
    listed = recognizer.getSpeechRecognitionServices?.() ?? []
  } catch {
    listed = []
  }
  try {
    defaultPackage = recognizer.getDefaultRecognitionService?.().packageName ?? ''
  } catch {
    defaultPackage = ''
  }
  return { listed, defaultPackage }
}
