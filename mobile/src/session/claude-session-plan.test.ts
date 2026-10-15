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

  it('the degenerate lists: none, and the plan as the only row', () => {
    expect(claudeSessionPlan([], null)).toBeNull()
    expect(claudeSessionPlan([planCall('# Only')], null)).toBe('# Only')
  })
})
