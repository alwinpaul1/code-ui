import { describe, expect, it } from 'vitest'
import { reconcileSessionTabsWithTerminalList } from './mobile-session-tab-terminal-reconcile'
import type { MobileSessionTabLike, TerminalRecord } from './mobile-terminal-records'

// Opus review, 2026-10-12: a split leaf closed from the phone leaves the strip on tap, but its
// PTY is still in `terminal.list` until the desktop has closed it. Its sibling keeps the tab
// group on the strip, so the reconcile rebuilt the closed leaf from the list under its own id
// (`p::r`): the tab the user had just closed was drawn again for the length of the close.

const sibling: MobileSessionTabLike = {
  type: 'terminal',
  id: 'p::l',
  title: 'left',
  parentTabId: 'p',
  leafId: 'l',
  terminal: 'term-l',
  isActive: true
}

const listed: TerminalRecord[] = [
  { handle: 'term-l', title: 'left', isActive: true, connected: true, tabId: 'p', leafId: 'l' },
  { handle: 'term-r', title: 'right', isActive: false, connected: true, tabId: 'p', leafId: 'r' }
]

describe('a split leaf closed from the phone', () => {
  it('is not rebuilt from terminal.list while its close is in flight', () => {
    const tabs = reconcileSessionTabsWithTerminalList([sibling], listed, new Set(['p::r']))
    expect(tabs.map((tab) => tab.id)).toEqual(['p::l'])
  })

  it('is still added from terminal.list when nothing closed it', () => {
    const tabs = reconcileSessionTabsWithTerminalList([sibling], listed)
    expect(tabs.map((tab) => tab.id)).toEqual(['p::l', 'p::r'])
  })
})
