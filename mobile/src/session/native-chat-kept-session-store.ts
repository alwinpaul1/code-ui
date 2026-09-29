import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getAgentHudBeaconArrivedAt, type AgentHudBeacon } from './agent-hud-beacon'
import {
  BEACON_HEARTBEAT_MISSED_BEATS,
  BEACON_HEARTBEAT_SILENCE_MS,
  isBeaconWrittenOff
} from './agent-hud-beacon-liveness'
import { agentHudBeaconMatches } from './hud-beacon-fields'
import { isTitleStandIn } from './agent-status-stand-in'
import {
  BACKGROUND_CLAIM_MS,
  matchPhoneSend,
  namesItsTranscript,
  readNativeChatTabStatus,
  type NativeChatStatusReading
} from './native-chat-kept-session'
import {
  claimPhoneTerminalSend,
  keepNativeChatSession,
  keptSession,
  noteTurn,
  phoneTerminalSends,
  readTurn,
  statusTurn,
  subscribe
} from './native-chat-kept-session-state'

export {
  hydrateNativeChatKeptSessions,
  nativeChatKeptSessionKey,
  noteNativeChatTranscriptTurn,
  notePhoneTerminalSend,
  resetNativeChatKeptSessionsForTests
} from './native-chat-kept-session-state'

export type NativeChatTabStatus = {
  state?: string | null
  workingMode?: string | null
  sessionBoundary?: boolean | null
  updatedAt?: number | null
  providerSession?: { id?: string | null; transcriptPath?: string | null } | null
  prompt?: string | null
  toolName?: string | null
  stateHistory?: readonly unknown[] | null
} | null

/**
 * How the chat reads a tab's status, with the tab's kept session and that
 * session's turn behind it (native-chat-kept-session.ts). After the render
 * that read it, a status that is the agent's own is remembered: its session
 * and transcript for the tab, its state as that session's turn.
 */
export function useNativeChatTabStatusReading(
  key: string | null,
  agent: string | null,
  status: NativeChatTabStatus,
  /** The session a fresh beacon of the chat agent names on this terminal. */
  painting: string | null = null,
  /** The tab's `turnCompletedAt` (agent-status-stand-in.ts). */
  turnCompletedAt: number | null = null,
  /** `handle`: the tab's terminal, which the phone's own sends are kept by.
   *  `watching`: the link is up and the tab list is the host's own. Nothing
   *  is noted from a status seen otherwise: a cached list can be hours old,
   *  and a note from it stood over the live list's word for the same turn
   *  (the second review of the background rule). */
  { handle = null, watching = true }: { handle?: string | null; watching?: boolean } = {}
): NativeChatStatusReading {
  const getKept = useCallback(() => keptSession(key), [key])
  const keptNow = useSyncExternalStore(subscribe, getKept, getKept)
  const keptId = keptNow?.sessionId ?? null
  const getKeptTurn = useCallback(
    () => (agent && keptId ? (readTurn(agent, keptId)?.turn ?? null) : null),
    [agent, keptId]
  )
  const recordedKeptTurn = useSyncExternalStore(subscribe, getKeptTurn, getKeptTurn)
  const getKeptStamp = useCallback(
    () => (agent && keptId ? (readTurn(agent, keptId)?.stamp ?? null) : null),
    [agent, keptId]
  )
  const keptStamp = useSyncExternalStore(subscribe, getKeptStamp, getKeptStamp)
  const getKeptAt = useCallback(() => (agent && keptId ? (readTurn(agent, keptId)?.at ?? null) : null), [agent, keptId])
  const keptAt = useSyncExternalStore(subscribe, getKeptAt, getKeptAt)
  const statusAt = status?.updatedAt ?? null
  // A claim to background work older than Orca keeps the row that made it
  // is no longer the host's word (BACKGROUND_CLAIM_MS): from the turn end
  // Orca stamped, or the status that made the claim when none was stamped.
  const claimAnchor = keptStamp ?? keptAt
  const keptTurn =
    recordedKeptTurn === 'background' && claimAnchor !== null && statusAt !== null && statusAt - claimAnchor > BACKGROUND_CLAIM_MS
      ? 'ended'
      : recordedKeptTurn
  const statusId = status?.providerSession?.id?.trim() || null
  const getSecondTurn = useCallback(
    () => (agent && statusId ? readTurn(agent, statusId)?.secondTurn === true : false),
    [agent, statusId]
  )
  const secondTurn = useSyncExternalStore(subscribe, getSecondTurn, getSecondTurn)
  const getHoldsBackground = useCallback(
    () => (agent && statusId ? readTurn(agent, statusId)?.turn === 'background' : false),
    [agent, statusId]
  )
  const holdsBackground = useSyncExternalStore(subscribe, getHoldsBackground, getHoldsBackground)
  const getPhoneSends = useCallback(() => phoneTerminalSends(handle), [handle])
  const phoneSends = useSyncExternalStore(subscribe, getPhoneSends, getPhoneSends)
  const phoneSend = matchPhoneSend(status, phoneSends, keptTurn)
  const reading = readNativeChatTabStatus({
    agent,
    providerSession: status?.providerSession,
    state: status?.state,
    sessionBoundary: status?.sessionBoundary,
    kept: keptNow,
    keptTurn,
    secondTurn,
    holdsBackground,
    phoneOwned: phoneSend?.owned ?? null,
    painting
  })
  // The first session that shows a send owns it; a /clear's send goes to the
  // first boundary naming a session other than the kept one.
  const claimSend = phoneSend !== null && statusId !== null && watching && (phoneSend.owned === 'prompt' || statusId !== keptId) ? phoneSend.send : null
  useEffect(() => {
    if (claimSend && statusId) {
      claimPhoneTerminalSend(handle, claimSend, statusId)
    }
  }, [claimSend, handle, statusId])
  const keepId = reading.kind === 'own' ? (reading.keep?.sessionId ?? null) : null
  const keepPath = reading.kind === 'own' ? (reading.keep?.transcriptPath ?? null) : null
  useEffect(() => {
    if (key !== null && keepId !== null && keepPath !== null) {
      keepNativeChatSession(key, { sessionId: keepId, transcriptPath: keepPath })
    }
  }, [key, keepId, keepPath])
  // Every status is its own session's word on that session's turn, whoever
  // the chat reads: noted per event (`updatedAt`), so a later status stands
  // over an earlier word, save a title stand-in over the all-clear of its own
  // turn (native-chat-kept-session-state.ts `noteTurn`).
  const noted =
    namesItsTranscript(agent) && statusId
      ? statusTurn(status?.state, status?.workingMode, status?.sessionBoundary, {
          turnCompletedAt,
          titleStandIn: status ? isTitleStandIn(status) : false
        })
      : null
  // A /clear keeps the background tasks (Claude Code 2.1.284), so the session
  // the phone's /clear started holds the claim the lead had.
  const inheritsBackground = reading.kind === 'own' && reading.switched?.rule === 'phone-reset' && keptTurn === 'background'
  const notedTurn = !watching ? null : inheritsBackground ? 'background' : (noted?.turn ?? null)
  const notedFinished = noted?.finishedOne ?? false
  const notedFromStandIn = noted?.fromStandIn ?? false
  const notedStamp = inheritsBackground ? keptStamp : turnCompletedAt
  const notedAt = inheritsBackground ? claimAnchor : statusAt
  const notedBoundary = noted?.boundary === true
  useEffect(() => {
    if (agent && statusId && notedTurn) {
      noteTurn(agent, statusId, notedTurn, notedFinished, notedFromStandIn, notedStamp, notedAt, {
        boundary: notedBoundary,
        inherited: inheritsBackground
      })
    }
  }, [agent, statusId, notedTurn, notedFinished, notedFromStandIn, statusAt, notedStamp, notedAt, notedBoundary, inheritsBackground])
  return reading
}

