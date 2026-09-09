import { describe, expect, it } from 'vitest'
import { AGENT_HUD_TERMINAL_TITLE, hideAgentHudTabs } from './agent-hud-tab-filter'

// Seen on the Galaxy S23 (2026-09-09): opening a project with two Claude tabs
// made two "Terminal" pills appear next to them and vanish a second later —
// the HUD reader's own terminals, adopted as tabs by the desktop.
describe('the tab strip never shows the HUD reader terminals', () => {
  it('drops terminal tabs titled like the reader and keeps everything else in order', () => {
    const tabs = [
      { type: 'terminal', id: 'a', title: '894' },
      { type: 'terminal', id: 'hud-1', title: AGENT_HUD_TERMINAL_TITLE },
      { type: 'terminal', id: 'b', title: '893' },
      { type: 'markdown', id: 'm', title: AGENT_HUD_TERMINAL_TITLE },
      { type: 'terminal', id: 'hud-2', title: AGENT_HUD_TERMINAL_TITLE }
    ]
    expect(hideAgentHudTabs(tabs).map((tab) => tab.id)).toEqual(['a', 'b', 'm'])
  })

  it("leaves a user's terminal that happens to be untitled alone", () => {
    const tabs = [{ type: 'terminal', id: 't', title: null }]
    expect(hideAgentHudTabs(tabs)).toEqual(tabs)
  })
})
