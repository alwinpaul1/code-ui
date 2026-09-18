import type { RpcClient } from '../transport/rpc-client'
import { parseAskFromStatus, type AskPrompt } from '../../../src/shared/native-chat-ask'
import { parseApprovalFromStatus } from '../session/mobile-native-chat-permission'
import type { MobileChatPermission } from '../session/mobile-native-chat-permission'
import { permissionAgentStatus, permissionTerminalList } from './permission-lookup-operations'

/**
 * How many agent terminals in one worktree are worth asking. A worktree with
 * more than this running at once is possible, and asking all of them would make
 * a notification wait on a fan-out for a prompt that is almost certainly in the
 * first one or two.
 */
const MAX_TERMINALS_QUERIED = 4

/**
 * What an agent in this worktree is waiting on, or null.
 *
 * Why this has to ask the host at all: the notification event carries a title,
 * a body and some ids, and nothing about what is being asked. The desktop HAS
 * the answer — `NotificationDispatchRequest` has `agentToolName` and
 * `agentToolInput` — but does not forward them, and the desktop is stock Orca.
 * The prompt itself lives in `agentStatus.interactivePrompt`, which the
 * phone otherwise only sees through the subscription belonging to an open
 * session screen. With the app closed, which is when a notification matters,
 * nothing on the phone knows what the agent wants.
 *
 * Two things can be there. A permission ask is the approval envelope
 * `{ approval: { tool, summary } }`; a question is the question tool's own
 * input, verbatim (`{ questions: [...] }`) — the host's Claude and Codex
 * reducers both return `JSON.stringify(tool_input)` for AskUserQuestion and
 * request_user_input. Each is parsed by the parser the chat card already uses
 * for it; nothing here reads the JSON itself.
 *
 * Asking is safe at this moment specifically: the notification arrived over the
 * link, so the link is up by definition.
 *
 * Every failure returns null and the caller shows the desktop's own
 * notification. A decorated banner is an improvement, never a requirement, and
 * a permission ask that never appears because a lookup threw would be a far
 * worse bug than the plain caption it replaced.
 */
export type PendingPermission = {
  kind: 'permission'
  permission: MobileChatPermission
  /** The terminal the prompt is waiting in — an answer has to go back to it,
   *  and a worktree can hold several agents. */
  terminal: string
  /** The host's name for the agent in that terminal ('claude', 'codex', …). */
  agent: string
}

export type PendingQuestion = {
  kind: 'question'
  prompt: AskPrompt
  terminal: string
  /** Decides the keystrokes: Claude's selector and Codex's overlay differ. */
  agent: string
}

export type PendingPrompt = PendingPermission | PendingQuestion

function pendingFromStatus(
  interactivePrompt: string | null,
  terminal: string,
  agent: string
): PendingPrompt | null {
  const permission = parseApprovalFromStatus(interactivePrompt)
  if (permission) {
    return { kind: 'permission', permission, terminal, agent }
  }
  // A clipped or malformed prompt fails JSON.parse inside and yields null: half
  // a question is no question, and the banner then stays the desktop's own.
  const prompt = parseAskFromStatus(interactivePrompt)
  if (prompt) {
    return { kind: 'question', prompt, terminal, agent }
  }
  return null
}

export async function lookupPendingPrompt(
  client: RpcClient,
  worktreeId: string
): Promise<PendingPrompt | null> {
  try {
    if (client.getState() !== 'connected') {
      return null
    }
    const terminals = permissionTerminalList.interpret(
      await permissionTerminalList.request(client, {
        worktree: worktreeId,
        // Why: a stale handle answers agentStatus for a PTY that has gone, and
        // the prompt it reports belongs to nothing.
        requireFreshPtyLiveness: true
      })
    )
    if (terminals === null) {
      return null
    }
    const candidates = terminals
      .flatMap((terminal) =>
        terminal.agent === null ? [] : [{ handle: terminal.handle, agent: terminal.agent }]
      )
      .slice(0, MAX_TERMINALS_QUERIED)
    for (const terminal of candidates) {
      const status = permissionAgentStatus.interpret(
        await permissionAgentStatus.request(client, { terminal: terminal.handle })
      )
      const pending = pendingFromStatus(status, terminal.handle, terminal.agent)
      if (pending) {
        return pending
      }
    }
    return null
  } catch {
    return null
  }
}
