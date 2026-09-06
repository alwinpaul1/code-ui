import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import {
  parseCodexHudObservation,
  parseTerminalHudObservation,
  type TerminalHudObservation
} from './mobile-terminal-hud-parse'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import { permissionOptionsFromScreen } from './mobile-terminal-permission-options'
import type { MobileChatPermission } from './mobile-native-chat-permission'

const HUD_POLL_MS = 5_000

/**
 * While chat covers a terminal, read its screen for live controls and queued
 * messages: once per second while active, every five seconds while idle.
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
  active?: boolean
  agent?: string | null
}): {
  permissionDismissed: boolean
  queuedMessages: string[]
  observation: TerminalHudObservation | null
  /** Re-read the screen now; resolves with what it saw (null on failure). */
  refresh: () => Promise<TerminalHudObservation | null>
  /** Claude Code's permission dialog options as drawn on screen, or null. */
  dialogOptions: MobileChatPermission['options'] | null
  terminalPermission: MobileChatPermission | null
} {
  const { client, enabled, handleRef, handleKey, agent } = args
  const queueScopeRef = useRef<string | null>(null)
  const [permissionDismissed, setPermissionDismissed] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [observation, setObservation] = useState<TerminalHudObservation | null>(null)
  const [dialogOptions, setDialogOptions] = useState<MobileChatPermission['options'] | null>(null)
  const [terminalPermission, setTerminalPermission] = useState<MobileChatPermission | null>(null)
  const readRef = useRef<() => Promise<TerminalHudObservation | null>>(async () => null)

  useEffect(() => {
    setPermissionDismissed(false)
    setQueuedMessages((current) => (current.length ? [] : current))
    setObservation(null)
    setDialogOptions(null)
    setTerminalPermission(null)
    if (!client || !enabled || !handleKey) {
      return
    }
    let sawPermission = false
    let active = true
    let inFlight = false
    const read = async (): Promise<TerminalHudObservation | null> => {
      const handle = handleRef.current
      if (!handle || inFlight) {
        return null
      }
      inFlight = true
      try {
        const response = await client.sendRequest(
          'terminal.read',
          {
            terminal: handle,
            screen: true
          },
          { timeoutMs: 2500, budgetSpansConnect: true }
        )
        if (!active || handle !== handleRef.current || !response.ok) {
          return null
        }
        const terminal = (response as RpcSuccess).result as {
          terminal?: { tail?: unknown; lines?: unknown }
        }
        const raw = terminal.terminal?.tail ?? terminal.terminal?.lines
        const lines = Array.isArray(raw)
          ? raw.filter((line): line is string => typeof line === 'string')
          : []
        const permission =
          agent === 'codex'
            ? codexPermissionFromScreen(lines)
            : agent === 'claude' || agent === 'openclaude'
              ? claudePermissionFromScreen(lines)
              : null
        const queued =
          agent === 'codex'
            ? codexQueuedMessagesFromScreen(lines)
            : agent === 'claude' || agent === 'openclaude'
              ? queuedMessagesFromScreen(lines)
              : []
        queueScopeRef.current = handleKey
        setQueuedMessages((current) =>
          JSON.stringify(current) === JSON.stringify(queued) ? current : queued
        )
        if (permission) {
          sawPermission = true
          setPermissionDismissed(false)
        } else if (sawPermission) {
          setPermissionDismissed(true)
        }
        setTerminalPermission((current) =>
          JSON.stringify(current) === JSON.stringify(permission) ? current : permission
        )
        const dialog = permission?.options ?? permissionOptionsFromScreen(lines)
        setDialogOptions((current) =>
          JSON.stringify(current) === JSON.stringify(dialog) ? current : dialog
        )
        const parsed =
          agent === 'codex' ? parseCodexHudObservation(lines) : parseTerminalHudObservation(lines)
        const next = parsed
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
    return () => {
      active = false
      readRef.current = async () => null
    }
  }, [agent, client, enabled, handleKey, handleRef])

  // Activity changes the cadence, not the observed session. Resetting the read
  // effect here made approval cards disappear and reappear on status updates.
  useEffect(() => {
    if (!client || !enabled || !handleKey) {
      return
    }
    const timer = setInterval(() => void readRef.current(), args.active ? 1000 : HUD_POLL_MS)
    return () => clearInterval(timer)
  }, [args.active, client, enabled, handleKey])

  // Why: a Shift+Tab from the phone changes the footer at once; waiting up to
  // 5s for the next poll would make the mode pill look stuck.
  const refresh = useCallback(() => readRef.current(), [])

  return {
    observation,
    refresh,
    dialogOptions,
    terminalPermission,
    queuedMessages: enabled && queueScopeRef.current === handleKey ? queuedMessages : [],
    permissionDismissed
  }
}
