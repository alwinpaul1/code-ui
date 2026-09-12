import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { interimAssistantMessageIds } from './mobile-native-chat-interim'

function user(id: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text: 'go' }], timestamp: 0, source: 'transcript' }
}
function prose(id: string, text = 'note'): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}
function tools(id: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'tool-call', id: `${id}-c`, name: 'Bash', input: {} }],
    timestamp: 0,
    source: 'transcript'
  }
}

// Claude app, 2026-09-12: "Found that the live-edge follow keeps pulling…"
// sat in a quote block because tool calls and the real answer followed it.
describe('interim assistant notes', () => {
  it('marks a note that tools and an answer followed, and leaves the answer plain', () => {
    const ids = interimAssistantMessageIds([user('u1'), prose('a1'), tools('t1'), prose('a2')])
    expect([...ids]).toEqual(['a1'])
  })

  it('marks every note before the answer', () => {
    const ids = interimAssistantMessageIds([user('u1'), prose('a1'), tools('t1'), prose('a2'), tools('t2'), prose('a3')])
    expect([...ids].sort()).toEqual(['a1', 'a2'])
  })

  it('never marks the last prose of a turn, even while the turn is still open', () => {
    expect([...interimAssistantMessageIds([user('u1'), tools('t1'), prose('a1')])]).toEqual([])
    expect([...interimAssistantMessageIds([user('u1'), prose('a1'), tools('t1')])]).toEqual(['a1'])
  })

  it('resets at the next user message', () => {
    const ids = interimAssistantMessageIds([user('u1'), prose('a1'), user('u2'), prose('a2')])
    expect([...ids]).toEqual([])
  })
})
