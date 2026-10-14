import type { PromptNotificationCategoryAction } from './permission-notification-category'
import type { DecoratableContent } from './permission-notification-decorate'
import type { DesktopNotificationSource } from './notification-routing'
import { agentHeadlineLabel } from './notification-presentation'

/**
 * An inline Reply on a session's notification, after the Claude Android app (n530.java:775-792):
 * an action labelled "Reply" (`notification_action_reply`) over a remote-input field whose hint is
 * "Reply to Claude" (`notification_reply_hint`). A tap on Send answers in the shade and never opens
 * the app (session-reply-response.ts); a failure says why on the banner
 * (session-reply-failure.ts).
 */
export const SESSION_REPLY_ACTION = 'session-reply'
export const SESSION_REPLY_LABEL = 'Reply'

/** The agents a reply can be typed to from here: those whose composer the outbox's drainer reads
 *  (Claude Code and Codex). The desktop names the agent of a finished session "Claude" when the
 *  host did not say, so an unnamed one is offered the Reply too. */
function repliesTo(agent: string | null): boolean {
  return agent === null || agent === 'claude' || agent === 'openclaude' || agent === 'codex'
}

/** "Reply to Claude", or to the agent the session runs. */
export function sessionReplyHint(agent: string | null): string {
  return `Reply to ${agentHeadlineLabel(agent) ?? 'Claude'}`
}

/** Whether a category is the one the Reply alone makes (permission-notification-category.ts builds
 *  its id from the actions: `codeui-permission-session-reply=reply(<hint>):Reply`). */
export function isSessionReplyCategory(categoryIdentifier: string): boolean {
  return categoryIdentifier.startsWith(`codeui-permission-${SESSION_REPLY_ACTION}=`)
}

export type SessionReplyDeps = {
  /** The agent the worktree launched, when exactly one is known. */
  agent: string | null
  ensureCategory: (actions: PromptNotificationCategoryAction[]) => Promise<string | null>
}

function readString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Hangs the Reply button on a finished session's banner. Nothing changes where a reply cannot go:
 * not a bell, not the test notification, not a banner that already carries buttons (a permission or
 * a question to answer is answered there), not one with no host, worktree or pane to route the
 * words back to, not an agent with no composer reader. A category the system will not take costs
 * the button and nothing else: the banner is the one the desktop sent.
 */
export async function decorateWithReply(
  content: DecoratableContent,
  event: { source: DesktopNotificationSource; worktreeId?: string },
  deps: SessionReplyDeps
): Promise<DecoratableContent> {
  try {
    if (event.source !== 'agent-task-complete' || !event.worktreeId || content.categoryIdentifier) {
      return content
    }
    if (
      readString(content.data, 'hostId') === null ||
      readString(content.data, 'worktreeId') === null ||
      readString(content.data, 'paneKey') === null ||
      !repliesTo(deps.agent)
    ) {
      return content
    }
    const categoryIdentifier = await deps.ensureCategory([
      {
        identifier: SESSION_REPLY_ACTION,
        label: SESSION_REPLY_LABEL,
        textInput: { placeholder: sessionReplyHint(deps.agent) }
      }
    ])
    return categoryIdentifier ? { ...content, categoryIdentifier } : content
  } catch {
    return content
  }
}
