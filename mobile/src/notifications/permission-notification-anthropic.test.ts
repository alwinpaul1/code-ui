/**
 * Parity audit 2026-10-15, gap 8: a permission banner's Approve, Deny and Deny with comment went
 * to the desktop terminal as keys, so with the relay down a tap answered nothing ("offline"),
 * while the Claude app answers the same prompt with a `control_response` on the session. When a
 * live Anthropic lane holds that prompt, the tap now answers it there; the terminal stays the
 * fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerPermissionFromNotification } from './permission-notification-response'
import { PERMISSION_COMMENT_ACTION } from './permission-notification-content'
import { mobileChatPermissionKey, parseApprovalFromStatus } from '../session/mobile-native-chat-permission'
import { answerCcrPermissionFromNotification, registerCcrPermissionAnswerer, resetCcrPermissionAnswerersForTests } from '../session/ccr-permission-answerers'
import type { CcrPendingPermission } from '../session/ccr-permission-request'

const ESCAPE = String.fromCharCode(27)
// The banner as the terminal path builds it from Orca's approval envelope.
const banner = parseApprovalFromStatus(JSON.stringify({ approval: { tool: 'Bash', summary: 'npm test' } }))!
const data = { hostId: 'h', worktreeId: 'w', permissionKey: mobileChatPermissionKey(banner), sends: { 'permission:0': '1', 'permission:1': ESCAPE }, comment: true }
const pending: CcrPendingPermission = { requestId: 'req-1', toolName: 'Bash', toolUseId: 'toolu_1', input: { command: 'npm test' }, displayName: null, description: null, decisionReason: null, blockedPath: null, suggestions: [], noAlways: false }

function lane(held: CcrPendingPermission | null = pending, ok = true) {
  const answers: { choice: string; comment?: string }[] = []
  registerCcrPermissionAnswerer('h', 'w', 'tab-1', {
    pending: () => held,
    answer: async (_pending, choice, comment) => {
      answers.push({ choice, ...(comment ? { comment } : {}) })
      return ok
    }
  })
  return answers
}

const terminalSend = vi.fn(async () => true)
const tap = (actionIdentifier: string, userText: string | null = null) =>
  answerPermissionFromNotification({
    actionIdentifier,
    userText,
    data,
    // The relay is down: no client to the desktop.
    resolveClient: () => null,
    lookup: async () => null,
    send: terminalSend,
    viaAnthropic: answerCcrPermissionFromNotification
  })

afterEach(() => {
  resetCcrPermissionAnswerersForTests()
  terminalSend.mockClear()
})

describe('a permission banner tapped while the relay is down', () => {
  it('approves through the Anthropic lane holding the same prompt', async () => {
    const answers = lane()
    expect(await tap('permission:0')).toBe('sent')
    expect(answers).toEqual([{ choice: 'allow' }])
    expect(terminalSend).not.toHaveBeenCalled()
  })

  it('denies, and denies with the typed comment, through the same lane', async () => {
    const answers = lane()
    expect(await tap('permission:1')).toBe('sent')
    expect(await tap(PERMISSION_COMMENT_ACTION, 'run only the unit tests')).toBe('sent')
    expect(answers).toEqual([{ choice: 'deny' }, { choice: 'deny', comment: 'run only the unit tests' }])
  })

  it('says it failed when the lane could not post the answer', async () => {
    lane(pending, false)
    expect(await tap('permission:0')).toBe('failed')
  })

  it('answers nothing through Anthropic for a prompt the lane does not hold, and falls back to the terminal path', async () => {
    const answers = lane({ ...pending, input: { command: 'rm -rf /' } })
    expect(await tap('permission:0')).toBe('unroutable')
    expect(answers).toEqual([])
  })

  it('answers nothing through Anthropic when two tabs in the worktree hold a matching prompt', async () => {
    const answers = lane()
    registerCcrPermissionAnswerer('h', 'w', 'tab-2', { pending: () => pending, answer: async () => true })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await tap('permission:0')).toBe('unroutable')
    expect(answers).toEqual([])
  })

  it('stays on the terminal path with no lane at all', async () => {
    expect(await tap('permission:0')).toBe('unroutable')
  })
})
