// The Agent sheet's "Tool calls (N)" list (parity gap G29), handed to the tool
// detail sheet by the tab's tasks provider rather than imported by it. The list
// draws the run sheet's rows, and the detail sheet is mounted under every tool
// row in the chat and the subagent viewer, where nothing else needs the run
// sheet's icon set; without a provider (the subagent viewer) there is no list.

import { createContext, useContext, type ReactNode } from 'react'

export type AgentToolCallsProps = {
  agentId: string
  /** The Agent call's description, which titles the transcript viewer. */
  title: string
  /** The Agent call's id: the `parent_tool_use_id` of the agent's own events in Anthropic's
   *  stream (ccr-background-tasks.ts `ccrSubagentMessages`). Null when the call carries none. */
  toolUseId?: string | null
  inSection: (label: string, body: ReactNode) => ReactNode
}

/** Returns the list's element; the hooks live in the component it renders. */
export type RenderAgentToolCalls = (props: AgentToolCallsProps) => ReactNode

const AgentToolCallsSlot = createContext<RenderAgentToolCalls | null>(null)

export function AgentToolCallsSlotProvider({ render, children }: { render: RenderAgentToolCalls; children: ReactNode }) {
  return <AgentToolCallsSlot.Provider value={render}>{children}</AgentToolCallsSlot.Provider>
}

export function useAgentToolCallsSlot(): RenderAgentToolCalls | null {
  return useContext(AgentToolCallsSlot)
}
