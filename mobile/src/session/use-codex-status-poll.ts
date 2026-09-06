// Codex states its context window only in the `/status` box, never in the
// footer, so the ring has nothing to read unless something runs `/status`.
// Run it when a turn ends (the figure changed) and once when a Codex chat
// opens, then re-read the screen so the ring picks the new figure up.
import { useEffect, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { createCodexPickerIo } from './codex-picker-apply'
import { isCodexIdle, isCodexWorking, parseCodexPickerScreen } from './codex-picker-screen'
import { withCodexTerminalLock } from './codex-terminal-lock'
import {
  codexVisibleModelsKey,
  hasScrapedCodexVisibleModels,
  scrapeCodexVisibleModels
} from './codex-visible-models'
import { parseCodexStatusContext } from './mobile-terminal-hud-parse'

const SETTLE_AFTER_TURN_MS = 700
// The /status box is on screen well under a second; poll for its context
// line instead of sleeping a fixed 1.5 s that held the terminal lock (and any
// pick queued behind it) for the whole time.
const STATUS_POLL_MS = 150
const STATUS_TIMEOUT_MS = 2_000

export function useCodexStatusPoll(args: {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  /** Codex chat is showing over a live terminal. */
  enabled: boolean
  working: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  /** Restarts the "once on open" poll when the terminal changes. */
  handleKey: string | null
  refreshHud: () => Promise<unknown>
}): void {
  const { client, enabled, working, handleRef, deviceTokenRef, handleKey, refreshHud } = args
  const { hostId, worktreeId } = args
  const previousWorking = useRef(working)
  const polledOnOpen = useRef<string | null>(null)

  useEffect(() => {
    const wasWorking = previousWorking.current
    previousWorking.current = working
    if (!client || !enabled || !handleKey) {
      return
    }
    const turnEnded = wasWorking && !working
    const firstOpen = polledOnOpen.current !== handleKey && !working
    if (!turnEnded && !firstOpen) {
      return
    }
    polledOnOpen.current = handleKey
    let active = true
    const timer = setTimeout(() => {
      const handle = handleRef.current
      if (!active || !handle) {
        return
      }
      void withCodexTerminalLock(handle, async () => {
        if (!active) {
          return
        }
        const io = createCodexPickerIo({
          client,
          terminal: handle,
          deviceToken: deviceTokenRef.current
        })
        // Self-heal: a picker left open (an apply cut off by a disconnect or a
        // backgrounded app) swallows every send. Escape it first — never while
        // a turn runs, since Esc there interrupts the agent.
        let lines = await io.readScreen()
        for (let attempt = 0; attempt < 3 && parseCodexPickerScreen(lines); attempt += 1) {
          if (!active || isCodexWorking(lines)) {
            return
          }
          await io.sendKey('\x1b')
          await io.sleep(400)
          lines = await io.readScreen()
        }
        // Why the idle check: while a turn runs, "/status" would be queued as a
        // prompt to the model instead of running as a command.
        if (!isCodexIdle(lines)) {
          return
        }
        // Learn which models this session can pick by reading Codex's own picker
        // (the host probe lists hidden ones and misses some). Retried on every
        // idle open / turn end until it succeeds once.
        const visibleKey = codexVisibleModelsKey(hostId, worktreeId)
        if (!hasScrapedCodexVisibleModels(visibleKey)) {
          await scrapeCodexVisibleModels(io, visibleKey)
          if (!active) {
            return
          }
        }
        if (!(await io.typeCommand('/status'))) {
          return
        }
        const deadline = io.now() + STATUS_TIMEOUT_MS
        while (active && io.now() < deadline) {
          await io.sleep(STATUS_POLL_MS)
          if (parseCodexStatusContext(await io.readScreen())) {
            break
          }
        }
        if (active) {
          await refreshHud()
        }
      })
    }, SETTLE_AFTER_TURN_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    client,
    deviceTokenRef,
    enabled,
    handleKey,
    handleRef,
    hostId,
    refreshHud,
    working,
    worktreeId
  ])
}
