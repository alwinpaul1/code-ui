import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MacDisplayState, MacHostState, MacMuteState } from './mac-host-state'

/**
 * What a host last said about its display and its sound, kept on this phone across
 * connections and restarts, so the first open of its menu on a new connection draws
 * one row of each pair instead of both.
 *
 * Why (2026-10-15, the user, with a screenshot of the Mac's menu: "Fix this too"): the
 * menu listed Lock Mac, Sleep display, Wake display, Mute Mac and Unmute Mac all at
 * once. That was the first open on a connection, when nothing was known yet, and an
 * unknown state offers both halves of each pair. The user had asked that same day for
 * only the row that would do something.
 *
 * The lock is never kept here. Unlock types the password into whatever is in front on
 * the Mac (mac-host-sheet-actions.ts), so it follows only what the Mac said on this
 * connection. A stale display or mute row costs one tap that does nothing, and the
 * probe that runs on every open replaces it within a second or so.
 *
 * Only a half the host actually named, or an action that finished OK, is written; a
 * half the probe could not read leaves what was kept (rememberHostStateHalves).
 */
export type RememberedHostState = {
  display: Exclude<MacDisplayState, 'unknown'> | null
  mute: Exclude<MacMuteState, 'unknown'> | null
}

const STORAGE_KEY_PREFIX = 'orca:host-controls-remembered-state:v1:'

function storageKey(hostId: string): string {
  return `${STORAGE_KEY_PREFIX}${hostId}`
}

/** The halves of `state` worth keeping: the ones the host named. Null when it named neither. */
export function rememberableHalves(state: MacHostState): Partial<RememberedHostState> | null {
  const halves: Partial<RememberedHostState> = {}
  if (state.display !== 'unknown') {
    halves.display = state.display
  }
  if (state.mute !== 'unknown') {
    halves.mute = state.mute
  }
  return Object.keys(halves).length > 0 ? halves : null
}

/**
 * `drawn` with each display or mute half it could not say taken from what the host
 * named last time, when anything was kept. The lock is never touched: an unknown lock
 * draws Lock alone, and Unlock waits for this connection's own answer.
 */
export function withRememberedHalves(drawn: MacHostState, kept: RememberedHostState | undefined): MacHostState {
  if (!kept) {
    return drawn
  }
  const display = drawn.display === 'unknown' ? (kept.display ?? 'unknown') : drawn.display
  const mute = drawn.mute === 'unknown' ? (kept.mute ?? 'unknown') : drawn.mute
  return display === drawn.display && mute === drawn.mute ? drawn : { ...drawn, display, mute }
}

/** `halves` laid over `base`; a half `halves` does not name keeps `base`'s. */
export function mergeRememberedHalves(
  base: RememberedHostState | null | undefined,
  halves: Partial<RememberedHostState>
): RememberedHostState {
  return {
    display: halves.display ?? base?.display ?? null,
    mute: halves.mute ?? base?.mute ?? null
  }
}

/** The stored value, or the reason it cannot be used. */
function parseStored(raw: string): RememberedHostState | string {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return 'it is not JSON'
  }
  if (typeof value !== 'object' || value === null) {
    return 'it is not an object'
  }
  const { display, mute } = value as Record<string, unknown>
  if (display !== undefined && display !== null && display !== 'on' && display !== 'off') {
    return `display is ${JSON.stringify(display)}`
  }
  if (mute !== undefined && mute !== null && mute !== 'muted' && mute !== 'unmuted') {
    return `mute is ${JSON.stringify(mute)}`
  }
  return {
    display: (display ?? null) as RememberedHostState['display'],
    mute: (mute ?? null) as RememberedHostState['mute']
  }
}

/**
 * What `hostId` last said, or null when nothing was kept or it cannot be read. Never
 * rejects: an unreadable or malformed store means no memory, so the menu draws both
 * rows of each pair as it did before anything was kept, and says why in one line.
 */
export async function loadRememberedHostState(hostId: string): Promise<RememberedHostState | null> {
  let raw: string | null
  try {
    raw = await AsyncStorage.getItem(storageKey(hostId))
  } catch (error) {
    console.warn('[host-controls] could not read the remembered host state; the menu offers both rows of each pair', error)
    return null
  }
  if (raw === null) {
    return null
  }
  const parsed = parseStored(raw)
  if (typeof parsed === 'string') {
    console.warn(`[host-controls] ignored the remembered host state: ${parsed}`)
    return null
  }
  return parsed
}

// One write at a time per host, so two answers landing together cannot read the same
// old value and the later write drop the earlier one's half.
const writeChains = new Map<string, Promise<void>>()

function chained(hostId: string, step: () => Promise<void>): Promise<void> {
  const next = (writeChains.get(hostId) ?? Promise.resolve()).then(step, step)
  writeChains.set(hostId, next)
  void next.finally(() => {
    if (writeChains.get(hostId) === next) {
      writeChains.delete(hostId)
    }
  })
  return next
}

/** Keeps the halves the host named, over what was kept. Never rejects: a write that
 *  fails only means the next connection's first open offers both rows again. */
export function rememberHostStateHalves(hostId: string, halves: Partial<RememberedHostState>): Promise<void> {
  return chained(hostId, async () => {
    try {
      const kept = await loadRememberedHostState(hostId)
      const next = mergeRememberedHalves(kept, halves)
      if (kept && kept.display === next.display && kept.mute === next.mute) {
        return
      }
      await AsyncStorage.setItem(storageKey(hostId), JSON.stringify(next))
    } catch (error) {
      console.warn('[host-controls] could not save the remembered host state', error)
    }
  })
}

/** Drops what was kept for a host that was removed. Never rejects. */
export function forgetRememberedHostState(hostId: string): Promise<void> {
  return chained(hostId, async () => {
    try {
      await AsyncStorage.removeItem(storageKey(hostId))
    } catch (error) {
      console.warn('[host-controls] could not forget the remembered host state', error)
    }
  })
}
