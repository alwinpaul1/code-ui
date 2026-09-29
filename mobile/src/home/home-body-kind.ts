export type HomeBodyKind = 'loading' | 'pair' | 'hosts'

// Why: the host catalog reads device storage and the Keychain, so on the first
// render it is EMPTY because it has not arrived, not because nothing is paired.
// Reading that empty list as "no hosts" drew "Connect your desktop" over a
// paired phone for a moment on every launch (reported 2026-09-29). Only a
// finished read may say the phone has no desktop.
export function homeBodyKind(catalogLoaded: boolean, hostCount: number): HomeBodyKind {
  if (!catalogLoaded) {
    return 'loading'
  }
  return hostCount === 0 ? 'pair' : 'hosts'
}
