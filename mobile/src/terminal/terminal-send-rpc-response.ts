import type { RpcResponse } from '../transport/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Whether an admitted terminal-send payload reports the write as accepted.
 *
 * Upstream deleted this module in Orca #21176, once `terminalSendAcceptedSchema` in
 * terminal-reply-schema.ts carried the projection for every operation-bound send. CODE UI keeps it
 * for its own raw sends — the Codex picker, document attachments, the queue editor and the draft
 * mirror — which read a whole envelope and stay on the raw port until the fork records and
 * migrates them. The verdict is the schema's: `send.accepted === true` and nothing else.
 */
export function isTerminalSendResultAccepted(result: unknown): boolean {
  return isRecord(result) && isRecord(result.send) && result.send.accepted === true
}

/** The same verdict read off a whole envelope. */
export function isTerminalSendRpcAccepted(response: RpcResponse): boolean {
  return response.ok && isTerminalSendResultAccepted(response.result)
}
