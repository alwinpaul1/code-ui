import { describe, expect, it } from 'vitest'
import { chatCommandOpensOverlay } from './mobile-chat-command-overlay'
import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'

describe('classifyMobileNativeChatSend', () => {
  it('recognizes OMP selectors and context commands without claiming generic help', () => {
    expect(classifyMobileNativeChatSend('omp', '/switch')).toBe('command')
    expect(classifyMobileNativeChatSend('omp', '/compact focus on tests')).toBe('command')
    expect(classifyMobileNativeChatSend('omp', '/help')).toBe('unknown-token')
    expect(classifyMobileNativeChatSend('omp', '/smol')).toBe('unknown-token')
  })

  // Code UI: an OMP command upstream describes as "in Terminal" opens a
  // selector the chat cannot drive, so the phone shows the terminal for it,
  // the way the Codex catalog's flagged entries already do; the rest answer in
  // the transcript and keep the chat.
  it('shows the terminal for the OMP commands that open a selector there, and keeps chat for the rest', () => {
    for (const command of ['/model', '/switch', '/resume', '/fork', '/branch', '/tree', '/git', '/settings', '/extensions', '/hotkeys']) {
      expect(chatCommandOpensOverlay('omp', command), command).toBe(true)
    }
    for (const command of ['/plan', '/compact focus on tests', '/clear', '/new', '/context', '/usage', '/fast', '/export']) {
      expect(chatCommandOpensOverlay('omp', command), command).toBe(false)
    }
    // Unknown to the catalog: the terminal is the safe answer.
    expect(chatCommandOpensOverlay('omp', '/help')).toBe(true)
  })

  it('classifies catalog commands per agent', () => {
    expect(classifyMobileNativeChatSend('claude', '/clear')).toBe('command')
    expect(classifyMobileNativeChatSend('claude', '/compact')).toBe('command')
    expect(classifyMobileNativeChatSend('codex', '/model')).toBe('command')
    expect(classifyMobileNativeChatSend('codex', '/permissions')).toBe('command')
  })

  it('treats slash tokens outside the agent catalog as unknown, never chat', () => {
    // A token the catalog does not know still dispatches to the TUI, so it must
    // not get a chat bubble, but it can't claim a command ran.
    expect(classifyMobileNativeChatSend('claude', '/cost')).toBe('unknown-token')
    expect(classifyMobileNativeChatSend('claude', '/claude-mem:mem-search')).toBe('unknown-token')
    // Built-ins from the CLI's own table are verified commands.
    expect(classifyMobileNativeChatSend('claude', '/model sonnet')).toBe('command')
    expect(classifyMobileNativeChatSend('claude', '/loop 5m /verify')).toBe('command')
  })

  it('keeps prose as chat, including leading-whitespace slash text', () => {
    expect(classifyMobileNativeChatSend('claude', 'hello there')).toBe('chat')
    expect(classifyMobileNativeChatSend('claude', ' /clear is a command')).toBe('chat')
    // A leading absolute path is prose, not a command: a desktop image paste
    // starts a message with "/var/folders/…/x.png" and must stay a chat turn.
    expect(classifyMobileNativeChatSend('claude', '/usr/bin/python is missing')).toBe('chat')
  })

  it('treats $ tokens as skill grammar only for Codex', () => {
    expect(classifyMobileNativeChatSend('codex', '$deploy now')).toBe('unknown-token')
    expect(classifyMobileNativeChatSend('claude', '$PATH is empty')).toBe('chat')
  })

  it('defaults to chat when no agent is resolved', () => {
    expect(classifyMobileNativeChatSend(null, '/clear')).toBe('chat')
  })
})
