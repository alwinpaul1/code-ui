import { isTailscaleEndpoint } from '../../../src/shared/remote-runtime-tailscale-hint'
import {
  relayHostReachabilityForCloseCode,
  type RelayHostReachabilityFromCloseCode
} from '../transport/relay-host-reachability'
import type {
  ConnectionLogEntry,
  ConnectionState,
  MobileConnectionDiagnosticPath
} from '../transport/types'

export type ConnectionDiagnosis = {
  likelyCause: string
  nextStep: string
  reportability: 'none' | 'orca-relay'
}

type DiagnoseConnectionArgs = {
  endpoint: string
  state: ConnectionState
  activePath?: MobileConnectionDiagnosticPath
  pendingPath?: MobileConnectionDiagnosticPath | null
  entries: readonly ConnectionLogEntry[]
}

const REJECTED_RESUME_CREDENTIAL: ConnectionDiagnosis = {
  likelyCause: 'Relay rejected the saved resume credential.',
  nextStep: 'Try a direct connection; if Relay keeps returning 401, pair this device again.',
  reportability: 'none'
}

/** Whether the run of failures the selected one came from — `selectDiagnosticFailure` hands
 *  that window over, current or stale — includes a refused credential at all. Reading the run
 *  rather than the current window matters when the selection is stale: the window after the
 *  resume is empty then, and an empty sweep would let a 503 that landed after four 401s wrap
 *  "keep Orca open, recovery will retry" in the stale qualifier. */
function hasRejectedCredential(run: readonly ConnectionLogEntry[]): boolean {
  return run.some((entry) =>
    /resolve failed \(401\)/i.test(`${entry.message} ${entry.detail ?? ''}`)
  )
}

export function diagnoseConnection(args: DiagnoseConnectionArgs): ConnectionDiagnosis {
  if (args.state === 'connected') {
    return {
      likelyCause: `Connection is healthy${args.activePath ? ` via ${formatPath(args.activePath)}` : ''}.`,
      nextStep: 'No action needed.',
      reportability: 'none'
    }
  }
  const selected = selectDiagnosticFailure(args.entries)
  const failure = selected?.entry
  const evidence = failure ? diagnosticEvidence(failure) : ''
  const diagnosis = diagnoseFailure(args, failure, evidence, selected?.run ?? [])
  if (!selected?.staleSince) {
    return diagnosis
  }
  // Evidence from before the last resume or network change is still the best
  // account of a host that has not answered since; it is just not a current,
  // sendable incident.
  const boundary =
    selected.staleSince === 'network-changed' ? 'the last network change' : 'the app last resumed'
  return {
    likelyCause: `Before ${boundary}: ${diagnosis.likelyCause}`,
    nextStep: diagnosis.nextStep,
    reportability: 'none'
  }
}

function diagnoseFailure(
  args: DiagnoseConnectionArgs,
  failure: ConnectionLogEntry | undefined,
  evidence: string,
  run: readonly ConnectionLogEntry[]
): ConnectionDiagnosis {
  // A rejected credential outranks a 503 that merely landed after it. Reported
  // 2026-09-14: four "resolve failed (401)" in a row, then one 503, and the
  // screen said the relay was temporarily unavailable and to keep Orca open
  // because recovery would retry. It never could — 401 means the saved resume
  // credential was refused, and no amount of retrying fixes that, so the person
  // was told to wait for something that would never happen.
  //
  // Only against a 503, deliberately. A newer failure of a DIFFERENT kind means
  // the transport has moved on and the 401 is stale, which a sibling test pins.
  // A 503 is the same director call saying "try again shortly", and that advice
  // is precisely what is wrong while the credential is being refused.
  if (/resolve failed \(503\)/i.test(evidence) && hasRejectedCredential(run)) {
    return REJECTED_RESUME_CREDENTIAL
  }

  if (/relay director resolve failed \(401\)/i.test(evidence)) {
    return REJECTED_RESUME_CREDENTIAL
  }

  if (/relay director resolve failed \(503\)/i.test(evidence)) {
    const retryMs = parseRetryDelayMs(evidence)
    return {
      likelyCause: `Relay service was temporarily unavailable${retryMs == null ? '.' : ` and asked Orca to retry in ${formatDelay(retryMs)}.`}`,
      nextStep: 'Keep Orca open; recovery should retry automatically.',
      reportability: 'none'
    }
  }

  // After the director branches: a director error also arrives as a relay dial failure.
  const relayDial = relayDialFailure(failure, evidence)
  if (relayDial) {
    return relayDial
  }

  if (/liveness-timeout|liveness timeout|connection health check failed/i.test(evidence)) {
    const relayLiveness = failure?.code === 'liveness-timeout' && failure.path === 'relay'
    const structuredDirectLiveness =
      failure?.code === 'liveness-timeout' &&
      (failure.path === 'lan' || failure.path === 'tailscale')
    const path =
      relayLiveness || (!structuredDirectLiveness && args.activePath === 'relay')
        ? 'Relay'
        : 'The connected host'
    return {
      likelyCause: `${path} stopped answering authenticated health checks.`,
      nextStep: 'Orca closed the stale session and started recovery.',
      reportability: relayLiveness ? 'orca-relay' : 'none'
    }
  }

  if (/relay-session-failed|active relay session failed/i.test(evidence)) {
    return {
      likelyCause: 'The active Relay session closed unexpectedly.',
      nextStep: 'Orca started Relay recovery; the event history includes the cell close reason.',
      reportability:
        failure?.code === 'relay-session-failed' && failure.path === 'relay' ? 'orca-relay' : 'none'
    }
  }

  if (/authentication-rejected|unauthorized|pairing may be revoked/i.test(evidence)) {
    return {
      likelyCause: 'The desktop rejected this device during authentication.',
      nextStep: 'Confirm the device is still paired; pair it again if the rejection repeats.',
      reportability: 'none'
    }
  }

  if (/connect-timeout|websocket connect timeout/i.test(evidence)) {
    return {
      likelyCause: isTailscaleEndpoint(args.endpoint)
        ? 'The saved Tailscale endpoint did not answer before the connection timeout.'
        : 'The saved direct endpoint did not answer before the connection timeout.',
      nextStep:
        args.pendingPath === 'relay'
          ? 'Relay recovery is in progress; keep Orca open while it retries.'
          : 'Check the local/VPN network and confirm the desktop is awake.',
      reportability: 'none'
    }
  }

  if (/handshake-timeout|handshake timeout/i.test(evidence)) {
    return {
      likelyCause: 'The endpoint opened, but the encrypted Orca handshake did not finish.',
      nextStep: 'Confirm the desktop is running a compatible Orca version and retry.',
      reportability: 'none'
    }
  }

  if (args.pendingPath === 'relay') {
    return {
      likelyCause: 'Relay recovery is selected, but no more specific failure is recorded yet.',
      nextStep: 'Keep this page open while the next recovery event is recorded.',
      reportability: 'none'
    }
  }

  return {
    likelyCause: 'No single failure cause can be determined from the recorded events.',
    nextStep: 'Run diagnostics and copy the report again after the next connection attempt.',
    reportability: 'none'
  }
}

