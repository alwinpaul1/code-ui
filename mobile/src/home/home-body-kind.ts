export type HomeBodyKind = 'loading' | 'pair' | 'hosts' | 'failed'

// Why: the host catalog reads device storage and the Keychain, so on the first
// render it is EMPTY because it has not arrived, not because nothing is paired.
// Reading that empty list as "no hosts" drew "Connect your desktop" over a
// paired phone for a moment on every launch (reported 2026-09-29). Only a
// finished read may say the phone has no desktop.
//
// Why `readFailed`: a read that rejected or passed its cap also leaves the list
// empty, and it says nothing about what is paired either. Drawn as "none", it
// told a phone with a locked Keychain to pair desktops it still had. So "none"
// is only for a read that SUCCEEDED with no host; a failed read with no list to
// keep says so, and a failed re-read keeps the list it already drew.
export function homeBodyKind(
  catalogLoaded: boolean,
  hostCount: number,
  readFailed: boolean
): HomeBodyKind {
  if (!catalogLoaded) {
    return 'loading'
  }
  if (hostCount > 0) {
    return 'hosts'
  }
  return readFailed ? 'failed' : 'pair'
}
