import { isTextBlock, type NativeChatBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * A background task's notification, drawn the way Claude draws it: one status
 * line, not a bubble of XML.
 *
 * Claude Code hands the agent a finished background command or subagent as a
 * `<task-notification>` block (a user-role record, or a `queued_command`
 * attachment when the agent took it mid-turn). The block is machinery: the
 * Claude app strips it from the user's text (`g2a`, its tag list carries
 * `task-notification`, `agent-notification` and `bash-notification`) and draws the
 * task's own state from the `<status>` and `<summary>` inside it, and the
 * desktop TUI draws `⏺ Background command "…" completed (exit code 0)`, which is
 * the `<summary>` verbatim (Claude Code 2.1.300; screen fixtures in
 * fixtures/claude-busy-lead-tasks-2.1.296). Real records: fixtures/claude-task-notifications-2.1.300.ts.
 *
 * Only a block that closes and says something in its `<summary>` is drawn. Any
 * other shape stays as the text it is: showing the raw words beats dropping a
 * message the reader cannot recover.
 */
export type TaskNotificationTone = 'success' | 'danger' | 'muted'

export type TaskNotification = {
  status: string
  summary: string
  tone: TaskNotificationTone
}

const BLOCK = /<(task|agent|bash)-notification\b[^>]*>([\s\S]*?)<\/\1-notification>/g
const STATUS = /<status>([\s\S]*?)<\/status>/
const SUMMARY = /<summary>([\s\S]*?)<\/summary>/
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/** Failed is the only red one. A task the system stopped (`killed`, `stopped`) is not a
 *  failure: Claude's own note on a memory-pressure kill says so. */
function toneOf(status: string): TaskNotificationTone {
  const word = status.trim().toLowerCase()
  if (word === 'completed') {
    return 'success'
  }
  return word === 'failed' || word === 'error' ? 'danger' : 'muted'
}

/** The notifications a user turn carries and the words left over once they and
 *  the harness's own reminders are cut out; null when it carries no drawable one. */
export function parseTaskNotifications(text: string): { notifications: TaskNotification[]; rest: string } | null {
  if (!text.includes('-notification')) {
    return null
  }
  const notifications: TaskNotification[] = []
  const rest = text.replace(BLOCK, (block: string, _kind: string, body: string) => {
    const summary = SUMMARY.exec(body)?.[1]?.trim() ?? ''
    if (summary === '') {
      return block
    }
    const status = STATUS.exec(body)?.[1]?.trim() ?? ''
    notifications.push({ status, summary, tone: toneOf(status) })
    return ''
  })
  if (notifications.length === 0) {
    return null
  }
  return { notifications, rest: rest.replace(SYSTEM_REMINDER, '').trim() }
}

/** A user row split into the notifications it carries and what stays a user
 *  turn (null when nothing does). Null result: the row carries none. */
export function taskNotificationsOf(
  message: NativeChatMessage
): { notifications: TaskNotification[]; rest: NativeChatMessage | null } | null {
  if (message.role !== 'user') {
    return null
  }
  const texts = message.blocks.filter(isTextBlock)
  const parsed = texts.length > 0 ? parseTaskNotifications(texts.map((block) => block.text).join('\n')) : null
  if (!parsed) {
    return null
  }
  const others: NativeChatBlock[] = message.blocks.filter((block) => !isTextBlock(block))
  const blocks: NativeChatBlock[] =
    parsed.rest === '' ? others : [...others, { ...texts[0]!, text: parsed.rest }]
  return { notifications: parsed.notifications, rest: blocks.length > 0 ? { ...message, blocks } : null }
}
