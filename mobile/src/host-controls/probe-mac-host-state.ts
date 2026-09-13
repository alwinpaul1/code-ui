import type { RpcClient } from '../transport/rpc-client'
import {
  MAC_HOST_STATE_PROBE_COMMAND,
  UNKNOWN_MAC_HOST_STATE,
  parseMacHostState,
  type MacHostState
} from './mac-host-state'

export const MAC_HOST_STATE_PROBE_INTERVAL_MS = 400
export const MAC_HOST_STATE_PROBE_TIMEOUT_MS = 4000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readScreenLines(result: unknown): string[] {
  const raw = (result as { terminal?: { tail?: unknown; lines?: unknown } } | null)?.terminal
  const lines = raw?.tail ?? raw?.lines
  return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : []
}

/** Opens the same kind of throwaway terminal the actions use, watches its screen for
 *  the marker line, then closes the tab. Never guesses: a screen that never paints the
 *  marker comes back unknown, and the sheet then offers every row. */
export async function probeMacHostState(args: {
  client: Pick<RpcClient, 'sendRequest'>
  worktreeId: string
}): Promise<MacHostState> {
  let tabId: string | null = null
  try {
    const created = await args.client.sendRequest('session.tabs.createTerminal', {
      worktree: `id:${args.worktreeId}`,
      command: MAC_HOST_STATE_PROBE_COMMAND,
      activate: false,
      select: false,
      navigation: 'caller'
    })
    if (!created.ok) {
      return UNKNOWN_MAC_HOST_STATE
    }
    const tab = (created.result as { tab?: { id?: unknown; terminal?: unknown } } | null)?.tab
    tabId = typeof tab?.id === 'string' ? tab.id : null
    const handle = typeof tab?.terminal === 'string' ? tab.terminal : null
    if (!handle) {
      return UNKNOWN_MAC_HOST_STATE
    }
    const deadline = Date.now() + MAC_HOST_STATE_PROBE_TIMEOUT_MS
    while (Date.now() < deadline) {
      await delay(MAC_HOST_STATE_PROBE_INTERVAL_MS)
      const response = await args.client.sendRequest('terminal.read', {
        terminal: handle,
        screen: true
      })
      if (!response.ok) {
        continue
      }
      const state = parseMacHostState(readScreenLines(response.result))
      if (state.lock !== 'unknown') {
        return state
      }
    }
    return UNKNOWN_MAC_HOST_STATE
  } catch {
    return UNKNOWN_MAC_HOST_STATE
  } finally {
    if (tabId) {
      const closingTabId = tabId
      void args.client
        .sendRequest('session.tabs.close', {
          worktree: `id:${args.worktreeId}`,
          tabId: closingTabId,
          reason: 'user'
        })
        // The probe ends in `exit`, so the tab has usually gone on its own.
        .catch(() => undefined)
    }
  }
}
