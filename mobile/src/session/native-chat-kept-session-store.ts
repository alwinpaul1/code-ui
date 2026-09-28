import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getAgentHudBeaconArrivedAt, type AgentHudBeacon } from './agent-hud-beacon'
import {
  BEACON_HEARTBEAT_MISSED_BEATS,
  BEACON_HEARTBEAT_SILENCE_MS,
  isBeaconWrittenOff
} from './agent-hud-beacon-liveness'
import { agentHudBeaconMatches } from './hud-beacon-fields'
import { createPersistedMap } from './session-cache-persistence'
import {
  namesItsTranscript,
  readNativeChatTabStatus,
  type NativeChatKeptSession,
  type NativeChatStatusReading,
  type NativeChatTurn
} from './native-chat-kept-session'

// Why persisted: a nested agent's status outlives the phone. Restarted while
// the pane still carries it, the chat's first status is the nested one, and
// only the session kept on the last run says which is the tab's own
// (native-chat-kept-session.ts). Bounded like the other per-tab stores.
const kept = createPersistedMap<NativeChatKeptSession>({
  storageKey: 'codeui:chat-kept-session',
  maxEntries: 64
})
/** Each session's turn as last heard, by agent and session id. Not persisted:
 *  after a restart the chat reads the kept session's transcript, whose turn
 *  markers say it again. */
const turns = new Map<string, NativeChatTurn>()
const TURNS_KEPT = 128
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** One entry per host, tab and agent: a Codex later started in the same tab
 *  keeps nothing of the Claude that ran there before it. */
export function nativeChatKeptSessionKey(hostId: string | null, tabId: string, agent: string): string {
  return `${hostId ?? ''}\u0000${tabId}\u0000${agent}`
}

/** What storage holds is checked, not trusted: a corrupt entry is no entry. */
function keptSession(key: string | null): NativeChatKeptSession | null {
  if (key === null) {
    return null
  }
  const value = kept.get(key)
  return value && typeof value.sessionId === 'string' && typeof value.transcriptPath === 'string' ? value : null
}

function keepNativeChatSession(key: string, session: NativeChatKeptSession): void {
  const current = keptSession(key)
  if (current?.sessionId === session.sessionId && current.transcriptPath === session.transcriptPath) {
    return
  }
  kept.set(key, session)
  notify()
}

function turnKey(agent: string, sessionId: string): string {
  return `${agent}\u0000${sessionId}`
}

function noteTurn(agent: string, sessionId: string, turn: NativeChatTurn): void {
  const key = turnKey(agent, sessionId)
  if (turns.get(key) === turn) {
    return
  }
  turns.delete(key)
  turns.set(key, turn)
  while (turns.size > TURNS_KEPT) {
    turns.delete(turns.keys().next().value!)
  }
  notify()
}

/**
 * The transcript's own word on its lead turn, from a stream frame: Orca reads
 * the newest turn marker in each window it sends (`lifecycle`: a prompt opens
 * a turn, an assistant row with a terminal stop reason or an interrupt closes
 * it, transcript-turn-lifecycle.ts). Frames with none change nothing.
 */
export function noteNativeChatTranscriptTurn(
  agent: string | null,
  sessionId: string | null,
  lifecycle: { state?: unknown } | null | undefined
): void {
  const state = lifecycle?.state
  if (!agent || !sessionId || typeof state !== 'string') {
    return
  }
  if (state === 'working') {
    noteTurn(agent, sessionId, 'working')
  } else if (state === 'completed' || state === 'interrupted') {
    noteTurn(agent, sessionId, 'ended')
  }
}

/** A session's own status on the turn: running while `working` (not
 *  monitoring background work) or paused on a dialog, ended otherwise. */
function statusTurn(state: string | null | undefined, workingMode: string | null | undefined): NativeChatTurn | null {
  if (state === 'working') {
    return workingMode === 'monitoring' ? 'ended' : 'working'
  }
  return state === 'blocked' || state === 'waiting' ? 'working' : state === 'done' ? 'ended' : null
}

export type NativeChatTabStatus = {
  state?: string | null
  workingMode?: string | null
  sessionBoundary?: boolean | null
  providerSession?: { id?: string | null; transcriptPath?: string | null } | null
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
  painting: string | null = null
): NativeChatStatusReading {
  const getKept = useCallback(() => keptSession(key), [key])
  const keptNow = useSyncExternalStore(subscribe, getKept, getKept)
  const keptId = keptNow?.sessionId ?? null
  const getTurn = useCallback(
    () => (agent && keptId ? (turns.get(turnKey(agent, keptId)) ?? null) : null),
    [agent, keptId]
  )
  const keptTurn = useSyncExternalStore(subscribe, getTurn, getTurn)
  const reading = readNativeChatTabStatus({
    agent,
    providerSession: status?.providerSession,
    state: status?.state,
    sessionBoundary: status?.sessionBoundary,
    kept: keptNow,
    keptTurn,
    painting
  })
  const keepId = reading.kind === 'own' ? (reading.keep?.sessionId ?? null) : null
  const keepPath = reading.kind === 'own' ? (reading.keep?.transcriptPath ?? null) : null
  const ownId = reading.kind === 'own' ? reading.sessionId : null
  const ownTurn = ownId ? statusTurn(status?.state, status?.workingMode) : null
  useEffect(() => {
    if (key !== null && keepId !== null && keepPath !== null) {
      keepNativeChatSession(key, { sessionId: keepId, transcriptPath: keepPath })
    }
  }, [key, keepId, keepPath])
  useEffect(() => {
    if (agent && ownId && ownTurn) {
      noteTurn(agent, ownId, ownTurn)
    }
  }, [agent, ownId, ownTurn])
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
  const now = useBeaconClock(candidate !== null)
  if (!candidate || isBeaconWrittenOff(handle)) {
    return null
  }
  const arrivedAt = getAgentHudBeaconArrivedAt(handle)
  const window = Math.max(
    BEACON_HEARTBEAT_SILENCE_MS,
    BEACON_HEARTBEAT_MISSED_BEATS * (candidate.heartbeatSeconds ?? 0) * 1000
  )
  return arrivedAt !== null && now - arrivedAt <= window ? candidate.sessionId : null
}

/** A clock for the freshness check, ticking only while there is a beacon to
 *  judge: state, so the render that reads it stays pure. Not `useNow`, whose
 *  app-state gate reaches into react-native. */
function useBeaconClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), BEACON_CLOCK_MS)
    return () => clearInterval(timer)
  }, [enabled])
  return now
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

export async function hydrateNativeChatKeptSessions(): Promise<void> {
  await kept.hydrate()
  notify()
}

export function resetNativeChatKeptSessionsForTests(): void {
  kept.reset()
  turns.clear()
  notify()
}
