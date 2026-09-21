import {
  relayHostReachabilityForCloseCode,
  type RelayHostReachabilityFromCloseCode
} from '../transport/relay-host-reachability'
import type { ConnectionLogEntry } from '../transport/types'
import type { ConnectionDiagnosis } from './connection-diagnostics-analysis'

// The relay-dial half of the connection diagnosis, split from
// connection-diagnostics-analysis.ts for the line ceiling; nothing here changed
// when it moved (2026-09-21).

// Reads to the relay close code behind a failed dial. Longer than the host
// row's copy on purpose: this is the line the user pastes into a bug report.
const RELAY_DIAL_ADVICE: Record<
  RelayHostReachabilityFromCloseCode,
  { likelyCause: (code: number) => string; nextStep: string }
> = {
  'host-offline': {
    likelyCause: (code) =>
      `Relay answered, but the desktop is not connected to it (close code ${code}, host offline).`,
    nextStep: 'Check the desktop is awake, Orca is running, and it is signed in to Orca Cloud.'
  },
  'credential-refused': {
    likelyCause: (code) => `Relay refused this device’s relay credential (close code ${code}).`,
    nextStep: 'Re-pair this phone with the desktop.'
  },
  // Fork copy (2026-09-12): upstream's "could not reach the Relay cell" blames the phone, but a
  // 1006 is equally the Relay being down, and the next step has to let the user tell the two
  // apart before it points at a LAN or Tailscale endpoint.
  unreachable: {
    likelyCause: (code) =>
      `The Relay dropped the connection before the encrypted handshake (relay_outer_${code}). Either this phone cannot reach the Relay, or the Relay is down.`,
    nextStep:
      'Check that other sites load on this phone, then confirm the desktop shows Relay connected. If both hold, the Relay itself is down; a LAN or Tailscale endpoint bypasses it.'
  },
  connecting: {
    likelyCause: (code) =>
      `Relay closed the dial with code ${code}; recovery re-resolves and retries.`,
    nextStep: 'Keep Orca open while Relay recovery retries.'
  }
}

// The cell's close code names the desktop's state; a direct timeout in the same
// window only says the phone is off the LAN, so the relay verdict wins. A cause
// that is the desktop's or the phone's is never reportable; the two the Relay
// itself announces (4503 draining, a 503 upgrade refusal) are, when the entry
// is the relay dial and not a loose text match.
//
// The close code is read from the entry's structured field when the log wrote
// one (every dial since #21566) and from the `relay_outer_NNNN` text otherwise,
// so an older export, or a session close that only names the code in prose,
// still gets the same diagnosis. Read before any loose text match: `\b503\b`
// cannot match `relay_outer_4503` (no word boundary inside 4503), so every one
// of these codes used to fall through to the 1006 text and blame the phone's
// reachability for an outage the relay had announced (2026-09-12, 17 minutes
// of 4503s).
export function relayDialFailure(
  failure: ConnectionLogEntry | undefined,
  evidence: string
): ConnectionDiagnosis | null {
  const structured = failure?.code === 'relay-dial-failed'
  // The text fallback is for an entry with no code at all (an older export); an
  // entry that names another code — a session close carrying `relay_outer_4408`,
  // say — belongs to its own branch below, not to the dial's.
  if (
    !structured &&
    (failure?.code != null || !/relay-dial-failed|relay dial failed|relay_outer_/i.test(evidence))
  ) {
    return null
  }
  const relayFault: ConnectionDiagnosis['reportability'] =
    structured && failure.path === 'relay' ? 'orca-relay' : 'none'
  const closeCode =
    failure?.relayCloseCode ?? Number(/relay_outer_(\d+)/i.exec(evidence)?.[1] ?? Number.NaN)
  if (closeCode === 4503) {
    const draining = /draining/i.test(evidence)
    return {
      likelyCause: `The Relay refused the connection (4503${
        draining ? ', draining' : ''
      }). That is the Relay service itself, not this phone or the desktop.`,
      nextStep:
        'Nothing to do here: recovery keeps retrying and reconnects when the Relay is back.',
      reportability: relayFault
    }
  }
  // The outer relay WebSocket died before Orca's own handshake. The phone never
  // sees the cell's HTTP status directly; Android's socket error text ("Expected
  // HTTP 101 response but was '503 Service Unavailable'") is the one place it
  // leaks through, so it decides between "the relay is down" and "we are offline".
  if (/\b503\b|overload|service unavailable/i.test(evidence)) {
    return {
      likelyCause:
        'The Relay cell refused the connection with 503 (overloaded or draining). The desktop is dropped from it too, so nothing on this phone can restore the Relay path.',
      nextStep:
        'Wait for the Relay to recover, or use a LAN or Tailscale endpoint, which bypasses the Relay.',
      reportability: relayFault
    }
  }
  // Same leak, other status: read it before the code, since a real dial entry always carries a
  // close code (1006 here) and the code alone would blame the phone's reach.
  if (/\b40[13]\b|unauthorized|forbidden/i.test(evidence)) {
    return {
      likelyCause: 'The Relay cell rejected this device before the handshake.',
      nextStep: RELAY_DIAL_ADVICE['credential-refused'].nextStep,
      reportability: 'none'
    }
  }
  if (Number.isNaN(closeCode)) {
    // A dial that never reached the cell carries no close code at all.
    return {
      likelyCause: 'The Relay dial failed before the cell answered.',
      nextStep: 'Check this phone’s network connection; Relay recovery retries automatically.',
      reportability: 'none'
    }
  }
  // 4403 is the cell refusing the device too; the shared map only knows the 4401 it issues.
  const verdict =
    closeCode === 4403 ? 'credential-refused' : relayHostReachabilityForCloseCode(closeCode)
  const advice = RELAY_DIAL_ADVICE[verdict]
  return {
    likelyCause: advice.likelyCause(closeCode),
    nextStep: advice.nextStep,
    reportability: 'none'
  }
}

