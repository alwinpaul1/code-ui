import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { inFlightToolCall } from './mobile-native-chat-in-flight-call'

// The sweep after "Running an Agent animation gets stuck" (2026-10-11): the
// same shape on the ordinary tool row. Its "Running" row follows the call
// Orca's selector picks, which reads only the call's state.
describe('the call a structured turn draws as "Running"', () => {
  const bash = (state?: 'running' | 'completed', callId = 'c1'): NativeChatBlock => ({
    type: 'tool-call',
    name: 'Bash',
    input: { command: 'pnpm test' },
    callId,
    ...(state ? { state } : {})
  })
  const result = (callId = 'c1'): NativeChatBlock => ({ type: 'tool-result', output: 'ok', callId })

  it('is the call still marked running with no result yet', () => {
    const call = bash('running')
    expect(inFlightToolCall([call], { activeTurnIsWorking: true })).toBe(call)
  })

  it('is none once its result has landed, though the lane still marks it running', () => {
    expect(inFlightToolCall([bash('running'), result()], { activeTurnIsWorking: true })).toBeNull()
  })

  it('is none once a stateless call has its result, while the turn thinks on', () => {
    expect(inFlightToolCall([bash(), result()], { activeTurnIsWorking: true })).toBeNull()
  })

  it('is a stateless call with no result while the turn works, and none once the turn has ended', () => {
    const call = bash()
    expect(inFlightToolCall([call], { activeTurnIsWorking: true })).toBe(call)
    expect(inFlightToolCall([call], { activeTurnIsWorking: false })).toBeNull()
  })

  it('is the newest call when an older one has answered', () => {
    const newer = bash('running', 'c2')
    expect(inFlightToolCall([bash('completed'), result(), newer], { activeTurnIsWorking: true })).toBe(newer)
  })

  it('is none for an empty run, and for a lone result', () => {
    expect(inFlightToolCall([], { activeTurnIsWorking: true })).toBeNull()
    expect(inFlightToolCall([result()], { activeTurnIsWorking: true })).toBeNull()
  })
})
