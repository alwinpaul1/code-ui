import { useAgentHudBeacon, type AgentHudBeacon, type DesktopPrompt } from './agent-hud-beacon'
import { agentHudBeaconMatches } from './hud-beacon-fields'
import {
  useBeaconAgentMessages,
  type BeaconAgentMessage,
  type StatusSubagentMessage
} from './mobile-native-chat-agent-messages'
import { useAgentStatusPrompts } from './use-agent-status-prompts'

/**
 * What the chat on screen hears from its own session outside the transcript: the beacon of the
 * terminal it runs in, the desktop prompts Orca's hooks put on the tab status, and the subagent
 * messages the beacon carries. Moved out of `use-mobile-native-chat-controller.ts` whole.
 */
export function useActiveChatBeacon(args: {
  activeHandle: string | null
  agent: string | null
  sessionId: string | null
  /** The chat is drawn and reads a transcript (not the structured lane). */
  readsPrompts: boolean
  promptStatus: Parameters<typeof useAgentStatusPrompts>[1]
  connected: boolean
  tabsLive: boolean
}): {
  hudBeacon: AgentHudBeacon | null
  tailPrompts: DesktopPrompt[]
  statusAgentMessages: readonly StatusSubagentMessage[]
  agentMessages: BeaconAgentMessage[]
} {
  const handleBeacon = useAgentHudBeacon(args.activeHandle)
  // Only the beacon of the session this tab is showing: a beacon is keyed by
  // terminal handle, and a handle outlives the process that emitted into it,
  // so a hand-started session in a reused terminal would otherwise echo the
  // previous session's desktop prompts (2026-09-18). `null` while the tab
  // does not yet know its session.
  const hudBeacon = agentHudBeaconMatches(handleBeacon, args.agent, args.sessionId) ? handleBeacon : null
  // What a hand-started session never beacons — a message from the desktop
  // or the Claude app, mid-turn or not — Orca's own hooks put on the tab
  // status as `agentStatus.prompt`, and the phone reads it there
  // (agent-status-prompts.ts, 2026-09-19).
  const { prompts: tailPrompts, agentMessages: statusAgentMessages } = useAgentStatusPrompts(
    args.readsPrompts ? args.sessionId : null,
    args.promptStatus,
    hudBeacon?.desktopPrompts,
    args.connected,
    args.tabsLive
  )
  const agentMessages = useBeaconAgentMessages(hudBeacon, args.activeHandle)
  return { hudBeacon, tailPrompts, statusAgentMessages, agentMessages }
}
