import { describe, expect, it } from 'vitest'
import { planTerminalAskAboutScreen } from './mobile-terminal-ask-about-screen-plan'
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

describe('planning where "Ask about this screen" should land', () => {
  it('lands on itself when this terminal is the chat tab and nothing else was visited more recently', () => {
    const tabs = [terminalTab('this-terminal', 'claude')]
    const plan = planTerminalAskAboutScreen({
      tabs,
      visitHistory: ['this-terminal'],
      terminalTabId: 'this-terminal',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('this-terminal')
    expect(plan?.agent).toBe('claude')
  })

  it('is absent — null — on a plain shell with no other chat-capable tab open', () => {
    const tabs = [terminalTab('plain-shell', null)]
    const plan = planTerminalAskAboutScreen({
      tabs,
      visitHistory: ['plain-shell'],
      terminalTabId: 'plain-shell',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan).toBeNull()
  })

  it('routes a plain shell to another open chat tab when one exists', () => {
    const tabs = [terminalTab('claude-chat', 'claude'), terminalTab('plain-shell', null)]
    const plan = planTerminalAskAboutScreen({
      tabs,
      visitHistory: ['claude-chat', 'plain-shell'],
      terminalTabId: 'plain-shell',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('claude-chat')
  })

  it('resolves a Codex pane the same way a Claude one resolves', () => {
    const tabs = [terminalTab('codex-chat', 'codex'), terminalTab('plain-shell', null)]
    const plan = planTerminalAskAboutScreen({
      tabs,
      visitHistory: ['codex-chat', 'plain-shell'],
      terminalTabId: 'plain-shell',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('codex-chat')
    expect(plan?.agent).toBe('codex')
  })
})
