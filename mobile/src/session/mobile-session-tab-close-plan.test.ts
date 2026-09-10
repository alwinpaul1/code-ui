import { describe, expect, it } from 'vitest'
import { planSessionTabClose } from './mobile-session-tab-close-plan'

describe('planSessionTabClose', () => {
  it('closes the extra split pill by handle twice so the leftover desktop pane collapses', () => {
    expect(
      planSessionTabClose({
        type: 'terminal',
        id: '20fd286b-af05-4c99-885b-41784139ba7f::leaf-2',
        title: 'zsh',
        parentTabId: '20fd286b-af05-4c99-885b-41784139ba7f',
        leafId: 'leaf-2',
        terminal: 'term_a2a5b040',
        isActive: false
      })
    ).toEqual({
      via: 'terminal-handle',
      handle: 'term_a2a5b040',
      repeats: 2
    })
  })

  it('closes the parent Grok tab through session.tabs.close, not the extra pane handle', () => {
    expect(
      planSessionTabClose({
        type: 'terminal',
        id: '20fd286b-af05-4c99-885b-41784139ba7f',
        title: 'Grok',
        terminal: 'term_99b00932',
        isActive: true
      })
    ).toEqual({
      via: 'session-tab',
      tabId: '20fd286b-af05-4c99-885b-41784139ba7f'
    })
  })

  it('does not encode a split sibling as parentTabId::leafId for session.tabs.close', () => {
    const plan = planSessionTabClose({
      type: 'terminal',
      id: 'tab-1::leaf-2',
      title: 'shell',
      parentTabId: 'tab-1',
      leafId: 'leaf-2',
      terminal: 'pty-2',
      isActive: false
    })
    expect(plan.via).toBe('terminal-handle')
    expect(plan).not.toMatchObject({ tabId: 'tab-1::leaf-2' })
  })
})
