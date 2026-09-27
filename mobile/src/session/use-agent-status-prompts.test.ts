import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import type { StatusSubagentMessage } from './mobile-native-chat-agent-messages'
import { useAgentStatusPrompts } from './use-agent-status-prompts'

// Re-review of a6857609..235dfa20: the first status the phone reads after a
// reconnect can carry a subagent message taken while it was away, minutes
// old, its row long off the screen. Timed by that read it paired with the
// sender's next row and gave it the old words.
describe("a subagent message's copy on the tab status, across a reconnect", () => {
  const wrap = (from: string, words: string) => `<agent-message from="${from}"> ${words} </agent-message>`
  const statusOf = (prompt: string): AgentStatusPromptSource => ({ prompt, updatedAt: 1 })

  it('is untimed when it is the first status read after the link came back, and timed when read live', () => {
    let messages: readonly StatusSubagentMessage[] = []
    function Chat({ status, connected }: { status: AgentStatusPromptSource; connected: boolean }) {
      messages = useAgentStatusPrompts('sess-1', status, undefined, connected).agentMessages
      return null
    }
    let renderer!: ReactTestRenderer
    const show = (status: AgentStatusPromptSource, connected: boolean) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, { status, connected }))
        } else {
          renderer = create(createElement(Chat, { status, connected }))
        }
      })
    show(statusOf(''), true)
    const live = statusOf(wrap('a1111111111111111', 'read live'))
    show(live, true)
    show(live, false)
    // Back, still holding the status it read before the drop.
    show(live, true)
    show(statusOf(wrap('a7a46867b4f497c96', 'taken while the phone was away')), true)
    show(statusOf(wrap('a2222222222222222', 'read live again')), true)
    act(() => renderer.unmount())
    expect(messages.map((message) => [message.body, message.seenAt === undefined ? 'untimed' : 'timed'])).toEqual([
      ['read live', 'timed'],
      ['taken while the phone was away', 'untimed'],
      ['read live again', 'timed']
    ])
  })

  // Combined review of fix/prompt-leak, 2026-09-27: the latch took `null` for
  // "nothing pending", and a tab status can itself be null, so coming back to
  // a null status disarmed it and the first status after was read as live.
  it('is untimed after a reconnect that came back to no status at all', () => {
    let messages: readonly StatusSubagentMessage[] = []
    function Chat({ status, connected }: { status: AgentStatusPromptSource; connected: boolean }) {
      messages = useAgentStatusPrompts('sess-1', status, undefined, connected).agentMessages
      return null
    }
    let renderer!: ReactTestRenderer
    const show = (status: AgentStatusPromptSource, connected: boolean) =>
      act(() => {
        if (renderer) {
          renderer.update(createElement(Chat, { status, connected }))
        } else {
          renderer = create(createElement(Chat, { status, connected }))
        }
      })
    show(statusOf(''), true)
    show(statusOf(wrap('a1111111111111111', 'read live')), true)
    show(null, false)
    show(null, true)
    show(statusOf(wrap('a7a46867b4f497c96', 'taken while the phone was away')), true)
    act(() => renderer.unmount())
    expect(messages.map((message) => [message.body, message.seenAt === undefined ? 'untimed' : 'timed'])).toEqual([
      ['read live', 'timed'],
      ['taken while the phone was away', 'untimed']
    ])
  })
})
