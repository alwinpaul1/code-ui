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

/** The composer's hint for its state: what blocks input, else what a send does. */
export function composerPlaceholder(
  lockReason: ReturnType<typeof useMobileNativeChatInputLock>,
  agentWorking: boolean | undefined
): string {
  if (lockReason === 'disconnected') {
    return 'Reconnecting…'
  }
  if (lockReason === 'waiting') {
    return 'Waiting for terminal…'
  }
  // The Claude app's own (`ccr_input_placeholder_existing_session` / `_queue`, 1.261009.20).
  return agentWorking ? 'Queue a message…' : 'Type / for commands'
}

/** The composer's lock for the tab on screen. An agent-session tab is locked by the relay alone.
 *  A terminal tab is locked by its input lease ("Reconnecting…", "Waiting for terminal…"), except
 *  while a matched Claude tab's Anthropic lane is live (use-ccr-control-lane.ts): its text sends
 *  are a POST into the session then, which needs no terminal, and the Claude app locks its
 *  composer on none of this (parity audit 2026-10-15, gap 1). */
export function nativeChatComposerLockReason(input: {
  agentSessionTab: boolean
  relayConnected: boolean
  leaseLock: 'waiting' | 'disconnected' | null
  anthropicLaneLive: boolean
}): 'waiting' | 'disconnected' | null {
  if (input.agentSessionTab) {
    return input.relayConnected ? null : 'disconnected'
  }
  return input.anthropicLaneLive ? null : input.leaseLock
}
