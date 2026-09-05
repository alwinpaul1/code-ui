// Codex states its context window only in the `/status` box, never in the
// footer, so the ring has nothing to read unless something runs `/status`.
// Run it when a turn ends (the figure changed) and once when a Codex chat
// opens, then re-read the screen so the ring picks the new figure up.
import { useEffect, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { createCodexPickerIo } from './codex-picker-apply'
import { isCodexIdle } from './codex-picker-screen'

const SETTLE_AFTER_TURN_MS = 700
const STATUS_RENDER_MS = 1_500

export function useCodexStatusPoll(args: {
  client: RpcClient | null
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
      void (async () => {
        const handle = handleRef.current
        if (!active || !handle) {
          return
        }
        const io = createCodexPickerIo({
          client,
          terminal: handle,
          deviceToken: deviceTokenRef.current
        })
        // Why the idle check: while a turn runs, "/status" would be queued as a
        // prompt to the model instead of running as a command.
        if (!isCodexIdle(await io.readScreen())) {
          return
        }
        if (!(await io.typeCommand('/status'))) {
          return
        }
        await io.sleep(STATUS_RENDER_MS)
        if (active) {
          await refreshHud()
        }
      })()
    }, SETTLE_AFTER_TURN_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [client, deviceTokenRef, enabled, handleKey, handleRef, refreshHud, working])
}
