import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Every tail terminal this phone has opened and not yet closed, by host,
 * kept in storage so the NEXT process can close what this one left behind.
 *
 * Why: the app swiped away, or a close that never landed, leaves a live
 * `tail -F` tab on the desktop, and the next process cannot recognise it —
 * the host adopts a phone-created terminal into its strip as "Terminal 3",
 * dropping the title it was created with (device, 2026-09-19), so the title
 * sweep sees nothing. The handle is the one thing that survives.
 *
 * Fail-open: unreadable storage means an empty ledger, and an unwritable one
 * only costs the cleanup of a later crash.
 */
const STORAGE_KEY = 'orca:transcriptTailHandles'
/** Per host. Old entries fall off; a handle from days ago names nothing. */
const CAP = 16

type Ledger = Record<string, string[]>

let memory: Ledger | null = null
let loading: Promise<Ledger> | null = null
let writeBarrier: Promise<void> = Promise.resolve()

async function load(): Promise<Ledger> {
  if (memory) {
    return memory
  }
  loading ??= (async () => {
    let parsed: Ledger = {}
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      const value = raw ? (JSON.parse(raw) as unknown) : null
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [host, handles] of Object.entries(value as Record<string, unknown>)) {
          if (Array.isArray(handles)) {
            parsed[host] = handles.filter((h): h is string => typeof h === 'string')
          }
        }
      }
    } catch {
      parsed = {}
    }
    // Writes that landed while the read was in flight are newer. (The
    // early return above narrows `memory` to null for the compiler; it is
    // not null once a write has raced the read.)
    const current: Ledger | null = memory as Ledger | null
    const merged: Ledger = current ? { ...parsed, ...current } : parsed
    memory = merged
    loading = null
    return merged
  })()
  return loading
}

function persist(): void {
  const snapshot = JSON.stringify(memory ?? {})
  writeBarrier = writeBarrier
    .then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot))
    .catch(() => undefined)
}

/** Record a terminal this process just opened. */
export async function recordTranscriptTailHandle(hostId: string, handle: string): Promise<void> {
  const ledger = await load()
  const handles = (ledger[hostId] ?? []).filter((h) => h !== handle)
  handles.push(handle)
  ledger[hostId] = handles.slice(-CAP)
  persist()
}

/** Forget a terminal that is closed on the host. */
export async function forgetTranscriptTailHandle(hostId: string, handle: string): Promise<void> {
  const ledger = await load()
  const handles = ledger[hostId]
  if (!handles || !handles.includes(handle)) {
    return
  }
  ledger[hostId] = handles.filter((h) => h !== handle)
  persist()
}

/** Every handle this phone has opened on a host and not yet closed. */
export async function recordedTranscriptTailHandles(hostId: string): Promise<readonly string[]> {
  const ledger = await load()
  return ledger[hostId] ?? []
}

export function resetTranscriptTailLedgerForTests(): void {
  memory = null
  loading = null
  writeBarrier = Promise.resolve()
}
