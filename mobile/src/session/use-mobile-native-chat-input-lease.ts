import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileNativeChatInputLockReason } from './MobileNativeChatView'

/** How long a connected chat waits for the host's `subscribed` acknowledgement
 *  before the composer stops treating the lease as missing. A healthy host acks
 *  within a round trip; past this the phone lets the send go and the host's own
 *  terminal.send verdict decides, instead of "Waiting for terminal…" forever. */
export const NATIVE_CHAT_INPUT_LEASE_GRACE_MS = 6_000

export function useMobileNativeChatInputLease(args: {
  activeHandle: string | null
  connected: boolean
}): {
  ready: boolean
  readyRef: { readonly current: boolean }
  lockReason: MobileNativeChatInputLockReason | null
  markReady: (handle: string) => void
  /** Returns whether the clear actually dropped a lease — callers use a no-op clear
   *  to detect a teardown React would otherwise never see (#10681). */
  clear: (handle?: string) => boolean
} {
  const [readyHandles, setReadyHandles] = useState<Set<string>>(new Set())
  // Mirrors the state so `clear` can report synchronously whether it changed anything.
  const readyHandlesRef = useRef(readyHandles)
  // Why: a handle whose acknowledgement never came (seen on a Windows host) is
  // presumed leased after the grace period; a real refusal still surfaces from
  // the host on send, so the user gets a retryable error instead of a dead arrow.
  const [presumedHandle, setPresumedHandle] = useState<string | null>(null)
  const acknowledged = args.activeHandle != null && readyHandles.has(args.activeHandle)
  const ready = acknowledged || (args.activeHandle != null && presumedHandle === args.activeHandle)
  useEffect(() => {
    if (!args.connected || args.activeHandle == null || acknowledged) {
      setPresumedHandle(null)
      return
    }
    const handle = args.activeHandle
    const timer = setTimeout(() => setPresumedHandle(handle), NATIVE_CHAT_INPUT_LEASE_GRACE_MS)
    return () => clearTimeout(timer)
  }, [acknowledged, args.activeHandle, args.connected])
  // Why: absence of an acknowledgement proves only that setup is still pending;
  // the protocol does not report evidence that another client owns the floor.
  const lockReason: MobileNativeChatInputLockReason | null = !args.connected
    ? 'disconnected'
    : ready
      ? null
      : 'waiting'
  const readyRef = useRef(ready)
  readyRef.current = ready
  const replace = useCallback((next: Set<string>) => {
    readyHandlesRef.current = next
    setReadyHandles(next)
  }, [])
  useEffect(() => {
    if (!args.connected && readyHandlesRef.current.size > 0) {
      replace(new Set())
    }
  }, [args.connected, replace])
  const markReady = useCallback(
    (handle: string) => {
      if (readyHandlesRef.current.has(handle)) {
        return
      }
      replace(new Set(readyHandlesRef.current).add(handle))
    },
    [replace]
  )
  const clear = useCallback(
    (handle?: string): boolean => {
      const current = readyHandlesRef.current
      if (handle === undefined) {
        if (current.size === 0) {
          return false
        }
        replace(new Set())
        return true
      }
      if (!current.has(handle)) {
        return false
      }
      const next = new Set(current)
      next.delete(handle)
      replace(next)
      return true
    },
    [replace]
  )
  return {
    ready,
    readyRef,
    lockReason,
    markReady,
    clear
  }
}
