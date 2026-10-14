import { nativeChatAskDismissKey } from '../../../src/shared/native-chat-ask'
import { mobileChatPermissionKey } from '../session/mobile-native-chat-permission'
import type { RpcClient } from '../transport/rpc-client'
import { desktopNotificationLocation } from './notification-presentation'
import type { PendingPermission, PendingPrompt, PendingQuestion } from './permission-lookup'
import type { PromptNotificationCategoryAction } from './permission-notification-category'
import { approvalAnswer } from '../session/mobile-native-chat-permission'
import { approveWithheldReason } from './permission-notification-approve-gate'
import {
  PERMISSION_COMMENT_ACTION,
  PERMISSION_COMMENT_HINT,
  PERMISSION_COMMENT_LABEL,
  permissionNotificationContent,
  type PermissionNotificationAction
} from './permission-notification-content'
import type { PermissionNotificationData } from './permission-notification-response'
import { questionNotificationContent } from './question-notification-content'
import type { QuestionNotificationData } from './question-notification-response'

export type DecoratableContent = {
  title?: string
  body?: string
  data?: Record<string, unknown>
  /** Set only when the OS accepted an action set; Android draws buttons from a
   *  category rather than from the notification itself. */
  categoryIdentifier?: string
}

export type PermissionDecorationDeps = {
  resolveClient: (hostId: string) => RpcClient | null
  lookup: (client: RpcClient, worktreeId: string) => Promise<PendingPrompt | null>
  /** Registers the action set with the OS and resolves to its category id. */
  ensureCategory: (actions: PromptNotificationCategoryAction[]) => Promise<string | null>
}

/** The caption, the buttons to register, and what a tap on them needs. */
type Decoration = {
  title: string
  body: string
  actions: PromptNotificationCategoryAction[]
  answerData: PermissionNotificationData | QuestionNotificationData
}

/** Android draws three actions and drops the rest. */
const MAX_ACTIONS = 3

const ESCAPE = String.fromCharCode(27)

/** An action that says no: Escape, or a label that reads as a refusal. */
function refuses(action: PermissionNotificationAction): boolean {
  return action.send === ESCAPE || approvalAnswer(action.label) === 'no'
}

/** Claude Code's dialog is the one whose "No" row takes a comment from here (verified on 2.1.299,
 *  claude-permission-comment-send.ts). Codex's was not captured, so it gets no such button. */
function agentTakesComment(agent: string): boolean {
  return agent === 'claude' || agent === 'openclaude'
}

function permissionDecoration(
  pending: PendingPermission,
  hostId: string,
  worktreeId: string
): Decoration | null {
  const permission = permissionNotificationContent(pending.permission)
  if (!permission) {
    return null
  }
  // Approve is not drawn for a plan, a question, an unknown tool or a destructive request
  // (permission-notification-approve-gate.ts); what is left to answer is the refusals.
  const withheld = approveWithheldReason(pending.permission)
  const answerable = withheld === null ? permission.actions : permission.actions.filter(refuses)
  // A comment needs a dialog it is known to work against: not a plan review or a question (their
  // "No" rows are other shapes), and not an unknown tool.
  const offersComment =
    agentTakesComment(pending.agent) && (withheld === null || withheld === 'destructive')
  const room = offersComment ? MAX_ACTIONS - 1 : MAX_ACTIONS
  const kept =
    answerable.length > room ? [...answerable.slice(0, room - 1), answerable[answerable.length - 1]!] : answerable
  if (kept.length === 0) {
    // Nothing a tap could answer: the desktop's own banner stays as it is.
    return null
  }
  return {
    title: permission.title,
    body: permission.body,
    actions: [
      ...kept.map((action) => ({ identifier: action.identifier, label: action.label })),
      ...(offersComment
        ? [
            {
              identifier: PERMISSION_COMMENT_ACTION,
              label: PERMISSION_COMMENT_LABEL,
              textInput: { placeholder: PERMISSION_COMMENT_HINT }
            }
          ]
        : [])
    ],
    answerData: {
      hostId,
      worktreeId,
      // Identity of the prompt this banner was built from, so a tap minutes
      // later can tell whether the agent is still asking the same thing.
      permissionKey: mobileChatPermissionKey(pending.permission),
      sends: Object.fromEntries(kept.map((a) => [a.identifier, a.send])),
      ...(offersComment ? { comment: true as const } : {})
    }
  }
}