export function getReportableConnectionIncidentId(args: DiagnoseConnectionArgs): string | null {
  const selected = selectDiagnosticFailure(args.entries)
  if (!selected || selected.staleSince) {
    return null
  }
  return diagnoseFailure(args, selected.entry, diagnosticEvidence(selected.entry), selected.run)
    .reportability === 'orca-relay'
    ? selected.entry.id
    : null
}

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
function relayDialFailure(
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

// Newest failure since the last resume/network change; failing that, the newest
// since the last connection or session start, flagged stale. The window used to
// stop at every resume, and iOS resumes the app often enough that a host that
// never answers left the window empty and the report cause-less.
// `run` is the window the entry was picked from, so a rule that reads the
// failure's neighbours (the 401-over-503 rule) reads the same ones.
function selectDiagnosticFailure(
  entries: readonly ConnectionLogEntry[]
):
  | { entry: ConnectionLogEntry; staleSince: ResumeBoundary | null; run: ConnectionLogEntry[] }
  | undefined {
  const sessionStart = entries.findLastIndex(isSessionBoundary) + 1
  const sinceSession = entries.slice(sessionStart)
  const boundaryIndex = sinceSession.findLastIndex(isResumeBoundary)
  const currentRun = sinceSession.slice(boundaryIndex + 1)
  const current = newestFailure(currentRun)
  if (current) {
    return { entry: current, staleSince: null, run: currentRun }
  }
  const staleRun = sinceSession.slice(0, boundaryIndex + 1)
  const stale = newestFailure(staleRun)
  const boundary = sinceSession[boundaryIndex]?.code
  return stale && isResumeBoundaryCode(boundary)
    ? { entry: stale, staleSince: boundary, run: staleRun }
    : undefined
}

// Relay-path evidence outranks a newer direct failure: off the LAN every direct
// dial times out, which says nothing, while the relay names the desktop's state.
// Among relay failures the newest wins, so a fresh session close or director
// error is never hidden behind an older verdict.
function newestFailure(entries: readonly ConnectionLogEntry[]): ConnectionLogEntry | undefined {
  const newestFirst = entries.toReversed().filter(isDiagnosticFailure)
  return newestFirst.find((entry) => entry.path === 'relay') ?? newestFirst[0]
}

function isSessionBoundary(entry: ConnectionLogEntry): boolean {
  return (
    entry.code === 'client-session-started' ||
    entry.code === 'relay-connected' ||
    entry.code === 'direct-connected' ||
    entry.message === 'Authenticated'
  )
}

type ResumeBoundary = 'app-resumed' | 'network-changed'

function isResumeBoundaryCode(code: ConnectionLogEntry['code']): code is ResumeBoundary {
  return code === 'app-resumed' || code === 'network-changed'
}

function isResumeBoundary(entry: ConnectionLogEntry): boolean {
  return isResumeBoundaryCode(entry.code)
}

function diagnosticEvidence(entry: ConnectionLogEntry): string {
  return `${entry.code ?? ''} ${entry.message} ${entry.detail ?? ''}`
}

function isDiagnosticFailure(entry: ConnectionLogEntry): boolean {
  return /relay director resolve failed \((?:401|503)\)|liveness-timeout|liveness timeout|connection health check failed|relay-dial-failed|relay dial failed|relay-session-failed|active relay session failed|authentication-rejected|unauthorized|pairing may be revoked|connect-timeout|websocket connect timeout|handshake-timeout|handshake timeout/i.test(
    diagnosticEvidence(entry)
  )
}

function parseRetryDelayMs(evidence: string): number | null {
  const match = /retry(?:-|\s)?after(?:=|\s)(\d+)ms/i.exec(evidence)
  return match ? Number(match[1]) : null
}

function formatDelay(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`
}

function formatPath(path: MobileConnectionDiagnosticPath): string {
  if (path === 'relay') {
    return 'Relay'
  }
  return path === 'tailscale' ? 'Tailscale/direct' : 'LAN/direct'
}
