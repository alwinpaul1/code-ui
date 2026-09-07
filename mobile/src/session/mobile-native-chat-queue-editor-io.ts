import type { RpcClient } from '../transport/rpc-client'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../terminal/terminal-send-request'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'
import type { QueueEditorIo } from './native-queue-editor'

export type QueueEditorIoScope = {
  readonly client: RpcClient | null
  readonly enabled: boolean
  readonly tabId: string | null
  readonly deviceToken: string | null
  readonly handle: string | null
  readonly generation: number
}

/** Builds the reader/writer the queue editor drives, bound to one terminal for
 *  one editing session. `scope()` is re-read before and after every call so a
 *  reconnect or a tab change aborts the sequence instead of writing into
 *  whatever terminal happens to be current. */
export function createQueueEditorIo(args: {
  handle: string
  tabId: string
  generation: number
  scope: () => QueueEditorIoScope
}): QueueEditorIo {
  const { handle, tabId, generation } = args
  const assertCurrent = () => {
    const current = args.scope()
    if (
      current.generation !== generation ||
      !current.enabled ||
      !current.client ||
      current.tabId !== tabId ||
      current.handle !== handle
    ) {
      throw new Error('Connection or session changed. The agent input has been preserved.')
    }
    return current
  }
  // The settle exists so the agent has repainted before its screen is
  // sampled. A relay round trip already provides far more than that, so on a
  // phone the fixed sleep was pure delay on every step of a save.
  let lastTripMs = 0
  const timed = async <T>(run: () => Promise<T>): Promise<T> => {
    const at = Date.now()
    try {
      return await run()
    } finally {
      lastTripMs = Date.now() - at
    }
  }
  return {
    read: async () => {
      const current = assertCurrent()
      const response = await timed(() =>
        current.client!.sendRequest(
          'terminal.read',
          { terminal: handle, screen: true },
          { timeoutMs: 2500, failWhenDisconnected: true }
        )
      )
      assertCurrent()
      if (!response.ok) {
        throw new Error('Could not read the agent input.')
      }
      const result = response.result as {
        terminal?: { tail?: string[]; lines?: string[]; draft?: string; source?: string }
      }
      const terminal = result.terminal
      return {
        lines: terminal?.tail ?? terminal?.lines ?? [],
        draft: terminal?.draft ?? '',
        source: terminal?.source ?? ''
      }
    },
    write: async (text, idleOnly) => {
      const current = assertCurrent()
      const response = await timed(() =>
        current.client!.sendRequest(
          'terminal.send',
          {
            ...buildTerminalSendParams({
              terminal: handle,
              text,
              enter: false,
              deviceToken: current.deviceToken
            }),
            ...(idleOnly ? { requireAgentStatus: 'sendable' } : {})
          },
          { ...TERMINAL_INPUT_SEND_OPTIONS, timeoutMs: 5000 }
        )
      )
      assertCurrent()
      if (!isTerminalSendRpcAccepted(response)) {
        throw new Error('The agent did not accept the edit. Your input has been kept.')
      }
    },
    pause: () => new Promise((resolve) => setTimeout(resolve, Math.max(0, 120 - lastTripMs)))
  }
}
