// Which pairs in one tool run are an agent revising its plan, and what each
// one revised. The mobile half of Orca #19230 (d15a6df22). Desktop walks the
// whole message list so a later turn diffs against the plan from an earlier
// one; the first landing of this file stopped at the run's edge.

import {
  nativeChatTaskListTool,
  normalizeNativeChatTaskList,
  type NativeChatTaskList,
  type NativeChatTaskListTool
} from '../../../src/shared/native-chat-task-list'
import { pairToolBlocks, type NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

export type MobileTaskListRow = {
  list: NativeChatTaskList
  /** The list this call revised, when an earlier call set one. */
  previous?: NativeChatTaskList
}

export type MobileTaskListPredecessors = Partial<Record<NativeChatTaskListTool, NativeChatTaskList>>

function listFromPair(
  call: NativeChatToolPair['call'],
  result: NativeChatToolPair['result']
): { tool: NativeChatTaskListTool; list: NativeChatTaskList } | null {
  if (!call || call.state === 'failed' || result?.isError) {
    return null
  }
  const tool = nativeChatTaskListTool(call.name)
  const list = tool === null ? null : normalizeNativeChatTaskList(call.name, call.input)
  if (tool === null || list === null) {
    return null
  }
  return { tool, list }
}

/** For each message id, the last accepted plan of each family *before* that
 *  message. Seed a later run with this so a revision across turns still diffs. */
export function mobileTaskListPredecessors(
  messages: readonly NativeChatMessage[]
): Map<string, MobileTaskListPredecessors> {
  const history = new Map<string, MobileTaskListPredecessors>()
  const previous: MobileTaskListPredecessors = {}
  for (const message of messages) {
    history.set(message.id, { ...previous })
    if (message.role === 'user') {
      continue
    }
    for (const pair of pairToolBlocks(message.blocks)) {
      const found = listFromPair(pair.call, pair.result)
      if (found) {
        previous[found.tool] = found.list
      }
    }
  }
  return history
}

/** The checklist each pair is reporting, aligned to `pairs`, `null` where the
 *  pair is not a plan call at all. `predecessors` is the last accepted plan
 *  of each family from earlier messages. */
export function mobileTaskListRows(
  pairs: readonly NativeChatToolPair[],
  predecessors?: MobileTaskListPredecessors
): (MobileTaskListRow | null)[] {
  const previous = new Map<NativeChatTaskListTool, NativeChatTaskList>()
  if (predecessors?.todowrite) {
    previous.set('todowrite', predecessors.todowrite)
  }
  if (predecessors?.update_plan) {
    previous.set('update_plan', predecessors.update_plan)
  }
  return pairs.map(({ call, result }) => {
    const found = listFromPair(call, result)
    if (!found) {
      return null
    }
    const before = previous.get(found.tool)
    previous.set(found.tool, found.list)
    return before ? { list: found.list, previous: before } : { list: found.list }
  })
}

/** The newest accepted plan in the transcript, for the strip above the composer. */
export function mobileTaskListState(
  messages: readonly NativeChatMessage[]
): { list: NativeChatTaskList | null } {
  let list: NativeChatTaskList | null = null
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }
    for (const pair of pairToolBlocks(message.blocks)) {
      const found = listFromPair(pair.call, pair.result)
      if (found) {
        list = found.list
      }
    }
  }
  return { list }
}

/** The one collapsed line a plan call gets: how far along it is, and the step
 *  it says is running. Without this the row shows the raw JSON of the input. */
export function mobileTaskListPreview(list: NativeChatTaskList): string {
  const completed = list.tasks.filter((task) => task.status === 'completed').length
  const active = list.tasks.find((task) => task.status === 'in_progress')
  const progress = `${completed}/${list.tasks.length}`
  return active ? `${progress} · ${active.activeForm ?? active.content}` : progress
}
