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

  // Review 2026-09-30: the exclusion was only a skip inside the history walk. With no other chat
  // in the history, the "newest remaining" fallback read the whole chat-capable list, the excluded
  // tab included, and so answered the caller itself over another open chat.
  it('lands on another open chat the caller never visited, not on the caller itself', () => {
    const plan = resolveChatTargetTab({
      tabs: [terminalTab('other-chat', 'claude'), terminalTab('this-terminal', 'claude')],
      visitHistory: ['this-terminal'],
      excludeTabId: 'this-terminal',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('other-chat')
  })

  it('takes the newest other chat when none of them was ever visited', () => {
    const plan = resolveChatTargetTab({
      tabs: [
        terminalTab('first-chat', 'claude'),
        terminalTab('this-terminal', 'claude'),
        terminalTab('second-chat', 'codex')
      ],
      visitHistory: [],
      excludeTabId: 'this-terminal',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('second-chat')
  })

  it('still prefers the other chat visited most recently', () => {
    const plan = resolveChatTargetTab({
      tabs: [
        terminalTab('first-chat', 'claude'),
        terminalTab('second-chat', 'claude'),
        terminalTab('this-terminal', 'claude')
      ],
      visitHistory: ['second-chat', 'first-chat', 'this-terminal'],
      excludeTabId: 'this-terminal',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('first-chat')
  })

  it('is null with no tabs at all, whatever it excludes', () => {
    expect(
      resolveChatTargetTab({
        tabs: [],
        visitHistory: ['gone'],
        excludeTabId: 'gone',
        nativeChatTranscriptIsLocalReadable: false
      })
    ).toBeNull()
  })

  it('answers the caller itself when it is the only chat open (the pinned self-ask)', () => {
    // mobile-terminal-ask-about-screen-plan.test.ts pins this: a Claude terminal asked about its
    // own screen with no other chat open puts the text in its own composer.
    const plan = resolveChatTargetTab({
      tabs: [terminalTab('this-terminal', 'claude')],
      visitHistory: ['this-terminal'],
      excludeTabId: 'this-terminal',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('this-terminal')
  })

  it('answers the one other chat when the caller is not in the list at all', () => {
    const plan = resolveChatTargetTab({
      tabs: [terminalTab('only-chat', 'claude')],
      visitHistory: [],
      excludeTabId: 'closed-tab',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('only-chat')
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
