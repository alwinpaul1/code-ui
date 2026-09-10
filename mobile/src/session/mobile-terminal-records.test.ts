import { describe, expect, it, vi } from 'vitest'
import { sessionTabClosesByHandle } from './mobile-session-tab-close-plan'
import {
  appendUnlistedConnectedTerminalTabs,
  reconcileSessionTabsWithTerminalList
} from './mobile-session-tab-terminal-reconcile'
import {
  getTerminalRecordsFromSessionTabs,
  hasConnectedTerminalAbsentFromSessionTabs,
  mergeTerminalListWithKnownRecords,
  mergeTerminalRecordsByCurrentOrder,
  mobileSessionTabsEqual,
  mobileTerminalThemesEqual,
  type MobileTerminalSessionTab,
  type TerminalRecord
} from './mobile-terminal-records'

const lightTheme = {
  mode: 'light' as const,
  theme: {
    background: '#ffffff',
    foreground: '#111111'
  }
}

const darkTheme = {
  mode: 'dark' as const,
  theme: {
    background: '#111111',
    foreground: '#eeeeee'
  }
}

describe('mobile terminal records', () => {
  it('compares terminal themes without serializing them', () => {
    const equivalentTheme = {
      mode: 'dark' as const,
      theme: { foreground: '#eeeeee', background: '#111111' }
    }
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('unexpected theme serialization')
    })

    try {
      for (let comparison = 0; comparison < 1_000; comparison += 1) {
        expect(mobileTerminalThemesEqual(darkTheme, equivalentTheme)).toBe(true)
        expect(mobileTerminalThemesEqual(darkTheme, lightTheme)).toBe(false)
      }
    } finally {
      stringify.mockRestore()
    }
  })

  it('detects additional theme fields from a newer host', () => {
    const withNewField = {
      ...darkTheme,
      theme: { ...darkTheme.theme, futureAccent: '#ff00ff' }
    }

    expect(mobileTerminalThemesEqual(darkTheme, withNewField)).toBe(false)
    expect(mobileTerminalThemesEqual(withNewField, { ...withNewField })).toBe(true)
  })

  it('treats a changed contrast-ratio override as a different theme (#10754)', () => {
    // A record that skips this field would never reach the WebView when the desktop
    // user only changes the published minimumContrastRatio and nothing else.
    const withOverride = { ...darkTheme, minimumContrastRatio: 1 }
    const withDifferentOverride = { ...darkTheme, minimumContrastRatio: 21 }

    expect(mobileTerminalThemesEqual(darkTheme, withOverride)).toBe(false)
    expect(mobileTerminalThemesEqual(withOverride, withDifferentOverride)).toBe(false)
    expect(mobileTerminalThemesEqual(withOverride, { ...withOverride })).toBe(true)
  })

  it('keeps the known theme when a session-tab snapshot omits it', () => {
    const known: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Old title', terminalTheme: darkTheme, isActive: false }
    ]
    const snapshot: TerminalRecord[] = [{ handle: 'pty-1', title: 'Current title', isActive: true }]

    expect(mergeTerminalRecordsByCurrentOrder(snapshot, known)).toEqual([
      { handle: 'pty-1', title: 'Current title', terminalTheme: darkTheme, isActive: true }
    ])
  })

  it('keeps session-tab terminal themes when terminal.list omits them', () => {
    const terminalList: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Terminal', isActive: true },
      { handle: 'pty-2', title: 'Logs', isActive: false }
    ]
    const currentTerminals: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Terminal', terminalTheme: darkTheme, isActive: true }
    ]
    const sessionTabs: MobileTerminalSessionTab[] = [
      {
        type: 'terminal',
        id: 'term-1::leaf-1',
        title: 'Terminal',
        terminal: 'pty-1',
        terminalTheme: lightTheme,
        isActive: true
      }
    ]

    expect(mergeTerminalListWithKnownRecords(terminalList, currentTerminals, sessionTabs)).toEqual([
      { handle: 'pty-1', title: 'Terminal', terminalTheme: lightTheme, isActive: true },
      { handle: 'pty-2', title: 'Logs', isActive: false }
    ])
  })

  it('falls back to the current terminal theme while waiting for session tabs', () => {
    const terminalList: TerminalRecord[] = [{ handle: 'pty-1', title: 'Terminal', isActive: true }]
    const currentTerminals: TerminalRecord[] = [
      { handle: 'pty-1', title: 'Terminal', terminalTheme: darkTheme, isActive: true }
    ]

    expect(mergeTerminalListWithKnownRecords(terminalList, currentTerminals, [])).toEqual([
      { handle: 'pty-1', title: 'Terminal', terminalTheme: darkTheme, isActive: true }
    ])
  })

  it('ignores pending terminal tabs without a handle', () => {
    expect(
      getTerminalRecordsFromSessionTabs([
        {
          type: 'terminal',
          id: 'pending',
          title: 'Terminal',
          terminal: null,
          terminalTheme: lightTheme,
          isActive: true
        }
      ])
    ).toEqual([])
  })

  it('treats a launch draft appearing or retracting as a session-tab change', () => {
    // The route keeps `prev` when these compare equal, so a frame whose only
    // delta is the draft would never reach the chat composer.
    const base: MobileTerminalSessionTab = {
      type: 'terminal',
      id: 'term-1::leaf-1',
      parentTabId: 'term-1',
      leafId: 'leaf-1',
      title: 'Claude',
      status: 'ready',
      terminal: 'pty-1',
      isActive: true
    }
    const seeded: MobileTerminalSessionTab = {
      ...base,
      launchDraft: 'https://github.com/o/r/issues/12',
      launchDraftCreatedAt: 1
    }

    expect(mobileSessionTabsEqual([base], [seeded])).toBe(false)
    expect(mobileSessionTabsEqual([seeded], [base])).toBe(false)
    expect(mobileSessionTabsEqual([seeded], [{ ...seeded }])).toBe(true)
    expect(mobileSessionTabsEqual([seeded], [{ ...seeded, launchDraftCreatedAt: 2 }])).toBe(false)
  })

  it('treats terminal agent-status changes as session-tab changes', () => {
    const base: MobileTerminalSessionTab = {
      type: 'terminal',
      id: 'term-1::leaf-1',
      parentTabId: 'term-1',
      leafId: 'leaf-1',
      title: 'Claude',
      status: 'ready',
      terminal: 'pty-1',
      isActive: true,
      agentStatus: {
        state: 'working',
        prompt: '',
        updatedAt: 1,
        stateStartedAt: 1,
        paneKey: 'term-1:leaf-1',
        terminalHandle: 'pty-1',
        stateHistory: []
      }
    }

    expect(
      mobileSessionTabsEqual(
        [base],
        [
          {
            ...base,
            agentStatus: {
              ...base.agentStatus!,
              state: 'blocked',
              updatedAt: 2,
              stateStartedAt: 2
            }
          }
        ]
      )
    ).toBe(false)
  })

  it('treats structured agent-session identity changes as session-tab changes', () => {
    const base = {
      type: 'agent-session' as const,
      id: 'agent-tab-1',
      title: 'Codex',
      sessionId: 'session-1',
      agent: 'codex',
      isActive: true
    }

    expect(mobileSessionTabsEqual([base], [{ ...base }])).toBe(true)
    expect(mobileSessionTabsEqual([base], [{ ...base, sessionId: 'session-2' }])).toBe(false)
  })

  const record = (over: Partial<TerminalRecord> & { handle: string }): TerminalRecord => ({
    title: 'Terminal',
    terminalTheme: undefined,
    isActive: false,
    ...over
  })
  const terminalTab = (handle: string): MobileTerminalSessionTab => ({
    id: `tab-${handle}`,
    type: 'terminal',
    terminal: handle,
    title: 'Terminal',
    isActive: false
  })

  it('puts a split pane the tab snapshot omitted onto the strip', () => {
    // The host addresses a terminal tab as `parentTabId::leafId`; a fixture that
    // invents an unrelated tab id agrees with a parser that ignores the group.
    const tabs = [
      { ...terminalTab('pty-1'), id: 'tab-1::leaf-1', parentTabId: 'tab-1', leafId: 'leaf-1' }
    ]
    const listed = [
      record({ handle: 'pty-1', connected: true, tabId: 'tab-1', leafId: 'leaf-1' }),
      record({
        handle: 'pty-2',
        connected: true,
        tabId: 'tab-1',
        leafId: 'leaf-2',
        title: 'shell'
      })
    ]
    const next = appendUnlistedConnectedTerminalTabs(tabs, listed)
    expect(next.map((tab) => (tab.type === 'terminal' ? tab.terminal : null))).toEqual([
      'pty-1',
      'pty-2'
    ])
    const extra = next[1]
    expect(extra?.type).toBe('terminal')
    if (extra?.type === 'terminal') {
      expect(extra.id).not.toBe(tabs[0]?.id)
      expect(extra.parentTabId).toBe('tab-1')
      expect(extra.title).toBe('shell')
    }
  })

  it('drops a split sibling once terminal.list no longer has it', () => {
    const tabs = appendUnlistedConnectedTerminalTabs(
      [terminalTab('pty-1')],
      [
        record({ handle: 'pty-1', connected: true, tabId: 'tab-pty-1' }),
        record({ handle: 'pty-2', connected: true, tabId: 'tab-pty-1', leafId: 'leaf-2' })
      ]
    )
    expect(tabs).toHaveLength(2)
    expect(reconcileSessionTabsWithTerminalList(tabs, [record({ handle: 'pty-1', connected: true })])).toHaveLength(
      1
    )
  })

  it('closes a split sibling by its handle, not the parent tab', () => {
    const first = { id: 'tab-1::leaf-1', type: 'terminal' as const, parentTabId: 'tab-1' }
    const second = { id: 'tab-1::leaf-2', type: 'terminal' as const, parentTabId: 'tab-1' }

    expect(sessionTabClosesByHandle(second, [first, second])).toBe(true)
    // The only leaf in its tab IS the tab, however the host addresses it.
    expect(sessionTabClosesByHandle(second, [second])).toBe(false)
    expect(
      sessionTabClosesByHandle({
        id: 'tab-1',
        type: 'terminal',
        terminal: 'pty-1',
        title: 'Grok',
        isActive: true
      })
    ).toBe(false)
  })

  it('reports a connected terminal the tab snapshot dropped', () => {
    const held = [
      record({ handle: 'pty-1', connected: true }),
      record({ handle: 'pty-2', connected: true })
    ]

    expect(hasConnectedTerminalAbsentFromSessionTabs(held, [terminalTab('pty-1')])).toBe(true)
  })

  it('ignores parked handles that tabs never carry', () => {
    const parked = [
      record({ handle: 'pty-1', connected: false }),
      record({ handle: 'pty-2', connected: false })
    ]

    // A worktree with no live PTY lists every parked leaf while tabs publish none;
    // treating that as absence would pin the caller to the fast cadence forever.
    expect(hasConnectedTerminalAbsentFromSessionTabs(parked, [])).toBe(false)
  })

  it('ignores orphaned PTYs, which have no leaf and so never appear as a tab', () => {
    const orphan = [record({ handle: 'pty-1', connected: true, orphaned: true })]

    expect(hasConnectedTerminalAbsentFromSessionTabs(orphan, [])).toBe(false)
  })

  it('ignores a host that omits connected rather than assuming liveness', () => {
    expect(hasConnectedTerminalAbsentFromSessionTabs([record({ handle: 'pty-1' })], [])).toBe(false)
  })

  it('clears once the snapshot covers every connected terminal', () => {
    const held = [record({ handle: 'pty-1', connected: true })]

    expect(
      hasConnectedTerminalAbsentFromSessionTabs(held, [terminalTab('pty-1'), terminalTab('pty-2')])
    ).toBe(false)
  })

  it('keeps the merge additive so absence only schedules the sweep', () => {
    const held = [
      record({ handle: 'pty-1', connected: true }),
      record({ handle: 'pty-2', connected: true })
    ]
    const tabs = [terminalTab('pty-1')]

    expect(
      mergeTerminalRecordsByCurrentOrder(getTerminalRecordsFromSessionTabs(tabs), held).map(
        (terminal) => terminal.handle
      )
    ).toEqual(['pty-1', 'pty-2'])
  })
})

