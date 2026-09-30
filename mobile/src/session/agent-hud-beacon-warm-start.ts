import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AgentHudBeacon, DesktopPrompt } from './agent-hud-beacon'
import { withoutCutTail } from './agent-hud-beacon-desktop-prompt'

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

/** A stored prompt every reader can take: a nonce and a text. */
function wellFormedPrompt(prompt: unknown): prompt is DesktopPrompt {
  return (
    typeof prompt === 'object' &&
    prompt !== null &&
    typeof (prompt as { nonce?: unknown }).nonce === 'string' &&
    typeof (prompt as { text?: unknown }).text === 'string'
  )
}

/** The record with only well-formed prompts in its lists. A prompt with no
 *  text made the restore throw, and with it every terminal after that one
 *  lost its warm start (review of 2026-09-27); a reader would have thrown
 *  on it too. */
function withWellFormedPrompts(record: AgentHudBeacon): AgentHudBeacon {
  const { agentMessagePrompts, ...rest } = record
  // Each desk prompt with when it arrived, which tells the chat it found the
  // copy long after (use-desktop-prompt-echoes.ts). One an older build stored
  // without it arrived no later than the record's last beacon.
  const arrivedBy = typeof record.receivedAt === 'number' ? record.receivedAt : 0
  const prompts = Array.isArray(record.desktopPrompts)
    ? record.desktopPrompts
        .filter(wellFormedPrompt)
        .map((prompt) => (typeof prompt.seenAt === 'number' ? prompt : { ...prompt, seenAt: arrivedBy }))
        // A cut copy an older build read keeps the U+FFFD of the character
        // its cut split, and never retired (agent-hud-beacon-desktop-prompt.ts).
        .map((prompt) => (prompt.cut === true ? { ...prompt, text: withoutCutTail(prompt.text) } : prompt))
        .filter((prompt) => prompt.text.length > 0)
    : []
  // A list that is not one is left out, not kept: the restore maps over it.
  const kept = Array.isArray(agentMessagePrompts) ? agentMessagePrompts.filter(wellFormedPrompt) : undefined
  return { ...rest, desktopPrompts: prompts, ...(kept ? { agentMessagePrompts: kept } : {}) }
}

/** The records a stored value holds. Missing or corrupt reads as none: there
 *  is nothing in it to keep, so the next write heals it by writing fresh. */
function parseStoredBeacons(raw: string | null): StoredBeacons {
  if (!raw) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const restored: StoredBeacons = {}
    for (const [handle, record] of Object.entries(parsed as Record<string, unknown>)) {
      if (signed(record)) {
        restored[handle] = withWellFormedPrompts(record)
      }
    }
    return restored
  } catch {
    return {}
  }
}

/** The stored records, or why storage would not hand them over. A refused
 *  read is kept apart from an empty store: only the second may be written
 *  over. */
async function readStoredBeacons(): Promise<{ beacons: StoredBeacons } | { refused: unknown }> {
  let raw: string | null
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY)
  } catch (error) {
    return { refused: error }
  }
  return { beacons: parseStoredBeacons(raw) }
}

/** Never throws: an unreadable store simply means no warm start, and the log
 *  says so, since every tab coming back without its pill looks the same
 *  whatever the cause. */
export async function readWarmStartBeacons(): Promise<StoredBeacons> {
  const read = await readStoredBeacons()
  if ('refused' in read) {
    console.warn('[storage] could not read the warm-start beacons', read.refused)
    return {}
  }
  return read.beacons
}

/**
 * The records a write builds on, or null when storage refused to hand them
 * over twice running.
 *
 * Every record lives under the one key, so a write is the whole store. A
 * refused read taken as an empty store made the next write replace every
 * other terminal's record with one, and after a restart those tabs had no
 * model pill or context ring (review of 2026-09-30). One more read covers a
 * store that refused once; one that still refuses gets no write, and this
 * tab's record waits for the next one the beacon store sends
 * (`storeForWarmStart` in agent-hud-beacon.ts: a changed reading at once, an
 * unchanged one after its rewrite interval).
 */
async function storedBeaconsForWrite(): Promise<StoredBeacons | null> {
  const first = await readStoredBeacons()
  if ('beacons' in first) {
    return first.beacons
  }
  const second = await readStoredBeacons()
  if ('beacons' in second) {
    return second.beacons
  }
  console.warn(
    '[storage] could not save the warm-start beacons: the stored ones could not be read, and writing over them would erase every other terminal',
    second.refused
  )
  return null
}

/**
 * The last write queued. Each write reads the whole store, changes one record
 * and writes it back, so each waits for the one before it: unserialised, two
 * tabs' beacons in the same tick both read the store before either wrote, and
 * the second write dropped the first tab's record, which then had no model
 * pill or context ring after a restart (review of 2026-09-30). A write never
 * rejects (see `writeWarmStartBeacon`), so a refused one cannot wedge the rest.
 */
let lastWrite: Promise<void> = Promise.resolve()

/** Best effort: a failed write only costs the next launch its warm start. */
export function rememberWarmStartBeacon(handle: string, beacon: AgentHudBeacon): Promise<void> {
  if (!signed(beacon)) {
    // Nothing could believe it on the next launch; see `signed`.
    return Promise.resolve()
  }
  lastWrite = lastWrite.then(() => writeWarmStartBeacon(handle, beacon))
  return lastWrite
}

async function writeWarmStartBeacon(handle: string, beacon: AgentHudBeacon): Promise<void> {
  try {
    const stored = await storedBeaconsForWrite()
    if (!stored) {
      return
    }
    // Delete first so re-inserting makes this handle the newest key, and the
    // cap sheds a tab nobody has touched rather than the live one.
    delete stored[handle]
    stored[handle] = beacon
    const handles = Object.keys(stored)
    for (const stale of handles.slice(0, Math.max(0, handles.length - WARM_START_BEACON_CAP))) {
      delete stored[stale]
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch (error) {
    // Logged, and never passed on: a rejection here would stop every write
    // queued behind this one. It costs the next launch this tab's warm start.
    console.warn('[storage] could not save the warm-start beacons', error)
  }
}
