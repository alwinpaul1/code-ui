import { describe, expect, it } from 'vitest'
import {
  defaultSessionViewForAgent,
  mobileSessionChatViewToggle
} from './mobile-session-view-default'

describe('defaultSessionViewForAgent', () => {
  it('opens Claude, OpenClaude, and Codex in Chat UI', () => {
    expect(defaultSessionViewForAgent('claude', 'chat')).toBe('chat')
    expect(defaultSessionViewForAgent('openclaude', 'chat')).toBe('chat')
    expect(defaultSessionViewForAgent('codex', 'chat')).toBe('chat')
  })

  it('opens Grok and other agents in the terminal, with Chat UI still toggleable', () => {
    expect(defaultSessionViewForAgent('grok', 'chat')).toBe('terminal')
    expect(defaultSessionViewForAgent('omp', 'chat')).toBe('terminal')
    expect(defaultSessionViewForAgent(null, 'chat')).toBe('terminal')
  })

  it('follows a device-wide terminal default for every agent', () => {
    expect(defaultSessionViewForAgent('claude', 'terminal')).toBe('terminal')
    expect(defaultSessionViewForAgent('codex', 'terminal')).toBe('terminal')
    expect(defaultSessionViewForAgent('grok', 'terminal')).toBe('terminal')
  })
})

describe('mobileSessionChatViewToggle', () => {
  it('shows the header toggle for Claude, Codex, and Grok when they can do Chat UI', () => {
    expect(
      mobileSessionChatViewToggle({ eligible: true, chatVisible: true, tabId: 'tab-claude' })
    ).toEqual({ label: 'Show terminal' })
    expect(
      mobileSessionChatViewToggle({ eligible: true, chatVisible: false, tabId: 'tab-grok' })
    ).toEqual({ label: 'Show chat' })
  })

  it('hides the toggle when Chat UI is not available for this tab', () => {
    expect(
      mobileSessionChatViewToggle({ eligible: false, chatVisible: false, tabId: 'tab-zsh' })
    ).toBeNull()
    expect(
      mobileSessionChatViewToggle({ eligible: true, chatVisible: false, tabId: null })
    ).toBeNull()
  })
})
