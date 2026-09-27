import type { ConnectionState, ForegroundNudgeReason } from './types'

// Why: a dial older than this predates the revival signal, so it was opened over a
// network path that may no longer exist. Younger dials belong to the current
// foreground session — AppState 'active' and a Wi-Fi→cellular change fire back to
// back, and both reach the same nudge, so this also keeps them from churning it.
const STALE_DIAL_AGE_MS = 2_000

// A phone suspended mid-dial resumes still holding that socket, and React Native
// keeps its readyState at CONNECTING because no close event was ever delivered.
// Treating 'connecting'/'handshaking' as progress worth waiting out left the user
// on the rest of the 12s connect budget over a dead path, then a preserved backoff
// delay — up to a further 60s of "Connecting…" against an answering desktop.
export function isStaleForegroundDial(state: ConnectionState, dialAgeMs: number): boolean {
  return (state === 'connecting' || state === 'handshaking') && dialAgeMs >= STALE_DIAL_AGE_MS
}

/** Which nudge made the phone abandon its own dial, for the close line: it
 *  logged "Close code unavailable" on every resume (Pixel, 2026-09-27). */
export function staleDialOccasion(reason: ForegroundNudgeReason | undefined): string {
  switch (reason) {
    case undefined:
    case 'app-resume':
      return 'after resume'
    case 'network-change':
      return 'after a network change'
    case 'focus':
      return 'on a foreground nudge'
    case 'user-send':
      return 'on send'
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}
