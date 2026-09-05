import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { parseTerminalHudObservation, type TerminalHudObservation } from './mobile-terminal-hud-parse'

const HUD_POLL_MS = 5_000

/**
 * While chat covers a terminal, read its screen every few seconds and pull the
 * model/effort badge out of the Claude Code status line.
 *
 * Why polling `terminal.read`: chat pauses the terminal stream, the hook report
 * has no effort, and the host's mobile allowlist exposes no transcript read.
 * A screen read is cheap (one bounded RPC) and is exactly what the user sees.
 */
export function useMobileTerminalHudObservation(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  /** Changes whenever the active terminal changes; restarts the poll. */
  handleKey: string | null
}): {
  observation: TerminalHudObservation | null
  /** Re-read the screen now; resolves with what it saw (null on failure). */
  refresh: () => Promise<TerminalHudObservation | null>
} {
  const { client, enabled, handleRef, handleKey } = args
  const [observation, setObservation] = useState<TerminalHudObservation | null>(null)
  const readRef = useRef<() => Promise<TerminalHudObservation | null>>(async () => null)

  useEffect(() => {
    setObservation(null)
    if (!client || !enabled || !handleKey) {
      return
    }
    let active = true
    let inFlight = false
    const read = async (): Promise<TerminalHudObservation | null> => {
      const handle = handleRef.current
      if (!handle || inFlight) {
        return null
      }
      inFlight = true
      try {
        const response = await client.sendRequest('terminal.read', { terminal: handle, screen: true })
        if (!active || !response.ok) {
          return null
        }
        const terminal = (response as RpcSuccess).result as {
          terminal?: { tail?: unknown; lines?: unknown }
        }
        const raw = terminal.terminal?.tail ?? terminal.terminal?.lines
        const lines = Array.isArray(raw) ? raw.filter((line): line is string => typeof line === 'string') : []
        const next = parseTerminalHudObservation(lines)
        if (next) {
          setObservation((current) =>
            current &&
            current.modelId === next.modelId &&
            current.effort === next.effort &&
            current.modelLabel === next.modelLabel &&
            current.permissionMode === next.permissionMode &&
            current.context?.usedPercent === next.context?.usedPercent &&
            current.context?.usedLabel === next.context?.usedLabel
              ? current
              : next
          )
        }
        return next
      } catch {
        // A failed screen read just leaves the last observation in place.
        return null
      } finally {
        inFlight = false
      }
    }
    readRef.current = read
    void read()
    const timer = setInterval(() => void read(), HUD_POLL_MS)
    return () => {
      active = false
      readRef.current = async () => null
      clearInterval(timer)
    }
  }, [client, enabled, handleKey, handleRef])

  // Why: a Shift+Tab from the phone changes the footer at once; waiting up to
  // 5s for the next poll would make the mode pill look stuck.
  const refresh = useCallback(() => readRef.current(), [])

  return { observation, refresh }
}