// The shape a real host publishes: `session.tabs` addresses every terminal tab
// as `parentTabId::leafId`, with parentTabId and leafId both required
// (`RuntimeMobileSessionTerminalTab`). Captured from the mock server's
// contract-complete fixture, which mirrors Orca 1.4.x:
//   { type: 'terminal', id: 'tab-1::f47ac10b-…', parentTabId: 'tab-1',
//     leafId: 'f47ac10b-…', status: 'ready', terminal: 'term-1', isActive: true }
describe('session tabs reconciled against terminal.list', () => {
  const hostTerminalTab = (
    over: Partial<MobileTerminalSessionTab> = {}
  ): MobileTerminalSessionTab => ({
    type: 'terminal',
    id: 'tab-1::f47ac10b-58cc-4372-a567-0e02b2c3d479',
    title: 'zsh',
    parentTabId: 'tab-1',
    leafId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    status: 'ready',
    terminal: 'term-1',
    isActive: true,
    ...over
  })
  const listed = (over: Partial<TerminalRecord> & { handle: string }): TerminalRecord => ({
    title: 'zsh',
    isActive: false,
    connected: true,
    tabId: 'tab-1',
    leafId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    ...over
  })

  it('keeps the agent a Claude tab was launched with, so the Chat toggle stays on the header', () => {
    const tabs = [hostTerminalTab({ launchAgent: 'claude' })]

    const next = reconcileSessionTabsWithTerminalList(tabs, [listed({ handle: 'term-1' })])

    expect(next).toHaveLength(1)
    const kept = next[0]
    expect(kept?.type).toBe('terminal')
    if (kept?.type === 'terminal') {
      expect(kept.launchAgent).toBe('claude')
      expect(kept.id).toBe('tab-1::f47ac10b-58cc-4372-a567-0e02b2c3d479')
    }
  })

  it('keeps the live agent status a Codex tab reports, so it still opens in Chat UI', () => {
    const agentStatus = {
      agentType: 'codex',
      state: 'idle',
      providerSession: { id: 'codex-session-1' }
    } as unknown as MobileTerminalSessionTab['agentStatus']
    const tabs = [hostTerminalTab({ title: 'Codex', agentStatus })]

    const next = reconcileSessionTabsWithTerminalList(tabs, [listed({ handle: 'term-1' })])

    const kept = next[0]
    expect(kept?.type === 'terminal' ? kept.agentStatus : null).toEqual(agentStatus)
  })

  it('leaves a closed tab closed while its PTY is still in the last terminal.list', () => {
    // The host drops the tab from session.tabs the moment it closes; its PTY
    // lingers as connected until the next sweep lands.
    const next = reconcileSessionTabsWithTerminalList([], [listed({ handle: 'term-1' })])

    expect(next).toEqual([])
  })

  it('still puts a split leaf the tab snapshot omitted onto the strip', () => {
    const tabs = [hostTerminalTab()]

    const next = reconcileSessionTabsWithTerminalList(tabs, [
      listed({ handle: 'term-1' }),
      listed({ handle: 'term-2', leafId: 'leaf-2', title: 'shell' })
    ])

    expect(next).toHaveLength(2)
    const leaf = next[1]
    expect(leaf?.type).toBe('terminal')
    if (leaf?.type === 'terminal') {
      // The host's own address for a leaf; a churning tab id loses the per-tab
      // chat/terminal override, which is keyed by it.
      expect(leaf.id).toBe('tab-1::leaf-2')
      expect(leaf.parentTabId).toBe('tab-1')
      expect(leaf.title).toBe('shell')
    }
  })

  it('carries the agent terminal.list names onto a leaf it had to synthesize', () => {
    const next = reconcileSessionTabsWithTerminalList(
      [hostTerminalTab()],
      [
        listed({ handle: 'term-1' }),
        listed({ handle: 'term-2', leafId: 'leaf-2', agentIdentity: 'claude' })
      ]
    )

    const leaf = next[1]
    expect(leaf?.type === 'terminal' ? leaf.launchAgent : null).toBe('claude')
  })

  it('drops a synthesized leaf once terminal.list no longer lists it', () => {
    const withLeaf = reconcileSessionTabsWithTerminalList(
      [hostTerminalTab()],
      [listed({ handle: 'term-1' }), listed({ handle: 'term-2', leafId: 'leaf-2' })]
    )
    expect(withLeaf).toHaveLength(2)

    expect(
      reconcileSessionTabsWithTerminalList(withLeaf, [listed({ handle: 'term-1' })])
    ).toHaveLength(1)
  })

  it('leaves a healthy strip untouched, so a sweep cannot remount the terminal', () => {
    // Every terminal.list sweep feeds its result back through reconcile. A
    // reconcile that returns a differently-shaped strip makes the route call
    // setSessionTabs, re-resolve the active tab and resubscribe the PTY — on a
    // cadence — which is what made live keyboard input drop characters.
    const tabs = [hostTerminalTab({ launchAgent: 'claude' })]

    const next = reconcileSessionTabsWithTerminalList(tabs, [listed({ handle: 'term-1' })])

    expect(mobileSessionTabsEqual(tabs, next)).toBe(true)
  })

  it('never drops a host tab just because a sweep raced the terminal list', () => {
    const tabs = [hostTerminalTab({ launchAgent: 'claude' })]

    expect(reconcileSessionTabsWithTerminalList(tabs, [])).toEqual(tabs)
  })
})
