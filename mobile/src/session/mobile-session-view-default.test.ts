import { describe, expect, it } from 'vitest'
import {
  chatDefaultAgent,
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

describe('which agent decides a tab default view', () => {
  it('lets a launched or hook-owned agent open its tab in chat', () => {
    expect(chatDefaultAgent('claude', 'launch')).toBe('claude')
    expect(chatDefaultAgent('claude', 'status')).toBe('claude')
    expect(chatDefaultAgent('codex', 'beacon')).toBe('codex')
  })

  it('leaves a terminal someone typed the agent into in the terminal view', () => {
    // The toggle is offered either way; only the DEFAULT is withheld, so the
    // view does not flip while the person is still typing in it.
    expect(chatDefaultAgent('claude', 'transcript')).toBeNull()
    expect(defaultSessionViewForAgent(chatDefaultAgent('claude', 'transcript'), 'chat')).toBe(
      'terminal'
    )
    expect(defaultSessionViewForAgent(chatDefaultAgent('claude', 'launch'), 'chat')).toBe('chat')
  })

  it('has nothing to say when no agent was identified', () => {
    expect(chatDefaultAgent(null, 'launch')).toBeNull()
    expect(chatDefaultAgent(undefined, undefined)).toBeNull()
  })
})
