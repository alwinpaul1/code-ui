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

export async function readHeldFloors(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    // A corrupt or unreadable record must not stop the session opening.
    return []
  }
}

async function writeHeldFloors(handles: readonly string[]): Promise<void> {
  try {
    if (handles.length === 0) {
      await AsyncStorage.removeItem(KEY)
      return
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(Array.from(new Set(handles))))
  } catch {
    // Best effort: losing the record costs a stuck desk, not a broken session.
  }
}

export async function rememberHeldFloor(handle: string): Promise<void> {
  const current = await readHeldFloors()
  if (current.includes(handle)) {
    return
  }
  await writeHeldFloors([...current, handle])
}

export async function forgetHeldFloor(handle: string): Promise<void> {
  const current = await readHeldFloors()
  if (!current.includes(handle)) {
    return
  }
  await writeHeldFloors(current.filter((entry) => entry !== handle))
}
