import AsyncStorage from '@react-native-async-storage/async-storage'
import { barrierAfterWrite } from './refused-write-log'

const KEY = 'orca:remoteControlNewClaudeSessions'

/** Remote Control for the Claude sessions this app starts. On unless the user turned it off
 *  (2026-10-15: "make all sessions from our system have RC on by default"). */
export const DEFAULT_REMOTE_CONTROL_NEW_SESSIONS = true

let memory: boolean | null = null
let saveGeneration = 0
let writeBarrier: Promise<void> | null = null
const listeners = new Set<() => void>()

function setMemory(value: boolean): void {
  if (memory === value) {
    return
  }
  memory = value
  for (const listener of listeners) {
    listener()
  }
}

function readWord(raw: string | null): boolean | null {
  return raw === 'on' ? true : raw === 'off' ? false : null
}

/** The last loaded or saved value, or null before the first read. */
export function peekRemoteControlNewSessions(): boolean | null {
  return memory
}

export function subscribeRemoteControlNewSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reads the stored value into memory. Storage trouble reads as the default (on): a launch that
 *  cannot read the switch must not silently drop Remote Control. */
export async function loadRemoteControlNewSessions(): Promise<boolean> {
  await writeBarrier
  const generation = saveGeneration
  let raw: string | null = null
  try {
    raw = await AsyncStorage.getItem(KEY)
  } catch {
    raw = null
  }
  if (generation !== saveGeneration && memory !== null) {
    return memory
  }
  const value = readWord(raw) ?? DEFAULT_REMOTE_CONTROL_NEW_SESSIONS
  setMemory(value)
  return value
}

export function saveRemoteControlNewSessions(enabled: boolean): Promise<void> {
  saveGeneration += 1
  setMemory(enabled)
  const write = (writeBarrier ?? Promise.resolve()).then(() =>
    AsyncStorage.setItem(KEY, enabled ? 'on' : 'off')
  )
  const barrier = barrierAfterWrite(write, 'Remote Control for new Claude sessions', 'save')
  writeBarrier = barrier
  void barrier.then(() => {
    if (writeBarrier === barrier) {
      writeBarrier = null
    }
  })
  return write
}

export function resetRemoteControlPreferenceMemoryForTests(): void {
  memory = null
  saveGeneration = 0
  writeBarrier = null
  listeners.clear()
}
