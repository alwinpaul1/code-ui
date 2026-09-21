import { isTailscaleEndpoint } from '../../../src/shared/remote-runtime-tailscale-hint'
import { isPrivateLanAddress } from '../transport/mobile-direct-endpoint-list'
import { relayDialFailure } from './connection-diagnostics-relay-dial'
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
  /** What the phone reports it is on now (`readMobileNetworkType`), when the
   *  page has it: names mobile data outright instead of "the network changed". */
  networkType?: string | null
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

  // A desktop the phone knows only by a private network address, after the
  // phone left that network (a friend's phone, 2026-09-21: 33 hours on the
  // desktop's Wi‑Fi, then mobile data, then every redial to 192.168.1.132
  // closing 1006 under "no single failure cause"). Nothing else is tried
  // because there is nothing else: no Relay credential for this desktop.
  // Relay recovery pending means there IS one, and the branches above own it.
  if (args.pendingPath !== 'relay' && isPrivateLanAddress(args.endpoint) && leftNetworkSince(args.entries)) {
    const address = privateAddressLabel(args.endpoint)
    const where =
      args.networkType === 'CELLULAR' ? 'the phone is on mobile data' : 'the phone’s network changed'
    return {
      likelyCause: `The desktop is saved by a private network address (${address}), which only answers from the same Wi‑Fi or LAN, and ${where}.`,
      nextStep:
        'Rejoin that network, or enable Orca Relay on the desktop (Settings → Relay, sign in) so this phone can reach it from anywhere.',
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

/** Since the last network change, sockets have only closed: no
 *  authentication, no relay dial. Read over the whole log rather than the
 *  failure window, because a 1006 close is not one of the failures that
 *  window is cut around — which is exactly why this log read as cause-less. */
function leftNetworkSince(entries: readonly ConnectionLogEntry[]): boolean {
  const changed = entries.findLastIndex(
    (entry) => entry.code === 'network-changed' || /^Network changed$/i.test(entry.message)
  )
  if (changed === -1) {
    return false
  }
  const since = entries.slice(changed + 1)
  return (
    since.some((entry) => /websocket closed/i.test(entry.message)) &&
    !since.some((entry) => entry.message === 'Authenticated' || entry.path === 'relay')
  )
}

function privateAddressLabel(endpoint: string): string {
  try {
    return new URL(endpoint).hostname
  } catch {
    return endpoint
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
