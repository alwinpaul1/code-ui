import type { RpcClient } from '../../transport/rpc-client'
import { buildTerminalSendParams } from '../../terminal/terminal-send-request'
import { mcpStatusOverlayWrite } from './mcp-status-overlay-operations'

/**
 * The extension's MCP dialog shows live status (connected / pending
 * approval / error), OAuth and reconnect — none of which the phone can read
 * (row 46, port-feasibility-map.md: `get_mcp_servers`/`mcp_status` are SDK
 * control requests the phone cannot make). Claude Code's own `/mcp` command
 * draws that exact status picker in the terminal, so "Show status in
 * terminal" types it and submits it — the same fallback shape as `/fork`
 * (claude-fork-session.ts).
 */
export const MCP_STATUS_COMMAND_TEXT = '/mcp'

/**
 * Only a TUI-lane Claude session has a raw terminal to type into. The SDK
 * (structured) lane and Codex sessions get nothing rather than a button that
 * silently does nothing — same idle gating as `/fork`: typed mid-turn it
 * queues instead of running now, and while a permission or question prompt
 * holds the screen, typed text answers that prompt instead of opening `/mcp`.
 */
export function canShowMcpStatusOverlay(state: {
  agent: string | null
  status: string | null
  structured: boolean
}): boolean {
  if (state.structured) {
    return false
  }
  return state.agent === 'claude' && state.status === 'done'
}

/** Types `/mcp` and submits it. True when the host accepted the write. Never
 *  throws: runs from a tap handler with nowhere for a rejection to go. */
export async function openMcpStatusOverlay(args: {
  client: RpcClient
  terminal: string
  deviceToken: string | null
}): Promise<boolean> {
  try {
    if (args.client.getState() !== 'connected') {
      return false
    }
    const accepted = mcpStatusOverlayWrite.interpret(
      await mcpStatusOverlayWrite.request(
        args.client,
        buildTerminalSendParams({
          terminal: args.terminal,
          text: MCP_STATUS_COMMAND_TEXT,
          enter: true,
          deviceToken: args.deviceToken
        })
      )
    )
    return accepted === true
  } catch {
    return false
  }
}
