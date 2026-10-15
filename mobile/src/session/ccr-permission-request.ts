import type { CcrEvent } from './ccr-session-api'
import { ccrCseId } from './ccr-send'
import type { CcrEventsBody } from './ccr-control-request'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import type { TerminalPermissionMode } from './claude-terminal-mode-footer'

/**
 * Permission prompts and the permission mode of a Claude tab matched to its Remote Control
 * session, read off Anthropic's events and answered there, as the Claude Android app 1.261013.20
 * does (jadx, R8 names of that build):
 *
 *  - the prompt: a `control_request` event (`SdkControlRequestEvent`, e7u.java: `type`,
 *    `request_id`, `request`, `uuid`, `parent_tool_use_id`) whose `request.subtype` is
 *    `can_use_tool` (du00.java) with `tool_use_id`, `tool_name`, `display_name`, `title`,
 *    `description`, `input`, `permission_suggestions`, `suppress_always_allow_rule`,
 *    `decision_reason`, … (yea.java). It stands until a `control_response` answers its
 *    `request_id` (from any client) or a `control_cancel_request` names it (y7u.java:20).
 *  - the answer (`q84.d`, q84.java:505-573): a `StdinMessage.ControlResponse` (ohx/mhx)
 *    `{type: "control_response", uuid, response: {subtype: "success", request_id, response:
 *    {behavior, toolUseID, tool_name?, updatedInput?, updatedPermissions?, message?}}}`
 *    (`ControlResponseBody` gfa, `ControlResponsePayload` jfa). Allow carries the tool name and
 *    the request's own input as `updatedInput`; Deny carries `message`, "Denied by user" unless a
 *    comment was given. "Always" adds `updatedPermissions` (`q84.b` filters the request's
 *    `permission_suggestions`; here the suggestions are passed as they came, see the report).
 *    It is posted and nothing is awaited (`drv.v0`, j7v.java:1726-1760); a refused POST is
 *    "Failed to approve tool call" / "Failed to deny tool call" (fpo.java:30-37).
 *  - the mode: the newest `system` event's `permissionMode` (`SdkSystemEvent`, jau.java:26).
 *
 * Prompts this does not draw (AskUserQuestion, ExitPlanMode, a subagent's own) stay with the
 * terminal path: their answers carry more than allow or deny, and a wrong answer is worse than
 * none (CLAUDE.md, "Prefer refusing over guessing").
 */

export const CCR_APPROVE_FAILED = 'Failed to approve tool call' // ccr_error_failed_to_approve_tool_call
export const CCR_DENY_FAILED = 'Failed to deny tool call' // ccr_error_failed_to_deny_tool_call
export const CCR_DENIED_BY_USER = 'Denied by user'

/** The card's option sends on this lane, followed by `:<request_id>`: never a key, so a terminal
 *  can never be handed one, and a tap answers the prompt it was drawn for or nothing. */
export const CCR_PERMISSION_ALLOW = 'ccr-permission:allow'
export const CCR_PERMISSION_ALWAYS = 'ccr-permission:always'
export const CCR_PERMISSION_DENY = 'ccr-permission:deny'

export type CcrPermissionChoice = 'allow' | 'always' | 'deny'

export type CcrPendingPermission = {
  requestId: string
  toolName: string
  toolUseId: string | null
  input: Record<string, unknown>
  displayName: string | null
  description: string | null
  decisionReason: string | null
  blockedPath: string | null
  suggestions: readonly unknown[]
  /** `suppress_always_allow_rule`: the request offers no "always". */
  noAlways: boolean
}

/** Tools whose prompt is not a plain allow/deny: answered on the terminal path only. */
const NOT_DRAWN_HERE: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The `request_id` a payload settles: a `control_response`'s, or a `control_cancel_request`'s. */
function settledRequestId(payload: Record<string, unknown>): string | null {
  if (payload.type === 'control_response') {
    return text(record(payload.response)?.request_id)
  }
  return payload.type === 'control_cancel_request' ? text(payload.request_id) : null
}

function readRequest(payload: Record<string, unknown>): CcrPendingPermission | null {
  if (payload.type !== 'control_request' || text(payload.parent_tool_use_id)) {
    return null
  }
  const requestId = text(payload.request_id)
  const request = record(payload.request)
  const toolName = text(request?.tool_name)
  if (!requestId || !request || request.subtype !== 'can_use_tool' || !toolName) {
    return null
  }
  return {
    requestId,
    toolName,
    toolUseId: text(request.tool_use_id),
    input: record(request.input) ?? {},
    displayName: text(request.display_name),
    description: text(request.description),
    decisionReason: text(request.decision_reason),
    blockedPath: text(request.blocked_path),
    suggestions: Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [],
    noAlways: request.suppress_always_allow_rule === true
  }
}

/**
 * The prompt the session waits on now: the newest `can_use_tool` request (events oldest first)
 * that nothing has settled, and that the phone has not answered itself (`answered`). Null when
 * there is none, or when the newest is one this lane does not draw.
 */
