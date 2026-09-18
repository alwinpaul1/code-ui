import { describe, expect, it } from 'vitest'
import { resolveChatTargetTab } from './mobile-chat-target-tab'
import type { MobileSessionTab } from './mobile-session-route-types'

function terminalTab(id: string, agentType: string | null): Extract<MobileSessionTab, { type: 'terminal' }> {
  return {
    type: 'terminal',
    id,
    title: id,
    terminal: id,
    agentStatus: agentType ? { agentType } : null,
    isActive: false
  }
}

describe('resolving which chat-capable tab a gesture should land on', () => {
  it('is null with no chat-capable tab open at all', () => {
    const plan = resolveChatTargetTab({
      tabs: [terminalTab('shell', null)],
      visitHistory: ['shell'],
      excludeTabId: null,
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan).toBeNull()
  })

  it('excluding a tab that is not itself chat-capable changes nothing — it was never a candidate', () => {
    // Same shape mobile-file-reader-ask-about-lines-plan.ts relies on: the
    // excluded id (a file tab there) is never in the chat-capable filter, so
    // skipping it in the history walk-back is a no-op.
    const tabs = [terminalTab('chat', 'claude'), terminalTab('shell', null)]
    const withExclude = resolveChatTargetTab({
      tabs,
      visitHistory: ['chat', 'shell'],
      excludeTabId: 'shell',
      nativeChatTranscriptIsLocalReadable: false
    })
    const withoutExclude = resolveChatTargetTab({
      tabs,
      visitHistory: ['chat', 'shell'],
      excludeTabId: null,
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(withExclude?.targetTab.id).toBe('chat')
    expect(withoutExclude?.targetTab.id).toBe('chat')
  })

  it('excluding a chat-capable tab that IS the most recent one routes to the next one instead', () => {
    // This is the shape "Ask about this screen" needs: asking about a
    // terminal that is itself showing native chat must not just resolve to
    // itself trivially — it should still consider other open chat tabs.
    const tabs = [terminalTab('older-chat', 'claude'), terminalTab('this-terminal', 'claude')]
    const plan = resolveChatTargetTab({
      tabs,
      visitHistory: ['older-chat', 'this-terminal'],
      excludeTabId: 'this-terminal',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('older-chat')
  })

  it('resolves the agent for whichever tab it lands on, Codex included', () => {
    const tabs = [terminalTab('chat', 'codex')]
    const plan = resolveChatTargetTab({
      tabs,
      visitHistory: ['chat'],
      excludeTabId: null,
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.agent).toBe('codex')
  })
})
