/**
 * A matched Claude tab draws the permission prompt the session waits on from Anthropic's own
 * `control_request` and answers it with a `control_response`, as the Claude app 1.261013.20 does
 * (yea.java, q84.java:505-573, y7u.java), so a prompt can be answered while the relay to the
 * desktop is down. The event shapes follow the app's deserialisers; the live wire was not
 * captured with a prompt in it (see the report's probe list).
 */
import { describe, expect, it } from 'vitest'
import type { CcrEvent } from './ccr-session-api'
import {
  buildCcrPermissionResponseBody,
  CCR_PERMISSION_ALLOW,
  CCR_PERMISSION_ALWAYS,
  CCR_PERMISSION_DENY,
  ccrPermissionCard,
  ccrPermissionChoice,
  ccrPermissionModeName,
  ccrStatedPermissionMode,
  pendingCcrPermission
} from './ccr-permission-request'

const SESSION = 'session_01NmzBrN6cdXv6SaRde5pR7H'
let seq = 0
const event = (payload: Record<string, unknown>): CcrEvent => ({ eventId: `e${(seq += 1)}`, sequenceNum: seq, payload: { uuid: `u${seq}`, ...payload } })

const bashRequest = (requestId: string, extra: Record<string, unknown> = {}) =>
  event({
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: `toolu_${requestId}`, input: { command: 'rm -rf build', description: 'Clean the build' }, ...extra }
  })
const responseTo = (requestId: string) => event({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'allow' } } })

describe('the prompt the session waits on', () => {
  it('shows nothing for a session with no events', () => {
    expect(pendingCcrPermission([])).toBeNull()
  })

  it('shows a Bash prompt that nothing has answered, as the only event', () => {
    const pending = pendingCcrPermission([bashRequest('r1')])
    expect(pending).toMatchObject({ requestId: 'r1', toolName: 'Bash', toolUseId: 'toolu_r1', input: { command: 'rm -rf build', description: 'Clean the build' } })
  })

  it('drops a prompt another client answered (the desktop, the Claude app)', () => {
    expect(pendingCcrPermission([bashRequest('r1'), responseTo('r1')])).toBeNull()
  })

  it('drops a prompt Claude Code withdrew with a control_cancel_request', () => {
    expect(pendingCcrPermission([bashRequest('r1'), event({ type: 'control_cancel_request', request_id: 'r1' })])).toBeNull()
  })

  it('drops a prompt whose turn has ended since', () => {
    expect(pendingCcrPermission([bashRequest('r1'), event({ type: 'result', subtype: 'success' })])).toBeNull()
  })

  it('drops a prompt the phone answered itself before the echo arrived', () => {
    expect(pendingCcrPermission([bashRequest('r1')], new Set(['r1']))).toBeNull()
  })

  it('shows the second prompt once the first is answered', () => {
    expect(pendingCcrPermission([bashRequest('r1'), responseTo('r1'), bashRequest('r2')])?.requestId).toBe('r2')
  })

  it('does not take an answer to the phone’s own control request for a prompt', () => {
    expect(pendingCcrPermission([bashRequest('r1'), responseTo('get-context-usage-1')])?.requestId).toBe('r1')
  })

  it('leaves AskUserQuestion, ExitPlanMode and a subagent’s prompt to the terminal path', () => {
    expect(pendingCcrPermission([bashRequest('r1', { tool_name: 'AskUserQuestion' })])).toBeNull()
    expect(pendingCcrPermission([bashRequest('r1', { tool_name: 'ExitPlanMode' })])).toBeNull()
    expect(pendingCcrPermission([event({ type: 'control_request', request_id: 'r1', parent_tool_use_id: 'toolu_agent', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } })])).toBeNull()
  })

  it('ignores control requests that are not permission prompts', () => {
    expect(pendingCcrPermission([event({ type: 'control_request', request_id: 'r1', request: { subtype: 'get_context_usage' } })])).toBeNull()
  })
})

