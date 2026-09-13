import type { RpcClient } from '../transport/rpc-client'

export type MacHostCommandOutcome = { ok: true } | { ok: false; reason: string }

/** Long enough for `osascript` to finish typing at the login window, short enough
 *  that a shell which ignored its own `exit` does not sit on the desktop. */
export const MAC_HOST_COMMAND_CLOSE_DELAY_MS = 4000

// Why a terminal at all: there is no generic "run this on the host" RPC. A startup
// command in a throwaway tab is the only route, and the command ends in `exit` so the
// tab closes itself; the delayed close below is the fallback for a host that keeps it.
export async function runMacHostCommand(args: {
  client: Pick<RpcClient, 'sendRequest'>
  worktreeId: string
  command: string
}): Promise<MacHostCommandOutcome> {
  let response
  try {
    response = await args.client.sendRequest('session.tabs.createTerminal', {
      worktree: `id:${args.worktreeId}`,
      command: args.command,
      activate: false,
      select: false,
      navigation: 'caller'
    })
  } catch {
    // Why a fixed string: the thrown error can carry the command, and the unlock
    // command carries the user's password. Nothing derived from it may be shown.
    return { ok: false, reason: 'The Mac did not answer.' }
  }
  if (!response.ok) {
    return { ok: false, reason: response.error?.message || 'The Mac refused the command.' }
  }
  const tabId = (response.result as { tab?: { id?: unknown } } | null)?.tab?.id
  if (typeof tabId === 'string') {
    setTimeout(() => {
      void args.client
        .sendRequest('session.tabs.close', {
          worktree: `id:${args.worktreeId}`,
          tabId,
          reason: 'user'
        })
        // The tab has usually closed itself by now, so a refusal here is expected.
        .catch(() => undefined)
    }, MAC_HOST_COMMAND_CLOSE_DELAY_MS)
  }
  return { ok: true }
}