function questionDecoration(
  pending: PendingQuestion,
  hostId: string,
  worktreeId: string,
  location: string | null
): Decoration {
  const question = questionNotificationContent(pending.prompt, { agent: pending.agent, location })
  const picks: Record<string, number> = {}
  const actions: PromptNotificationCategoryAction[] = []
  for (const action of question.actions) {
    if ('pick' in action) {
      picks[action.identifier] = action.pick
      actions.push({ identifier: action.identifier, label: action.label })
    } else {
      actions.push({ identifier: action.identifier, label: action.label, textInput: action.textInput })
    }
  }
  return {
    title: question.title,
    body: question.body,
    actions,
    answerData: {
      hostId,
      worktreeId,
      // The whole canonical prompt, not a digest: a tap sends keystrokes built
      // from whatever is pending THEN, so it has to know this is still it.
      questionKey: nativeChatAskDismissKey(pending.prompt) ?? '',
      picks
    }
  }
}

function decorationFor(
  pending: PendingPrompt,
  hostId: string,
  worktreeId: string,
  location: string | null
): Decoration | null {
  switch (pending.kind) {
    case 'permission':
      return permissionDecoration(pending, hostId, worktreeId)
    case 'question':
      return questionDecoration(pending, hostId, worktreeId, location)
    default: {
      const exhaustive: never = pending
      return exhaustive
    }
  }
}

/**
 * Replace a notification's caption with the prompt it is actually about, and
 * hang the buttons that answer it.
 *
 * Why the caption needs replacing at all: the desktop composes the body from
 * recent terminal output, so a permission ask arrived captioned with the
 * PREVIOUS command's stdout — "Exit code 1 pages=2 pageheight=841.89 pdftotext
 * version 4.00 Copyright..." next to Claude's own banner naming the tool and
 * showing the command — and a question arrived as "Using AskUserQuestion", the
 * tool's name. The desktop has the right fields (`agentToolName`,
 * `agentToolInput`) and does not forward them, and it is stock Orca, so the
 * phone asks for itself.
 *
 * Returns the content UNCHANGED on every failure. The decoration is an
 * improvement on a notification that already works; a prompt that never
 * appeared because a lookup was slow or refused would be a far worse bug than
 * the wrong caption it was meant to fix.
 */
export async function decorateWithPrompt(
  content: DecoratableContent,
  /** The desktop's event. Its raw title carries "<repo> / <worktree>", which a
   *  question's fallback title says. */
  event: { worktreeId?: string; title?: string },
  hostId: string,
  deps: PermissionDecorationDeps
): Promise<DecoratableContent> {
  try {
    const worktreeId = event.worktreeId
    if (!worktreeId) {
      // Without it there is nothing to ask about and nowhere to send an answer.
      return content
    }
    const client = deps.resolveClient(hostId)
    if (!client) {
      return content
    }
    const pending = await deps.lookup(client, worktreeId)
    if (!pending) {
      return content
    }
    const location = event.title === undefined ? null : desktopNotificationLocation(event.title)
    const decoration = decorationFor(pending, hostId, worktreeId, location)
    if (!decoration) {
      return content
    }
    const categoryIdentifier = await deps.ensureCategory(decoration.actions)
    if (!categoryIdentifier) {
      // The buttons are the point. Without them, the caption alone is still an
      // improvement, so keep it and drop only the actions.
      return { ...content, title: decoration.title, body: decoration.body }
    }
    return {
      ...content,
      title: decoration.title,
      body: decoration.body,
      categoryIdentifier,
      data: { ...content.data, ...decoration.answerData }
    }
  } catch {
    return content
  }
}
