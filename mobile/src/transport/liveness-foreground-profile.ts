import type { RpcClient } from './rpc-client'
import { LIVENESS_IDLE_MS, LIVENESS_PROBE_TIMEOUT_MS } from './rpc-session-liveness-watchdog'

export type LivenessProfile = { idleProbeMs: number | null; probeTimeoutMs: number }

/** What a client exposes about its liveness probe; the header reads it. */
export type LivenessProbingSurface = {
  isLivenessProbing(): boolean
  onLivenessProbingChange(listener: (probing: boolean) => void): () => void
  setLivenessForeground(foreground: boolean): void
}

// Direct is unbilled, so only the idle interval shortens; the timeout stays.
export const DIRECT_LIVENESS_PROFILES = {
  foreground: { idleProbeMs: 10_000, probeTimeoutMs: LIVENESS_PROBE_TIMEOUT_MS },
  background: { idleProbeMs: LIVENESS_IDLE_MS, probeTimeoutMs: LIVENESS_PROBE_TIMEOUT_MS }
}

/**
 * Two leashes per transport. Backgrounded, probes stay rare — a relay probe
 * is billed and nobody is looking. Foregrounded, the user is reading a header
 * that says "Connected", and measured on a Galaxy S23 the relay took 38 s
 * (30 s idle + 2 × 4 s) to notice a dead socket while it said so.
 */
export function livenessProfileFor(
  foreground: boolean,
  profiles: { foreground: LivenessProfile; background: LivenessProfile }
): LivenessProfile {
  return foreground ? profiles.foreground : profiles.background
}

/**
 * Probing follows whichever physical session is live, and the header's
 * listeners must outlive session swaps. This forwards one session's probing
 * changes to a stable listener set and re-applies the foreground leash to each
 * new session as it becomes active.
 */
export function createLivenessProbingRelay(initial: RpcClient) {
  const listeners = new Set<(probing: boolean) => void>()
  let foreground = true
  let detach: (() => void) | null = null
  let session: RpcClient = initial
  const attach = (next: RpcClient): void => {
    detach?.()
    session = next
    next.setLivenessForeground?.(foreground)
    detach =
      next.onLivenessProbingChange?.((probing) => {
        for (const listener of listeners) {
          listener(probing)
        }
      }) ?? null
  }
  attach(initial)
  const surface: LivenessProbingSurface = {
    isLivenessProbing: () => session.isLivenessProbing?.() ?? false,
    onLivenessProbingChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setLivenessForeground(next) {
      foreground = next
      session.setLivenessForeground?.(next)
    }
  }
  return { attach, surface }
}