export function pendingCcrPermission(events: readonly CcrEvent[], answered: ReadonlySet<string> = new Set()): CcrPendingPermission | null {
  const settled = new Set<string>()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]!.payload
    const id = settledRequestId(payload)
    if (id) {
      settled.add(id)
      continue
    }
    // A turn that ended after the request was asked was not still waiting on it.
    if (payload.type === 'result') {
      return null
    }
    const request = readRequest(payload)
    if (request) {
      return settled.has(request.requestId) || answered.has(request.requestId) || NOT_DRAWN_HERE.has(request.toolName) ? null : request
    }
  }
  return null
}

/** The "always" row's words, by where the first suggestion would be saved (the app's strings). */
function alwaysLabel(suggestions: readonly unknown[]): string {
  const destination = record(suggestions[0])?.destination
  if (destination === 'session') {
    return 'Always allow for this session' // ccr_tool_approval_always_allow_for_session
  }
  if (destination === 'projectSettings' || destination === 'localSettings') {
    return 'Always allow for this project' // ccr_tool_approval_always_allow_for_project
  }
  return 'Always allow' // tool_approval_button_always_allow
}

/**
 * The prompt as the chat's permission card, in the shape Orca's own SDK lane gives it (`title:
 * "Allow <tool>?"`, `detail: JSON.stringify(input)`, mobile-permission-proposed-edit.ts), so the
 * card shows the command, the proposed edit or the raw input as it does there.
 */
export function ccrPermissionCard(pending: CcrPendingPermission): MobileChatPermission {
  const command = typeof pending.input.command === 'string' ? pending.input.command : undefined
  return {
    title: `Allow ${pending.toolName}?`,
    ...(pending.displayName ? { displayName: pending.displayName } : {}),
    ...(pending.description ? { description: pending.description } : {}),
    ...(pending.decisionReason ? { decisionReason: pending.decisionReason } : {}),
    ...(pending.blockedPath ? { blockedPath: pending.blockedPath } : {}),
    ...(command ? { command } : {}),
    detail: JSON.stringify(pending.input),
    options: [
      { label: 'Allow once', send: `${CCR_PERMISSION_ALLOW}:${pending.requestId}` }, // ccr_tool_approval_allow_once
      ...(pending.suggestions.length > 0 && !pending.noAlways ? [{ label: alwaysLabel(pending.suggestions), send: `${CCR_PERMISSION_ALWAYS}:${pending.requestId}` }] : []),
      { label: 'Deny', send: `${CCR_PERMISSION_DENY}:${pending.requestId}` } // ccr_tool_approval_deny
    ]
  }
}

/** The choice a card option's send stands for on this lane, and the prompt it was drawn for; null
 *  for any other send. */
export function ccrPermissionChoice(send: string): { choice: CcrPermissionChoice; requestId: string } | null {
  const choices: readonly [string, CcrPermissionChoice][] = [
    [CCR_PERMISSION_ALLOW, 'allow'],
    [CCR_PERMISSION_ALWAYS, 'always'],
    [CCR_PERMISSION_DENY, 'deny']
  ]
  for (const [prefix, choice] of choices) {
    if (send.startsWith(`${prefix}:`) && send.length > prefix.length + 1) {
      return { choice, requestId: send.slice(prefix.length + 1) }
    }
  }
  return null
}

/** The POST body answering a prompt, as `q84.d` builds it. `comment`: Deny with comment's words. */
export function buildCcrPermissionResponseBody(args: { sessionId: string; uuid: string; pending: CcrPendingPermission; choice: CcrPermissionChoice; comment?: string }): CcrEventsBody {
  const { pending, choice } = args
  const allow = choice !== 'deny'
  const response: Record<string, unknown> = { behavior: allow ? 'allow' : 'deny' }
  if (pending.toolUseId) {
    response.toolUseID = pending.toolUseId
  }
  if (allow) {
    response.tool_name = pending.toolName
    response.updatedInput = pending.input
    if (choice === 'always' && pending.suggestions.length > 0) {
      response.updatedPermissions = pending.suggestions
    }
  } else {
    response.message = args.comment && args.comment.trim() ? args.comment : CCR_DENIED_BY_USER
  }
  return {
    session_id: ccrCseId(args.sessionId),
    events: [{ payload: { type: 'control_response', uuid: args.uuid, response: { subtype: 'success', request_id: pending.requestId, response } } }]
  }
}

/** The session's permission mode by its own word: the newest top-level `system` event that states
 *  one (events oldest first), with that event's key so a newer statement can retire a pick; null
 *  when none does or it names a mode the phone does not draw. */
export function ccrStatedPermissionMode(events: readonly CcrEvent[]): { mode: TerminalPermissionMode; key: string } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]!.payload
    if (payload.type !== 'system' || text(payload.parent_tool_use_id) || typeof payload.permissionMode !== 'string') {
      continue
    }
    switch (payload.permissionMode) {
      case 'default':
      case 'acceptEdits':
      case 'plan':
      case 'auto':
      case 'bypassPermissions':
        return { mode: payload.permissionMode, key: text(payload.uuid) ?? events[index]!.eventId ?? `#${events[index]!.sequenceNum ?? index}` }
      default:
        return null
    }
  }
  return null
}

/** The mode a pick asks for, in the session's words: the pill's 'manual' is Claude Code's 'default'. */
export function ccrPermissionModeName(mode: TerminalPermissionMode): string {
  return mode === 'manual' ? 'default' : mode
}
