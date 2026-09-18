import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AgentHudBeacon } from './agent-hud-beacon'

/**
 * The last beacon each terminal wrote, kept across app launches.
 *
 * Why: the beacon is a STREAM event. The agent emits it when it repaints its
 * status line, and the phone cannot ask for one. So a cold start begins with
 * nothing, and the HUD falls back to whatever else it has — the host's
 * `agentStatus.model`, captured when the session began, or a stored option
 * pick. Reported 2026-09-10 with a screenshot: a session running Opus at
 * extra-high effort read "Fable Medium" again after the app was reopened,
 * because the model had been changed inside the agent and only the beacon
 * ever knew.
 *
 * Restoring is not guessing: it is the last thing the agent itself said, which
 * is exactly what the in-memory store already shows for an idle tab. The first
 * live beacon replaces it, normally within one repaint.
 *
 * What it is NOT is proof the process is still there. A restored record is
 * used only for the session the tab is showing (it carries `sessionId`, and
 * `agentHudBeaconMatches` checks it) and only until the agent has worked long
 * enough to have repainted (`agent-hud-beacon-liveness.ts`). On 2026-09-18 a
 * record with no session on it kept naming a dead agent's model, across app
 * restarts, on a terminal that by then ran a hand-started `claude -c`.
 */
// `.v2`: records written before the beacon named its session carry nothing
// that ties them to a process. Every phone drops them on first launch of this
// build by never reading the old key.
const STORAGE_KEY = 'codeui:agent-hud-beacons.v2'

/** Enough for every tab a session realistically holds; oldest shed first. */
export const WARM_START_BEACON_CAP = 24

type StoredBeacons = Record<string, AgentHudBeacon>

/** A record that names no session is one no reader could ever believe;
 *  it is dropped here rather than restored and refused on every render. */
function signed(record: unknown): record is AgentHudBeacon {
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof (record as { sessionId?: unknown }).sessionId === 'string'
  )
}

/** Never throws: an unreadable store simply means no warm start. */
export async function readWarmStartBeacons(): Promise<StoredBeacons> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const restored: StoredBeacons = {}
    for (const [handle, record] of Object.entries(parsed as Record<string, unknown>)) {
      if (signed(record)) {
        restored[handle] = record
      }
    }
    return restored
  } catch {
    return {}
  }
}

/** Best effort: a failed write only costs the next launch its warm start. */
export async function rememberWarmStartBeacon(
  handle: string,
  beacon: AgentHudBeacon
): Promise<void> {
  if (!signed(beacon)) {
    // Nothing could believe it on the next launch; see `signed`.
    return
  }
  try {
    const stored = await readWarmStartBeacons()
    // Delete first so re-inserting makes this handle the newest key, and the
    // cap sheds a tab nobody has touched rather than the live one.
    delete stored[handle]
    stored[handle] = beacon
    const handles = Object.keys(stored)
    for (const stale of handles.slice(0, Math.max(0, handles.length - WARM_START_BEACON_CAP))) {
      delete stored[stale]
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Ignored on purpose; see the doc comment.
  }
}
