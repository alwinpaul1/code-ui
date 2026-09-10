import { describe, expect, it } from 'vitest'
import { planSessionTabClose } from './mobile-session-tab-close-plan'

describe('planSessionTabClose', () => {
  it('closes the extra split pill by its own handle, leaving the parent tab alone', () => {
    expect(
      planSessionTabClose(
        {
          type: 'terminal',
          id: '20fd286b-af05-4c99-885b-41784139ba7f::leaf-2',
          title: 'zsh',
          parentTabId: '20fd286b-af05-4c99-885b-41784139ba7f',
          leafId: 'leaf-2',
          terminal: 'term_a2a5b040',
          isActive: false
        },
        [
          {
            type: 'terminal',
            id: '20fd286b-af05-4c99-885b-41784139ba7f::leaf-1',
            parentTabId: '20fd286b-af05-4c99-885b-41784139ba7f',
            terminal: 'term_99b00932'
          },
          {
            type: 'terminal',
            id: '20fd286b-af05-4c99-885b-41784139ba7f::leaf-2',
            parentTabId: '20fd286b-af05-4c99-885b-41784139ba7f',
            terminal: 'term_a2a5b040'
          }
        ]
      )
    ).toEqual({
      via: 'terminal-handle',
      handle: 'term_a2a5b040'
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

  // The host addresses EVERY terminal tab as `parentTabId::leafId`, split or
  // not — `RuntimeMobileSessionTerminalTab` makes both fields required, and the
  // mock server's contract-complete fixture publishes a lone tab as
  // `id: 'tab-1::f47ac10b-…', parentTabId: 'tab-1'`. So `parentTabId !== id`
  // does not mean "split", and a fixture that omits parentTabId is not a screen
  // any host paints.
  const soleLeaf = {
    type: 'terminal' as const,
    id: 'tab-1::f47ac10b-58cc-4372-a567-0e02b2c3d479',
    title: 'zsh',
    parentTabId: 'tab-1',
    leafId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    terminal: 'term-1',
    isActive: true
  }

  it('closes a tab the user tapped, when its leaf is the only one in the tab', () => {
    // Exactly what 0.3.0 sent: the tab's own id, no leafId. A leafId asks the
    // host to close one pane of a split, which this tab is not.
    expect(planSessionTabClose(soleLeaf, [soleLeaf])).toEqual({
      via: 'session-tab',
      tabId: 'tab-1::f47ac10b-58cc-4372-a567-0e02b2c3d479'
    })
  })

  it('closes a tab whose strip context is not known through session.tabs.close', () => {
    expect(planSessionTabClose(soleLeaf).via).toBe('session-tab')
  })

  it('closes a split leaf with a single terminal.close, never a repeat', () => {
    // Verified against a live Orca host (1.4.x) on a real two-leaf tab:
    //   close #1 on the leaf  -> {ptyKilled: true},  sibling survives, tab intact
    //   close #2 on that same, now-dead handle -> {ptyKilled: false}, and the
    //   host resolves the stale handle to its TAB: the surviving sibling is
    //   closed too. That second call is why closing the lower pane from the
    //   phone took the whole window with it.
    const first = {
      type: 'terminal' as const,
      id: 'tab-1::leaf-1',
      parentTabId: 'tab-1',
      terminal: 'term-1'
    }
    const second = {
      type: 'terminal' as const,
      id: 'tab-1::leaf-2',
      parentTabId: 'tab-1',
      leafId: 'leaf-2',
      terminal: 'term-2'
    }

    expect(planSessionTabClose(second, [first, second])).toEqual({
      via: 'terminal-handle',
      handle: 'term-2'
    })
  })

  it('closes a leaf by handle only while a sibling shares its tab', () => {
    const sibling = {
      ...soleLeaf,
      id: 'tab-1::leaf-2',
      leafId: 'leaf-2',
      terminal: 'term-2',
      isActive: false
    }

    expect(planSessionTabClose(sibling, [soleLeaf, sibling])).toEqual({
      via: 'terminal-handle',
      handle: 'term-2'
    })
  })

  it('ignores a leaf from another tab when deciding whether this one is split', () => {
    const otherTab = {
      ...soleLeaf,
      id: 'tab-2::leaf-1',
      parentTabId: 'tab-2',
      leafId: 'leaf-1',
      terminal: 'term-9',
      isActive: false
    }

    expect(planSessionTabClose(soleLeaf, [soleLeaf, otherTab]).via).toBe('session-tab')
  })

  it('still plans a handle close for a split pill whose terminal is already dead', () => {
    const dead = {
      type: 'terminal' as const,
      id: 'tab-1::leaf-2',
      parentTabId: 'tab-1',
      leafId: 'leaf-2',
      terminal: 'pty-dead'
    }
    expect(
      planSessionTabClose(dead, [
        { type: 'terminal', id: 'tab-1::leaf-1', parentTabId: 'tab-1', terminal: 'pty-1' },
        dead
      ]).via
    ).toBe('terminal-handle')
  })

  it('does not encode a split sibling as parentTabId::leafId for session.tabs.close', () => {
    const sibling = {
      type: 'terminal' as const,
      id: 'tab-1::leaf-2',
      title: 'shell',
      parentTabId: 'tab-1',
      leafId: 'leaf-2',
      terminal: 'pty-2',
      isActive: false
    }
    const plan = planSessionTabClose(sibling, [
      { type: 'terminal', id: 'tab-1::leaf-1', parentTabId: 'tab-1', terminal: 'pty-1' },
      sibling
    ])
    expect(plan.via).toBe('terminal-handle')
    expect(plan).not.toMatchObject({ tabId: 'tab-1::leaf-2' })
  })
})
