import type { RpcResponse } from '../transport/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether an admitted terminal-send payload reports the write as accepted. */
export function isTerminalSendResultAccepted(result: unknown): boolean {
  return isRecord(result) && isRecord(result.send) && result.send.accepted === true
}

/**
 * The same verdict read off a whole envelope. Upstream dropped this once its last raw call site
 * migrated (Orca #20954); CODE UI keeps it for its own raw sends — the Codex picker, document
 * attachments, the queue editor and the draft mirror — until the fork records and migrates them.
 */
export function isTerminalSendRpcAccepted(response: RpcResponse): boolean {
  return response.ok && isTerminalSendResultAccepted(response.result)
}
