import { describe, expect, it } from 'vitest'
import { shouldShowTerminalCommandDock } from './mobile-session-command-dock-visibility'

const visible = {
  blockedByOtherPanel: false,
  showNativeChat: false,
  chatViewSelected: false,
  agentSession: false,
  viewResolved: true,
  loading: false
}

describe('the terminal command bar under a chat', () => {
  it('stays hidden while a Grok chat is opening and the transcript is not ready yet', () => {
    expect(shouldShowTerminalCommandDock({ ...visible, chatViewSelected: true })).toBe(false)
    expect(shouldShowTerminalCommandDock({ ...visible, agentSession: true })).toBe(false)
  })

  it('stays hidden once Chat UI is on screen', () => {
    expect(shouldShowTerminalCommandDock({ ...visible, showNativeChat: true })).toBe(false)
  })

  it('shows for a resolved terminal tab', () => {
    expect(shouldShowTerminalCommandDock(visible)).toBe(true)
  })

  it('holds while the stored view is still unknown', () => {
    expect(shouldShowTerminalCommandDock({ ...visible, viewResolved: false })).toBe(false)
  })
})
