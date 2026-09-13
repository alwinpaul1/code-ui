import type { RpcClient } from '../transport/rpc-client'

export const THROWAWAY_TERMINAL_POLL_MS = 400

export type ThrowawayTerminalClient = Pick<RpcClient, 'sendRequest'>

export type ThrowawayTerminalWatch<T> = {
  client: ThrowawayTerminalClient
  worktreeId: string
  command: string
  timeoutMs: number
  /** The command carries a secret, so no host text may be surfaced about it.
   *  The unlock command has the user's password on its own command line. */
  secret?: boolean
  /** Reads the screen after each poll; a non-null answer ends the watch. */
  read: (lines: string[]) => T | null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function readScreenLines(result: unknown): string[] {
  const raw = (result as { terminal?: { tail?: unknown; lines?: unknown } } | null)?.terminal
  const lines = raw?.tail ?? raw?.lines
  return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : []
}

export type ThrowawayTerminalOutcome<T> =
  | { ok: true; answer: T | null }
  | { ok: false; reason: string }

// Why the tab is closed from here and the command never ends in `exit`: a shell
// that exits leaves the desktop holding a dead "Terminal N" tab that
// session.tabs.close no longer removes (five of them stood in the strip on
// 2026-09-13), and a tab gone before the first poll reads as no answer at all.
// A live tab closes cleanly, so the shell stays up until the phone has read what
// it needed, then the phone closes it.
export async function watchThrowawayTerminal<T>(
  args: ThrowawayTerminalWatch<T>
): Promise<ThrowawayTerminalOutcome<T>> {
  let created
  try {
    created = await args.client.sendRequest('session.tabs.createTerminal', {
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
  if (!created.ok) {
    // The host echoes the rejected request in some errors, and for unlock that
    // request IS the password. The sibling catch above already refuses to
    // derive anything from an error for exactly this reason; this arm was the
    // asymmetry (2026-09-14 review).
    return {
      ok: false,
      reason: args.secret
        ? 'The Mac refused the command.'
        : created.error?.message || 'The Mac refused the command.'
    }
  }
  const tab = (created.result as { tab?: { id?: unknown; terminal?: unknown } } | null)?.tab
  const tabId = typeof tab?.id === 'string' ? tab.id : null
  const handle = typeof tab?.terminal === 'string' ? tab.terminal : null
  let answer: T | null = null
  try {
    const deadline = Date.now() + args.timeoutMs
    while (handle && Date.now() < deadline) {
      await delay(THROWAWAY_TERMINAL_POLL_MS)
      const response = await args.client.sendRequest('terminal.read', {
        terminal: handle,
        screen: true
      })
      if (!response.ok) {
        continue
      }
      answer = args.read(readScreenLines(response.result))
      if (answer !== null) {
        break
      }
    }
  } catch {
    // The screen is a courtesy; the close below still runs.
  } finally {
    // A tab with no usable id cannot be closed by id, and for unlock its
    // scrollback holds the password — so fall back to closing the terminal
    // itself rather than leaving it standing on the desktop (2026-09-14).
    if (!tabId && handle) {
      void args.client
        .sendRequest('terminal.close', { terminal: handle })
        .catch(() => undefined)
    }
    if (tabId) {
      void args.client
        .sendRequest('session.tabs.close', {
          worktree: `id:${args.worktreeId}`,
          tabId,
          reason: 'user'
        })
        .catch(() => undefined)
    }
  }
  return { ok: true, answer }
}