/**
 * The session the beacon on `handle` names, when it is the chat agent's and
 * fresh: it declared a beat and last arrived within that beat's silence
 * window (agent-hud-beacon-liveness.ts), and the liveness watch has not
 * written it off. A record from a process that has since exited, or one
 * restored at a cold start, is not fresh. The clock ticks only while there is
 * such a beacon to judge.
 */
export function useFreshNativeChatBeaconSession(
  beacon: Pick<AgentHudBeacon, 'agent' | 'sessionId' | 'heartbeatSeconds'> | null,
  agent: string | null,
  handle: string | null
): string | null {
  const candidate =
    namesItsTranscript(agent) &&
    beacon?.sessionId &&
    beacon.heartbeatSeconds != null &&
    agentHudBeaconMatches(beacon, agent, beacon.sessionId)
      ? beacon
      : null
  const windowMs = Math.max(
    BEACON_HEARTBEAT_SILENCE_MS,
    BEACON_HEARTBEAT_MISSED_BEATS * (candidate?.heartbeatSeconds ?? 0) * 1000
  )
  const fresh = useBeaconFreshness(candidate === null ? null : handle, candidate, windowMs)
  return candidate && fresh && !isBeaconWrittenOff(handle) ? candidate.sessionId : null
}

/**
 * Whether the beacon on `handle` arrived within `windowMs`, sampled in an
 * effect on a clock that ticks only while there is a beacon to judge: the
 * arrival moves on every beat without a re-render, so it is read from the
 * timer, never at render (agent-hud-beacon.ts). Not fresh until the first
 * sample, so a tab switched back to shows no old beacon as fresh for a frame.
 * Not `useNow`, whose app-state gate reaches into react-native.
 */
function useBeaconFreshness(handle: string | null, beacon: object | null, windowMs: number): boolean {
  const [sample, setSample] = useState<{ handle: string; fresh: boolean } | null>(null)
  useEffect(() => {
    if (handle === null) {
      return
    }
    const check = () => {
      const arrivedAt = getAgentHudBeaconArrivedAt(handle)
      setSample({ handle, fresh: arrivedAt !== null && Date.now() - arrivedAt <= windowMs })
    }
    check()
    const timer = setInterval(check, BEACON_CLOCK_MS)
    return () => {
      clearInterval(timer)
      // A sample outlives nothing it was taken for: judged again from scratch.
      setSample(null)
    }
    // `beacon`: a new record re-samples at once.
  }, [handle, beacon, windowMs])
  return handle !== null && sample?.handle === handle && sample.fresh
}

const BEACON_CLOCK_MS = 5_000

/** The status as the tab's own agent may be read by: none while it is a
 *  nested agent's. */
export function ownTabStatus<Status>(reading: NativeChatStatusReading, status: Status | null): Status | null {
  return reading.kind === 'nested' ? null : status
}

/** The session a reading says the tab is on: the one it reads over a nested
 *  status, the agent's own, or the status's as reported. */
export function readSessionId(reading: NativeChatStatusReading, reported: string | null): string | null {
  return reading.kind === 'nested' ? (reading.read?.sessionId ?? reported) : reading.kind === 'own' ? reading.sessionId : reported
}
