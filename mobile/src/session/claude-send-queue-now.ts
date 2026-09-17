import type { RpcClient } from '../transport/rpc-client'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'
import { sendQueueNowWrite } from './claude-send-queue-now-operations'

/**
 * Claude Code's send-now key, as two bytes: ctrl+x ctrl+s.
 *
 * Added in 2.1.275: it interrupts the current turn and sends every queued
 * message at once. The release bound it twice — ctrl+enter, and this — because
 * ctrl+enter is indistinguishable from enter on most terminals and never
 * reaches the agent as anything distinct. Two control bytes reach it anywhere.
 *
 * Verified against the binary's own strings ("ctrl+x ctrl+s",
 * "input_send_now_key", "queued_send_now") and the release notes. Not against
 * a phone. Nothing here interprets the sequence; the agent does.
 */
export const CLAUDE_SEND_NOW_BYTES = ''

/**
 * Whether the button should exist at all.
 *
 * The key means something only while a turn is running with messages waiting
 * behind it. Outside that it is a no-op — or, on a build that predates 2.1.275,
 * an unbound sequence the phone has no way to know about. Codex has no such
 * key. So the button is drawn only in the one state where it does what it says.
 */
export function canSendQueueNow(state: {
  agent: string | null
  working: boolean
  queued: number
}): boolean {
  return state.agent === 'claude' && state.working && state.queued > 0
}

/** Write the key. True when the host accepted the write. Never throws: this
 *  runs from a tap handler, where a rejection has nowhere to go. */
export async function sendClaudeQueueNow(args: {
  client: RpcClient
  terminal: string
  deviceToken: string | null
}): Promise<boolean> {
  try {
    if (args.client.getState() !== 'connected') {
      return false
    }
    const accepted = sendQueueNowWrite.interpret(
      await sendQueueNowWrite.request(
        args.client,
        buildTerminalSendParams({
          terminal: args.terminal,
          text: CLAUDE_SEND_NOW_BYTES,
          // A control sequence is complete as sent; an Enter after it would
          // land in the composer as a blank submit.
          enter: false,
          deviceToken: args.deviceToken
        })
      )
    )
    return accepted === true
  } catch {
    return false
  }
}
