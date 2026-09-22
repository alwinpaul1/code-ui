export type DictationEngine = 'live' | 'desktop'

// The phone recognizer prints partials while you speak. Desktop dictation
// waits for a finished clip on the paired machine.
export function chooseDictationEngine(liveAvailable: boolean): DictationEngine {
  return liveAvailable ? 'live' : 'desktop'
}
