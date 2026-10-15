import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import { claudeSessionPlan } from './claude-session-plan'

// The Claude app's session bar draws a "Plan" pill (`session_pill_plan`, read "Open plan",
// `ccr_session_bar_open_plan`; 1.261013.20 ns30.java:610-651, u8z.java:3806) once Claude has
// proposed a plan, and not while that plan's approval is still asked (ys8.d: a plan and no pending
// plan prompt). Plan mode alone draws no pill. The plan is what Claude proposed: ExitPlanMode's
// `plan` input.

let seq = 0
function planCall(plan: unknown, asString = false): NativeChatMessage {
  seq += 1
  const input = asString ? JSON.stringify({ plan }) : { plan }
  return { id: `a${seq}`, role: 'assistant', blocks: [{ type: 'tool-call', name: 'ExitPlanMode', input, callId: `t${seq}` }], timestamp: null, source: 'transcript' }
}
/** The tool result answering the newest `planCall` (by its callId, or positionally with none). */
function planResult(output: string, opts: { isError?: boolean; callId?: string | null } = {}): NativeChatMessage {
  const callId = opts.callId === null ? undefined : (opts.callId ?? `t${seq}`)
  return {
    id: `r${(seq += 1)}`,
    role: 'user',
    blocks: [{ type: 'tool-result', output, ...(opts.isError ? { isError: true } : {}), ...(callId ? { callId } : {}) }],
    timestamp: null,
    source: 'transcript'
  }
}
// Claude Code's own answers to ExitPlanMode (the turn-down wording is the one every tool gets,
// mobile-background-task-transcript.ts ANY_TOOL_FAILURE; the approval is plan-and-question-rows-stand-alone.test.ts's).
const APPROVED = 'User has approved your plan.'
const TURNED_DOWN =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
const said = (text: string): NativeChatMessage => ({ id: `s${(seq += 1)}`, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' })
const bash: NativeChatMessage = { id: 'b1', role: 'assistant', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'ls', plan: 'not a plan' } }], timestamp: null, source: 'transcript' }
const planReview = { options: [{ label: 'Yes, and use auto mode' }, { label: 'No, keep planning' }, { label: 'Tell Claude what to change' }] } as unknown as MobileChatPermission
const bashPrompt = { options: [{ label: 'Yes' }, { label: 'No' }] } as unknown as MobileChatPermission

describe('the plan the Plan pill opens', () => {
  it('is the newest plan Claude proposed', () => {
    expect(claudeSessionPlan([planCall('# First'), said('ok'), planCall('# Second')], null)).toBe('# Second')
  })

  it('reads a plan whose input arrived as a JSON string', () => {
    expect(claudeSessionPlan([planCall('# Plan', true)], null)).toBe('# Plan')
  })

  it('draws no pill while that plan’s approval is still asked', () => {
    expect(claudeSessionPlan([planCall('# Plan')], planReview)).toBeNull()
  })

  it('keeps the pill under any other prompt', () => {
    expect(claudeSessionPlan([planCall('# Plan')], bashPrompt)).toBe('# Plan')
  })

  it('draws no pill for a session with no plan, an empty one, or another tool’s `plan` input', () => {
    expect(claudeSessionPlan([said('hello'), bash], null)).toBeNull()
    expect(claudeSessionPlan([planCall('   ')], null)).toBeNull()
    expect(claudeSessionPlan([planCall(42)], null)).toBeNull()
  })

  // Review 2026-10-15: the pill opened a plan the user had turned down.
  describe('a plan the user turned down', () => {
    it('draws no pill for a rejected plan', () => {
      const call = planCall('# Rejected')
      expect(claudeSessionPlan([call, planResult(TURNED_DOWN, { isError: true })], null)).toBeNull()
    })

    it('draws no pill for a turn-down that lost its error flag, read by its words', () => {
      expect(claudeSessionPlan([planCall('# Rejected'), planResult(TURNED_DOWN)], null)).toBeNull()
    })

    it('draws no pill for a denied plan, and does not fall back to an older approved one', () => {
      const older = planCall('# Older')
      const olderApproved = planResult(APPROVED)
      const newer = planCall('# Newer')
      expect(claudeSessionPlan([older, olderApproved, newer, planResult('Permission to use ExitPlanMode has been denied.', { isError: true })], null)).toBeNull()
    })

    it('pairs a result with no callId to the call before it', () => {
      expect(claudeSessionPlan([planCall('# Rejected'), planResult(TURNED_DOWN, { isError: true, callId: null })], null)).toBeNull()
    })

    it('ignores another call’s rejection', () => {
      const plan = planCall('# Plan')
      expect(claudeSessionPlan([plan, planResult(APPROVED), planResult(TURNED_DOWN, { isError: true, callId: 'toolu_other' })], null)).toBe('# Plan')
    })

    it('keeps the pill for an approved plan', () => {
      expect(claudeSessionPlan([planCall('# Approved'), planResult(APPROVED)], null)).toBe('# Approved')
    })

    it('the rejection as the only row draws no pill', () => {
      expect(claudeSessionPlan([planResult(TURNED_DOWN, { isError: true })], null)).toBeNull()
    })
  })

  it('the degenerate lists: none, and the plan as the only row', () => {
    expect(claudeSessionPlan([], null)).toBeNull()
    expect(claudeSessionPlan([planCall('# Only')], null)).toBe('# Only')
  })
})
