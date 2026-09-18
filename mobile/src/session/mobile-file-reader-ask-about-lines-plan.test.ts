import { describe, expect, it } from 'vitest'
import { planFileReaderAskAboutLines } from './mobile-file-reader-ask-about-lines-plan'
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

function agentSessionTab(id: string, agent: 'claude' | 'codex'): Extract<MobileSessionTab, { type: 'agent-session' }> {
  return { type: 'agent-session', id, title: id, sessionId: `session-${id}`, agent, isActive: false }
}

function fileTab(id: string): Extract<MobileSessionTab, { type: 'file' }> {
  return {
    type: 'file',
    id,
    title: id,
    filePath: `/repo/${id}`,
    relativePath: id,
    isDirty: false,
    isActive: true
  }
}

describe('planning where "Ask about lines" should land', () => {
  it('picks the chat tab most recently visited before the file tab', () => {
    const tabs = [terminalTab('chat', 'claude'), fileTab('notes.txt')]
    const plan = planFileReaderAskAboutLines({
      relativePath: 'src/notes.txt',
      range: { start: 10, end: 20 },
      tabs,
      visitHistory: ['chat', 'notes.txt'],
      currentTabId: 'notes.txt',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('chat')
    expect(plan?.agent).toBe('claude')
    expect(plan?.mention).toBe('@src/notes.txt#L10-L20')
  })

  it('skips a plain (non-chat) terminal in the history and lands on the chat tab before it', () => {
    const tabs = [terminalTab('chat', 'claude'), terminalTab('shell', null), fileTab('notes.txt')]
    const plan = planFileReaderAskAboutLines({
      relativePath: 'src/notes.txt',
      range: null,
      tabs,
      visitHistory: ['chat', 'shell', 'notes.txt'],
      currentTabId: 'notes.txt',
      nativeChatTranscriptIsLocalReadable: false
    })
    // A plain shell isn't chat-capable at all — it's filtered before history
    // even gets consulted, so the plan reaches past it to the real chat tab.
    expect(plan?.targetTab.id).toBe('chat')
  })

  it('formats the mention for Codex without a line range', () => {
    const tabs = [terminalTab('chat', 'codex'), fileTab('notes.txt')]
    const plan = planFileReaderAskAboutLines({
      relativePath: 'src/notes.txt',
      range: { start: 10, end: 20 },
      tabs,
      visitHistory: ['chat', 'notes.txt'],
      currentTabId: 'notes.txt',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.agent).toBe('codex')
    expect(plan?.mention).toBe('@src/notes.txt')
  })

  it('lands on the SDK lane\'s own agent-session tab too, not just a terminal', () => {
    const tabs = [agentSessionTab('chat', 'claude'), fileTab('notes.txt')]
    const plan = planFileReaderAskAboutLines({
      relativePath: 'src/notes.txt',
      range: { start: 5, end: 5 },
      tabs,
      visitHistory: ['chat', 'notes.txt'],
      currentTabId: 'notes.txt',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('chat')
    expect(plan?.agent).toBe('claude')
    expect(plan?.mention).toBe('@src/notes.txt#L5')
  })

  it('is null when there is no chat-capable tab open at all', () => {
    const plan = planFileReaderAskAboutLines({
      relativePath: 'src/notes.txt',
      range: null,
      tabs: [fileTab('notes.txt')],
      visitHistory: ['notes.txt'],
      currentTabId: 'notes.txt',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan).toBeNull()
  })

  it('falls back to the newest remaining chat tab when the file tab never made it into history', () => {
    const tabs = [terminalTab('older', 'claude'), terminalTab('newer', 'claude')]
    const plan = planFileReaderAskAboutLines({
      relativePath: 'src/notes.txt',
      range: null,
      tabs,
      visitHistory: [],
      currentTabId: 'notes.txt',
      nativeChatTranscriptIsLocalReadable: false
    })
    expect(plan?.targetTab.id).toBe('newer')
  })
})
