import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
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
}

/** Opens the run sheet for one run. In a context of its own, stable for the
 *  chat's life, so a row that only asks for the sheet is not re-rendered by
 *  every change to the agent state above. `owner` is the row that asked: while
 *  its sheet is open, `sync` hands the sheet the row's current blocks, so a run
 *  that grows is not shown as it was at the tap. */
export type NativeChatRunSheetControl = {
  open: (blocks: readonly NativeChatBlock[], owner: object) => void
  sync: (blocks: readonly NativeChatBlock[], owner: object) => void
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
export const NativeChatRunSheetContext = createContext<NativeChatRunSheetControl | null>(null)
export const NativeChatTasksContext = createContext<NativeChatTasks>(NO_TASKS)

/** A row outside any chat (a subagent's own transcript) reads nothing running
 *  and opens nothing. */
export function useNativeChatAgentRuns(): NativeChatAgentRuns {
  return useContext(NativeChatAgentRunsContext)
}

export function useNativeChatTasks(): NativeChatTasks {
  return useContext(NativeChatTasksContext)
}

/** What a row of a run calls to open the run's sheet, or undefined outside a
 *  chat (a subagent's own transcript), where the row unfolds inline instead. */
export function useRunSheetOpener(blocks: readonly NativeChatBlock[]): (() => void) | undefined {
  const control = useContext(NativeChatRunSheetContext)
  const owner = useRef({})
  useEffect(() => control?.sync(blocks, owner.current), [control, blocks])
  const open = useCallback(() => control?.open(blocks, owner.current), [control, blocks])
  return control ? open : undefined
}
