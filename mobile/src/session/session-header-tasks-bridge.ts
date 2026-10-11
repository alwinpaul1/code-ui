import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * The chat's Background tasks, as the session header's menu sees them (parity gap G35).
 *
 * The sheet and the running count live in `MobileNativeChatTasksProvider`, inside the chat view;
 * the header sits above it in another subtree. The provider publishes its count and its opener
 * here while it is mounted, and takes them back when it unmounts, so the header offers the entry
 * only while there is a sheet to open. The newest provider owns the slot; an older one that
 * unmounts late cannot clear a newer one.
 */
type Slot = { owner: object; runningCount: number; open: () => void }

let slot: Slot | null = null
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

export type HeaderBackgroundTasks = { runningCount: number; open: (() => void) | null }

const NONE: HeaderBackgroundTasks = { runningCount: 0, open: null }
let snapshot: HeaderBackgroundTasks = NONE

function publish(next: Slot | null): void {
  slot = next
  snapshot = next ? { runningCount: next.runningCount, open: next.open } : NONE
  notify()
}

/** The header's read: how many tasks run, and how to open their sheet (null while no chat). */
export function useHeaderBackgroundTasks(): HeaderBackgroundTasks {
  return useSyncExternalStore(subscribe, () => snapshot, () => NONE)
}

/** The tasks provider's side: publishes while mounted, retracts on unmount. */
export function useBridgeBackgroundTasksToHeader(runningCount: number, open: () => void): void {
  const owner = useRef<object>({})
  useEffect(() => {
    const me = owner.current
    if (slot?.owner !== me || slot.runningCount !== runningCount || slot.open !== open) {
      publish({ owner: me, runningCount, open })
    }
  }, [runningCount, open])
  useEffect(() => {
    const me = owner.current
    return () => {
      if (slot?.owner === me) {
        publish(null)
      }
    }
  }, [])
}
