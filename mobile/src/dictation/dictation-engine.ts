export type DictationEngine = 'live' | 'desktop' | 'anthropic'

// Anthropic's voice_stream gives the best transcript quality and live
// partials. The phone recognizer prints partials locally. Desktop dictation
// waits for a finished clip on the paired machine.
export function chooseDictationEngine(
  liveAvailable: boolean,
  anthropicAvailable: boolean = false
): DictationEngine {
  if (anthropicAvailable) {
    return 'anthropic'
  }
  return liveAvailable ? 'live' : 'desktop'
}
