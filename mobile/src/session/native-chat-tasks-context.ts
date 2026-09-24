import { createContext, useContext } from 'react'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import type { NativeChatAgentRunInputs } from './mobile-native-chat-agent-run'

// What the chat's rows and its status line read about the tab's background
// work, handed down by `MobileNativeChatTasksProvider`. Context, not props:
// the rows live inside FlashList, a PureComponent whose cells and header keep
// what they last drew unless `data` or `extraData` changes, and a row that
// went stale on its running state would shimmer for ever. A context change
// reaches its readers whatever sits between.

export type NativeChatAgentRuns = NativeChatAgentRunInputs & {
  /** Opens one subagent's transcript, or undefined where there is none to
   *  open (a Codex tab, or no chat around the row). */
  openTranscript?: (agentId: string, title: string, running: boolean) => void
  /** Opens the "Ran N agents" sheet for one run; undefined outside a chat. */
  openRun?: (blocks: readonly NativeChatBlock[]) => void
}

export type NativeChatTasks = {
  runningCount: number
  openSheet: () => void
}

const NO_AGENT_RUNS: NativeChatAgentRuns = {
  runningIds: new Set(),
  confirmed: new Map(),
  agentWorking: false
}

const NO_TASKS: NativeChatTasks = { runningCount: 0, openSheet: () => {} }

export const NativeChatAgentRunsContext = createContext<NativeChatAgentRuns>(NO_AGENT_RUNS)
export const NativeChatTasksContext = createContext<NativeChatTasks>(NO_TASKS)

/** A row outside any chat (a subagent's own transcript) reads nothing running
 *  and opens nothing. */
export function useNativeChatAgentRuns(): NativeChatAgentRuns {
  return useContext(NativeChatAgentRunsContext)
}

export function useNativeChatTasks(): NativeChatTasks {
  return useContext(NativeChatTasksContext)
}
