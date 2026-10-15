import { describe, expect, it } from 'vitest'
import { CHAT_HOLD_MS, CHAT_HOLD_SLOP_DP, createChatHoldGate } from './chat-message-hold'

// The gate a hold must pass before a message's menu opens: the user, 2026-10-15, "scrolls must
// not trigger hold to copy". Android's own numbers, which Compose's detectTapGestures uses in the
// Claude app: a 400 ms long-press timeout and an 8 dp touch slop.

describe('a hold on a chat message', () => {
  it('waits Android’s long-press timeout and minds Android’s touch slop', () => {
    expect(CHAT_HOLD_MS).toBe(400)
    expect(CHAT_HOLD_SLOP_DP).toBe(8)
  })

  it('opens for a finger that stays still on a list at rest', () => {
    const gate = createChatHoldGate()
    gate.pressIn(100, 100, true)
    expect(gate.mayOpen(true)).toBe(true)
  })

  it('opens for a finger that wanders inside the slop', () => {
    const gate = createChatHoldGate()
    gate.pressIn(100, 100, true)
    gate.move(105, 106)
    expect(gate.mayOpen(true)).toBe(true)
  })

  it('stays shut for a press that became a scroll, even if the finger comes back', () => {
    const gate = createChatHoldGate()
    gate.pressIn(100, 100, true)
    gate.move(100, 140)
    gate.move(100, 100)
    expect(gate.mayOpen(true)).toBe(false)
  })

  it('stays shut when the list began to scroll during the hold', () => {
    const gate = createChatHoldGate()
    gate.pressIn(100, 100, true)
    gate.listScrolled()
    expect(gate.mayOpen(true)).toBe(false)
  })

  it('stays shut for a finger that went down on a moving list', () => {
    const gate = createChatHoldGate()
    gate.pressIn(100, 100, false)
    expect(gate.mayOpen(true)).toBe(false)
  })

  it('stays shut while the list is moving when the timeout fires', () => {
    const gate = createChatHoldGate()
    gate.pressIn(100, 100, true)
    expect(gate.mayOpen(false)).toBe(false)
  })

  it('stays shut with no finger down, and starts clean on the next press', () => {
    const gate = createChatHoldGate()
    expect(gate.mayOpen(true)).toBe(false)
    gate.pressIn(100, 100, false)
    gate.release()
    expect(gate.mayOpen(true)).toBe(false)
    gate.pressIn(100, 100, true)
    expect(gate.mayOpen(true)).toBe(true)
  })

  it('ignores a scroll that ended before the finger went down', () => {
    const gate = createChatHoldGate()
    gate.listScrolled()
    gate.pressIn(100, 100, true)
    expect(gate.mayOpen(true)).toBe(true)
  })
})
