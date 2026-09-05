import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import {
  parseCodexHudObservation,
  parseTerminalHudObservation,
  type TerminalHudObservation
} from './mobile-terminal-hud-parse'
import { permissionOptionsFromScreen } from './mobile-terminal-permission-options'
import type { MobileChatPermission } from './mobile-native-chat-permission'

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
  /** Codex states model/effort/mode differently and its host agent-status is
   *  mislabelled 'claude', so a codex tab must parse only the Codex footer —
   *  never the Claude bracket badge, which would leak a Claude model onto it. */
  agent?: string | null
}): {
  observation: TerminalHudObservation | null
  /** Re-read the screen now; resolves with what it saw (null on failure). */
  refresh: () => Promise<TerminalHudObservation | null>
  /** Claude Code's permission dialog options as drawn on screen, or null. */
  dialogOptions: MobileChatPermission['options'] | null
} {
  const { client, enabled, handleRef, handleKey, agent } = args
  const [observation, setObservation] = useState<TerminalHudObservation | null>(null)
  const observationRef = useRef<TerminalHudObservation | null>(null)
  observationRef.current = observation
  const [dialogOptions, setDialogOptions] = useState<MobileChatPermission['options'] | null>(null)
  const readRef = useRef<() => Promise<TerminalHudObservation | null>>(async () => null)

  useEffect(() => {
    setObservation(null)
    setDialogOptions(null)
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
        const response = await client.sendRequest('terminal.read', {
          terminal: handle,
          screen: true
        })
        if (!active || !response.ok) {
          return null
        }
        const terminal = (response as RpcSuccess).result as {
          terminal?: { tail?: unknown; lines?: unknown }
        }
        const raw = terminal.terminal?.tail ?? terminal.terminal?.lines
        const lines = Array.isArray(raw)
          ? raw.filter((line): line is string => typeof line === 'string')
          : []
        const dialog = permissionOptionsFromScreen(lines)
        setDialogOptions((current) =>
          JSON.stringify(current) === JSON.stringify(dialog) ? current : dialog
        )
        const parsed =
          agent === 'codex' ? parseCodexHudObservation(lines) : parseTerminalHudObservation(lines)
        // Why: the /status box scrolls away but the plan does not change; keep
        // the last one seen rather than blanking the sheet caption.
        const next: TerminalHudObservation | null =
          parsed && parsed.accountPlan == null && observationRef.current?.accountPlan
            ? { ...parsed, accountPlan: observationRef.current.accountPlan }
            : parsed
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
  }, [agent, client, enabled, handleKey, handleRef])

  // Why: a Shift+Tab from the phone changes the footer at once; waiting up to
  // 5s for the next poll would make the mode pill look stuck.
  const refresh = useCallback(() => readRef.current(), [])

  return { observation, refresh, dialogOptions }
}
