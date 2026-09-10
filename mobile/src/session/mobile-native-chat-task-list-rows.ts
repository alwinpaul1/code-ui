// Which pairs in one tool run are an agent revising its plan, and what each
// one revised. The mobile half of Orca #19230 (d15a6df22); upstream's own
// version of this walks the whole message list from the renderer, which the
// phone has no equivalent of.

import {
  nativeChatTaskListTool,
  normalizeNativeChatTaskList,
  type NativeChatTaskList,
  type NativeChatTaskListTool
} from '../../../src/shared/native-chat-task-list'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'

export type MobileTaskListRow = {
  list: NativeChatTaskList
  /** The list this call revised, when an earlier call in the same run set one. */
  previous?: NativeChatTaskList
}

/** The checklist each pair is reporting, aligned to `pairs`, `null` where the
 *  pair is not a plan call at all.
 *
 *  History stops at the run's edge on purpose. A turn's repeated plan calls
 *  fold into one run, which is where an agent actually revises a plan, and
 *  reaching further back would mean threading the whole transcript through
 *  every row for a case the fold has already handled. */
export function mobileTaskListRows(
  pairs: readonly NativeChatToolPair[]
): (MobileTaskListRow | null)[] {
  const previous = new Map<NativeChatTaskListTool, NativeChatTaskList>()
  return pairs.map(({ call, result }) => {
    // A refused call claims nothing: its input is what the agent asked for, not
    // what its plan became, so the row keeps the generic view and the error.
    if (!call || call.state === 'failed' || result?.isError) {
      return null
    }
    const tool = nativeChatTaskListTool(call.name)
    const list = tool === null ? null : normalizeNativeChatTaskList(call.name, call.input)
    if (tool === null || list === null) {
      return null
    }
    const before = previous.get(tool)
    previous.set(tool, list)
    return before ? { list, previous: before } : { list }
  })
}

/** The one collapsed line a plan call gets: how far along it is, and the step
 *  it says is running. Without this the row shows the raw JSON of the input. */
export function mobileTaskListPreview(list: NativeChatTaskList): string {
  const completed = list.tasks.filter((task) => task.status === 'completed').length
  const active = list.tasks.find((task) => task.status === 'in_progress')
  const progress = `${completed}/${list.tasks.length}`
  return active ? `${progress} · ${active.activeForm ?? active.content}` : progress
}
