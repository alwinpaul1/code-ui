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
 */
const STORAGE_KEY = 'codeui:agent-hud-beacons'

/** Enough for every tab a session realistically holds; oldest shed first. */
export const WARM_START_BEACON_CAP = 24

type StoredBeacons = Record<string, AgentHudBeacon>

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
    return parsed as StoredBeacons
  } catch {
    return {}
  }
}

/** Best effort: a failed write only costs the next launch its warm start. */
export async function rememberWarmStartBeacon(
  handle: string,
  beacon: AgentHudBeacon
): Promise<void> {
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