describe('the card it draws', () => {
  it('draws Allow once and Deny, and the command, as Orca’s SDK lane draws a Claude prompt', () => {
    const card = ccrPermissionCard(pendingCcrPermission([bashRequest('r1')])!)
    expect(card).toEqual({
      title: 'Allow Bash?',
      command: 'rm -rf build',
      detail: '{"command":"rm -rf build","description":"Clean the build"}',
      options: [
        { label: 'Allow once', send: `${CCR_PERMISSION_ALLOW}:r1` },
        { label: 'Deny', send: `${CCR_PERMISSION_DENY}:r1` }
      ]
    })
  })

  it('offers Always allow for this session only when the request suggests a rule', () => {
    const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf build' }], behavior: 'allow', destination: 'session' }
    expect(ccrPermissionCard(pendingCcrPermission([bashRequest('r1', { permission_suggestions: [suggestion] })])!).options.map((option) => option.label)).toEqual(['Allow once', 'Always allow for this session', 'Deny'])
    expect(ccrPermissionCard(pendingCcrPermission([bashRequest('r1', { permission_suggestions: [suggestion], suppress_always_allow_rule: true })])!).options.map((option) => option.label)).toEqual(['Allow once', 'Deny'])
  })

  it('never hands a terminal key to its options, and binds each to the prompt it was drawn for', () => {
    expect([CCR_PERMISSION_ALLOW, CCR_PERMISSION_ALWAYS, CCR_PERMISSION_DENY].map((prefix) => ccrPermissionChoice(`${prefix}:r1`))).toEqual([
      { choice: 'allow', requestId: 'r1' },
      { choice: 'always', requestId: 'r1' },
      { choice: 'deny', requestId: 'r1' }
    ])
    expect(ccrPermissionChoice('1')).toBeNull()
    expect(ccrPermissionChoice(CCR_PERMISSION_ALLOW)).toBeNull()
    expect(ccrPermissionChoice(`${CCR_PERMISSION_ALLOW}:`)).toBeNull()
  })
})

describe('the answer it posts', () => {
  it('allows with the tool name and the request’s own input, as q84.d builds it', () => {
    const pending = pendingCcrPermission([bashRequest('r1')])!
    expect(buildCcrPermissionResponseBody({ sessionId: SESSION, uuid: 'u-answer', pending, choice: 'allow' })).toEqual({
      session_id: 'cse_01NmzBrN6cdXv6SaRde5pR7H',
      events: [
        {
          payload: {
            type: 'control_response',
            uuid: 'u-answer',
            response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', toolUseID: 'toolu_r1', tool_name: 'Bash', updatedInput: { command: 'rm -rf build', description: 'Clean the build' } } }
          }
        }
      ]
    })
  })

  it('adds the suggested rules on Always allow', () => {
    const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }
    const pending = pendingCcrPermission([bashRequest('r1', { permission_suggestions: [suggestion] })])!
    const answer = buildCcrPermissionResponseBody({ sessionId: SESSION, uuid: 'u', pending, choice: 'always' }).events[0]!.payload.response as { response: Record<string, unknown> }
    expect(answer.response.updatedPermissions).toEqual([suggestion])
  })

  it('denies with "Denied by user", or with the comment typed', () => {
    const pending = pendingCcrPermission([bashRequest('r1')])!
    const inner = (comment?: string) => (buildCcrPermissionResponseBody({ sessionId: SESSION, uuid: 'u', pending, choice: 'deny', ...(comment ? { comment } : {}) }).events[0]!.payload.response as { response: unknown }).response
    expect(inner()).toEqual({ behavior: 'deny', toolUseID: 'toolu_r1', message: 'Denied by user' })
    expect(inner('Use git clean instead')).toEqual({ behavior: 'deny', toolUseID: 'toolu_r1', message: 'Use git clean instead' })
  })
})

describe('the permission mode by the session’s own word', () => {
  it('is unknown with no system event', () => {
    expect(ccrStatedPermissionMode([])).toBeNull()
  })

  it('reads the newest system event that states one', () => {
    const events = [event({ type: 'system', subtype: 'init', permissionMode: 'default' }), event({ type: 'assistant' }), event({ type: 'system', subtype: 'status', permissionMode: 'auto' })]
    expect(ccrStatedPermissionMode(events)?.mode).toBe('auto')
  })

  it('does not take a subagent’s system event, or a mode the pill does not draw', () => {
    expect(ccrStatedPermissionMode([event({ type: 'system', subtype: 'init', permissionMode: 'plan' }), event({ type: 'system', parent_tool_use_id: 'toolu_x', permissionMode: 'acceptEdits' })])?.mode).toBe('plan')
    expect(ccrStatedPermissionMode([event({ type: 'system', subtype: 'init', permissionMode: 'dontAsk' })])).toBeNull()
  })

  it('asks for Manual by Claude Code’s own name for it', () => {
    expect(ccrPermissionModeName('manual')).toBe('default')
    expect(ccrPermissionModeName('acceptEdits')).toBe('acceptEdits')
  })
})
