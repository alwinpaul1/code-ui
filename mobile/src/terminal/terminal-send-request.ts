import type { SendRequestOptions } from '../transport/rpc-client'
import { stripTerminalScreenControl } from './terminal-screen-control-strip'

type TerminalSendParams = {
  readonly terminal: string
  readonly text: string
  readonly enter: boolean
  readonly client?: { readonly id: string; readonly type: 'mobile' }
}

// Why: keystroke sends must never park in the connect wait — parked sends replay into the PTY after reconnect (#6713).
export const TERMINAL_INPUT_SEND_OPTIONS: SendRequestOptions = { failWhenDisconnected: true }

export function buildTerminalSendParams(args: {
  terminal: string
  text: string
  enter: boolean
  // Why: presence-lock take-floor; marks this phone active so multi-mobile contention resolves to the last actor.
  deviceToken: string | null
}): TerminalSendParams {
  return {
    terminal: args.terminal,
    // Why stripped here: this is the one choke point every phone-originated
    // write passes through — keys, gestures, the chat draft mirror, the queue
    // editor's pastes. A screen-control sequence can only have come from
    // emulator output that turned back into input, and the agent's TUI renders
    // it as text the user never typed (2026-09-13). Query replies take their
    // own path and are shape-checked there.
    text: stripTerminalScreenControl(args.text),
    enter: args.enter,
    ...(args.deviceToken ? { client: { id: args.deviceToken, type: 'mobile' as const } } : {})
  }
}
