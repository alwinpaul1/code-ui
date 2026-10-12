// Claude Code's task list as its Task tools build it, one call at a time.
//
// Since the Task tools landed, an interactive Claude Code keeps its plan with
// TaskCreate and TaskUpdate rather than one TodoWrite carrying the whole list.
// No single call holds the list, so it is folded here from the calls in the
// transcript. Verified against Claude Code 2.1.296's own strings (the result
// "Task #<id> created successfully: <subject>") and real 2.1.228 transcripts.
//
// The id a task gets is only in TaskCreate's RESULT, so a create whose result
// does not say it is left out rather than guessed at, and an update naming an
// id this transcript never created (a list carried over from an earlier
// session) changes nothing.

import type { NativeChatTask, NativeChatTaskList } from '../../../src/shared/native-chat-task-list'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'

const CREATED = /^Task #(\d+) created successfully/

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value))
    } catch {
      return null
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function isClaudeTaskTool(name: string | undefined): boolean {
  return name === 'TaskCreate' || name === 'TaskUpdate'
}

/** Folds Task calls in order. Holds the tasks by id, in creation order. */
export class ClaudeTaskToolFold {
  private readonly tasks = new Map<string, NativeChatTask>()

  /** True when the pair changed the list. */
  apply(pair: NativeChatToolPair): boolean {
    const { call, result } = pair
    if (!call || !isClaudeTaskTool(call.name) || call.state === 'failed' || !result || result.isError) {
      return false
    }
    const input = record(call.input)
    if (!input) {
      return false
    }
    if (call.name === 'TaskCreate') {
      const id = CREATED.exec(result.output.trim())?.[1]
      const content = text(input.subject)
      if (!id || !content) {
        return false
      }
      const activeForm = text(input.activeForm)
      this.tasks.set(id, { content, status: 'pending', ...(activeForm ? { activeForm } : {}) })
      return true
    }
    const id = text(input.taskId) ?? (typeof input.taskId === 'number' ? String(input.taskId) : undefined)
    const task = id ? this.tasks.get(id) : undefined
    if (!id || !task) {
      return false
    }
    if (input.status === 'deleted') {
      this.tasks.delete(id)
      return true
    }
    const status =
      input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed'
        ? input.status
        : task.status
    const content = text(input.subject) ?? task.content
    const activeForm = text(input.activeForm) ?? task.activeForm
    this.tasks.set(id, { content, status, ...(activeForm ? { activeForm } : {}) })
    return true
  }

  list(): NativeChatTaskList | null {
    return this.tasks.size > 0 ? { tasks: [...this.tasks.values()] } : null
  }
}
