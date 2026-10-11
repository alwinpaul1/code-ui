import { useCallback, type RefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { buildTerminalSendParams, TERMINAL_INPUT_SEND_OPTIONS } from '../terminal/terminal-send-request'
import { terminalInputSend } from '../terminal/mobile-terminal-operations'
import type { ClaudeBackgroundStopTarget } from './claude-background-dialog'
import { stopClaudeBackgroundTask, type ClaudeBackgroundStopIo } from './claude-background-task-stop'
import { MOBILE_NATIVE_CHAT_SCREEN_READ_MS } from './mobile-native-chat-screen-read'
import { replyIsScreen, terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'
import {
  acquireMobileNativeChatTerminalWrite,
  mobileNativeChatTerminalWriteOwner,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

const KEY_TIMEOUT_MS = 5_000

/** The terminal tab's Stop, through Claude's own Background dialog
 *  (claude-background-task-stop.ts). One drive per terminal at a time, and never
 *  woven into a chat send: it holds the same write lock a send takes. */
export type ClaudeTerminalTaskStop = (
  taskId: string,
  report?: (message: string) => void,
  target?: ClaudeBackgroundStopTarget
) => Promise<boolean>

export function createClaudeBackgroundStopIo(args: { client: RpcClient; terminal: string; deviceToken: string | null }): ClaudeBackgroundStopIo {
  const { client, terminal, deviceToken } = args
  return {
    // Only a reply that names itself the screen: an older Orca answers a screen
    // read with the stream's tail, old repaints that do not show where a key
    // would land now (replyIsScreen in mobile-terminal-ask-about-screen-operations.ts).
    readScreen: async () => {
      try {
        const reply = await terminalScreenLinesRead.request(client, { terminal, screen: true }, { timeoutMs: MOBILE_NATIVE_CHAT_SCREEN_READ_MS })
        return replyIsScreen(reply) ? terminalScreenLinesRead.interpret(reply) : null
      } catch {
        return null
      }
    },
    sendKey: async (keys) => {
      try {
        const reply = await terminalInputSend.request(client, buildTerminalSendParams({ terminal, text: keys, enter: false, deviceToken }), {
          ...TERMINAL_INPUT_SEND_OPTIONS,
          timeoutMs: KEY_TIMEOUT_MS
        })
        return terminalInputSend.interpret(reply) === true
      } catch {
        return false
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now()
  }
}

const turns = new Map<string, Promise<unknown>>()

/** Runs `drive` after every drive already queued for `terminal`. */
function inTurn<T>(terminal: string, drive: () => Promise<T>): Promise<T> {
  const previous = turns.get(terminal) ?? Promise.resolve()
  const next = previous.then(drive, drive)
  const settled = next.catch(() => undefined)
  turns.set(terminal, settled)
  void settled.then(() => {
    if (turns.get(terminal) === settled) {
      turns.delete(terminal)
    }
  })
  return next
}

/** Busy: a send or an answer is writing to this terminal. */
export const STOP_TERMINAL_BUSY = 'The desktop terminal is busy with another action. Try again in a moment.'
/** A row the sheet could not name for Claude's list. */
export const STOP_NO_TARGET = "This task can't be found in Claude's task list, so nothing was stopped."

/** The Stop for a terminal-driven Claude tab, or undefined where there is none
 *  (`enabled` false: another agent, the structured lane, no connection). */
export function useClaudeTerminalTaskStop(args: {
  client: RpcClient | null
  handleRef: RefObject<string | null>
  deviceTokenRef: RefObject<string | null>
  enabled: boolean
  /** After a drive, stopped or not: re-read the screen so the sheet catches up. */
  onDriven?: () => void
}): ClaudeTerminalTaskStop | undefined {
  const { client, handleRef, deviceTokenRef, enabled, onDriven } = args
  const stop = useCallback<ClaudeTerminalTaskStop>(
    async (_taskId, report, target) => {
      const terminal = handleRef.current
      if (!client || !terminal) {
        return false
      }
      if (!target) {
        report?.(STOP_NO_TARGET)
        return false
      }
      // Stops on one terminal run one after another (Stop all presses them
      // together); a send or an answer holding the terminal turns one away.
      return inTurn(terminal, async () => {
        if (!acquireMobileNativeChatTerminalWrite(terminal)) {
          report?.(STOP_TERMINAL_BUSY)
          return false
        }
        const owner = mobileNativeChatTerminalWriteOwner(terminal)
        try {
          const result = await stopClaudeBackgroundTask(createClaudeBackgroundStopIo({ client, terminal, deviceToken: deviceTokenRef.current }), target)
          if (!result.ok) {
            report?.(result.message)
          }
          return result.ok
        } finally {
          releaseMobileNativeChatTerminalWrite(terminal, owner)
          onDriven?.()
        }
      })
    },
    [client, deviceTokenRef, handleRef, onDriven]
  )
  return enabled ? stop : undefined
}
