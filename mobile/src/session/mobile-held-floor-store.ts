import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Which terminals this phone has taken the presence floor on, remembered
 * across process death.
 *
 * Measured on a Galaxy S23: with the phone driving a terminal at phone dims,
 * force-stopping the app left the desk at COLS=51 with its keyboard paused,
 * and it was still there 60 seconds after the process was confirmed dead. The
 * host does not hand the floor back when a mobile client disconnects, and it
 * exposes no way to ask which floors a device holds — `orca terminal show`
 * reports connected and writable but nothing about display mode, and writable
 * stays true under a held floor.
 *
 * A killed process cannot send a release, so the only thing left is to write
 * down what we hold while we still can, and hand it back the next time the app
 * runs. That does not help a desk whose phone never comes back; nothing can,
 * short of a host change, and this repo does not change the host.
 */
const KEY = 'mobile.terminal.held-floors.v1'

/** Handles to hand back on startup: everything remembered that the phone is
 *  not driving right now. Split out from storage so the decision is testable
 *  on its own. */
export function heldFloorsToRelease(args: {
  remembered: readonly string[]
  drivingNow: readonly string[]
}): string[] {
  const driving = new Set(args.drivingNow)
  return Array.from(new Set(args.remembered)).filter((handle) => !driving.has(handle))
}

/**
 * Every floor is in one list under one key, so each change reads the list,
 * changes it and writes it back. Two things lost a floor that way (review of
 * 2026-09-30), and a lost floor is never handed back after process death, so
 * the desk stays at phone size with its keyboard paused:
 *
 * - The session view fires these calls without waiting. Unserialised, two in
 *   the same tick both read the old list and the later write won. So every
 *   call waits here for the one asked before it to settle.
 * - A read the store refused came back as an empty list, and the change was
 *   written over the stored one. Now a refused read writes nothing; the
 *   change waits in `pending` and is written by the first call whose read
 *   succeeds, on top of what storage holds. A refused write waits there too.
 *
 * Why not one key per floor, which needs no read at all: finding them again
 * takes `getAllKeys`, which the mirrored-storage census allows in one module
 * only (mirrored-storage-write-path.test.ts), so that a module listing the
 * store's keys cannot wipe the ones the page mirrors.
 */
let queue: Promise<unknown> = Promise.resolve()
/** Changes storage has not taken yet, oldest first; the later change to a
 *  handle replaces the earlier one. */
const pending = new Map<string, 'take' | 'give'>()

function inOrder<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation)
  queue = run.catch(() => undefined)
  return run
}

function parseHeldFloors(raw: string | null): string[] {
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    // Corrupt: nothing in it can be handed back, so the next write replaces it.
    return []
  }
}

/** The stored list, or the store's refusal. One more read covers a store
 *  that refused once. */
async function readStored(): Promise<{ handles: string[] } | { refused: unknown }> {
  let refused: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { handles: parseHeldFloors(await AsyncStorage.getItem(KEY)) }
    } catch (error) {
      refused = error
    }
  }
  return { refused }
}

function withPending(stored: readonly string[]): string[] {
  const held = new Set(stored)
  for (const [handle, change] of pending) {
    if (change === 'take') {
      held.add(handle)
    } else {
      held.delete(handle)
    }
  }
  return Array.from(held)
}

/** Writes `pending` on top of the stored list. Never rejects: a store that
 *  refuses leaves one line and keeps the change for the next call. */
async function landPending(): Promise<void> {
  const read = await readStored()
  if ('refused' in read) {
    console.warn(
      '[storage] could not save the held terminal floors: the stored ones could not be read, so the change waits until they can be',
      read.refused
    )
    return
  }
  const next = withPending(read.handles)
  const unchanged =
    next.length === read.handles.length && next.every((handle, index) => handle === read.handles[index])
  try {
    if (!unchanged) {
      await (next.length === 0 ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, JSON.stringify(next)))
    }
    // Every change is made inside the queue, so none arrived during the write.
    pending.clear()
  } catch (error) {
    console.warn(`[storage] could not ${next.length === 0 ? 'erase' : 'save'} the held terminal floors`, error)
  }
}

function change(handle: string, kind: 'take' | 'give'): Promise<void> {
  return inOrder(() => {
    pending.delete(handle)
    pending.set(handle, kind)
    return landPending()
  })
}

/** Never throws: an unreadable store hands nothing back this launch, says so,
 *  and keeps its record for the next one. */
export function readHeldFloors(): Promise<string[]> {
  return inOrder(async () => {
    if (pending.size > 0) {
      await landPending()
    }
    const read = await readStored()
    if ('refused' in read) {
      console.warn('[storage] could not read the held terminal floors', read.refused)
      return []
    }
    return withPending(read.handles)
  })
}

/** Never rejects: losing the record costs a stuck desk, not a broken session. */
export function rememberHeldFloor(handle: string): Promise<void> {
  return change(handle, 'take')
}

/** Never rejects; a hand-back it could not record is handed back again on the
 *  next launch. */
export function forgetHeldFloor(handle: string): Promise<void> {
  return change(handle, 'give')
}

/** Test-only: a fresh process, with nothing queued and nothing waiting. */
export function resetHeldFloorStoreForTests(): void {
  queue = Promise.resolve()
  pending.clear()
}
