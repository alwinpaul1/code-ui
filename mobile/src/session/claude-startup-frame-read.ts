import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { readClaudeStartupFrame, type StartupFrameRead } from './claude-startup-frame'

/** Rows from the oldest the host still holds: a frame's header, model row and
 *  working directory sit in the first dozen, and a framed one a few more. */
const OLDEST_ROWS = 80

/**
 * The startup frame as the HOST's stream buffer still holds it, or null.
 *
 * `terminal.read --screen` shows the visible rows only, so a session whose
 * conversation has outgrown one screen has lost the frame there. An un-cursored
 * stream read answers the NEWEST rows, which is no better. A read from cursor 0
 * answers from the OLDEST row the host still keeps (Orca's `readTerminalTail`,
 * 2000 lines or 256 KB, `oldestCursor` says where it begins), which is the
 * frame until a long session rolls it out. Whether the frame is still there
 * is decided by the parser, never assumed: a buffer that begins elsewhere gives
 * null, and the pair already kept for the session stands.
 *
 * One bounded request, never a write, and a failed or unreadable reply is
 * simply no frame (the caller retries on the next connection).
 */
export async function readStartupFrameFromHostStream(client: RpcClient, handle: string): Promise<StartupFrameRead | null> {
  const response = await client.sendRequest(
    'terminal.read',
    { terminal: handle, cursor: 0, limit: OLDEST_ROWS },
    { timeoutMs: 4000, budgetSpansConnect: true }
  )
  if (!response.ok) {
    return null
  }
  const terminal = ((response as RpcSuccess).result as { terminal?: { tail?: unknown; lines?: unknown } } | null)?.terminal
  const raw = terminal?.tail ?? terminal?.lines
  const rows = Array.isArray(raw) ? raw.filter((row): row is string => typeof row === 'string') : []
  return readClaudeStartupFrame(rows)
}
