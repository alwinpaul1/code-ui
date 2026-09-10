import { useEffect, useState } from 'react'

/** How long a lease edge must hold before the composer believes it. */
const INPUT_LOCK_SETTLE_MS = 600

/** The composer's lock reason, settled on both edges.
 *
 *  Why settle: a dead PTY emits subscribed then end, and taking that lease at
 *  face value flashes the composer enabled for a frame between the two. */
export function useMobileNativeChatInputLock(inputLockReason: string | null | undefined) {
  const rawLockReason = inputLockReason ?? null
  const rawLockHeld = rawLockReason !== null
  const [lockHeld, setLockHeld] = useState(false)
  useEffect(() => {
    if (rawLockHeld === lockHeld) {
      return
    }
    const timer = setTimeout(() => setLockHeld(rawLockHeld), INPUT_LOCK_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [lockHeld, rawLockHeld])
  return lockHeld ? (rawLockReason ?? 'waiting') : null
}
