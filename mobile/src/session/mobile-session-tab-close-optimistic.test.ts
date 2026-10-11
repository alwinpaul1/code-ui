import { afterEach, describe, expect, it, vi } from 'vitest'
import { hookMount, performHookAction } from '../test-support/rpc-recording/hook-mount'
import { mountFixture } from '../test-support/rpc-recording/recorder-fixture-shape'
import type { RpcResponse } from '../transport/types'
import { createBulkCloseSheetActions } from './mobile-bulk-close-sheet-actions'
import type { MobileSessionTab } from './mobile-session-route-types'
import { useMobileSessionCloseActions } from './use-mobile-session-close-actions'

// Reported 2026-10-11: closing a terminal tab that was open on the desktop sat on
// the phone's strip for "a really long time, or a little bit of time". The strip
// held the tab until `session.tabs.close` answered, and that answer covers the
// relay round trip (250 ms floor) plus the desktop's whole close transaction:
// Orca 1.4.2xx refreshes its PTY inventory across every worktree, asks the
// renderer to retire the tab, and flushes the workspace session to disk before
// it replies (`closeMobileSessionTab` -> `closeTerminalTab` -> `onClosed` ->
// `persistWorkspaceSessionByHost`). Claude's own app drops the tab on tap.

type TerminalTab = Extract<MobileSessionTab, { type: 'terminal' }>
const META = { runtimeId: 'runtime-1' }

function terminalTab(id: string, extra: Partial<TerminalTab> = {}): TerminalTab {
  return {
    type: 'terminal',
    id,
    title: id,
    parentTabId: id,
    terminal: `term-${id}`,
    isActive: false,
    ...extra
  }
}

const accepted = (): RpcResponse => ({ id: 'r', ok: true, result: { closed: true }, _meta: META })
const failed = (code: string, message = code): RpcResponse => ({
  id: 'r',
  ok: false,
  error: { code, message },
  _meta: META
})

function deferred() {
  let resolve!: (reply: RpcResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<RpcResponse>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function closeSession(tabs: MobileSessionTab[], activeId: string | null) {
  const replies: ReturnType<typeof deferred>[] = []
  const methods: string[] = []
  const client = {
    sendRequest: vi.fn((method: string): Promise<RpcResponse> => {
      methods.push(method)
      const reply = deferred()
      replies.push(reply)
      return reply.promise
    })
  }
  const sessionTabsRef: { current: MobileSessionTab[] } = { current: tabs }
  let sessionTabs = tabs
  const activeSessionTabIdRef = { current: activeId }
  const tombstones = new Map<string, number>()
  const toasts: string[] = []
  const switched: string[] = []
  const unsubscribed: string[] = []
  const switchSessionTabRef = {
    current: (tab: MobileSessionTab) => {
      switched.push(tab.id)
      activeSessionTabIdRef.current = tab.id
    }
  }
  let terminals = tabs.flatMap((tab) =>
    tab.type === 'terminal' && tab.terminal
      ? [{ handle: tab.terminal, title: tab.title, isActive: tab.id === activeId }]
      : []
  )
  const terminalsRef = { current: terminals }
  let actions: ReturnType<typeof useMobileSessionCloseActions> | undefined
  const hook = hookMount(() => {
    actions = useMobileSessionCloseActions(
      mountFixture<Parameters<typeof useMobileSessionCloseActions>[0]>({
        worktreeId: 'wt-1',
        client,
        terminals,
        terminalsRef,
        setTerminals: (update) => {
          terminals = typeof update === 'function' ? update(terminals) : update
        },
        sessionTabsRef,
        setSessionTabs: (update) => {
          sessionTabs = typeof update === 'function' ? update(sessionTabs) : update
        },
        setFileDocs: () => {},
        setMarkdownDocs: () => {},
        reconcileBufferedDraftsRef: { current: () => {} },
        closedTabTombstonesRef: { current: tombstones },
        clearTerminalLiveInputDefault: () => {},
        setActiveHandle: () => {},
        setActiveSessionTabId: () => {},
        activeSessionTabIdRef,
        visitedSessionTabIdsRef: { current: [] },
        switchSessionTabRef,
        selectedSessionTabIdRef: { current: activeId },
        terminalRefs: { current: new Map() },
        initializedHandlesRef: { current: new Set() },
        activeHandleRef: { current: null },
        activeSessionTabTypeRef: { current: 'terminal' },
        pendingActiveTerminalHandleRef: { current: null },
        pendingBrowserFocusPageIdRef: { current: null },
        unsubscribeTerminal: (handle: string) => unsubscribed.push(handle),
        subscribeToTerminal: () => {},
        showToast: (message: string) => toasts.push(message)
      })
    )
  })
  hook.mount()
  return {
    replies,
    methods,
    toasts,
    switched,
    unsubscribed,
    tombstones,
    activeId: () => activeSessionTabIdRef.current,
    strip: () => sessionTabsRef.current.map((tab) => tab.id),
    rendered: () => sessionTabs.map((tab) => tab.id),
    close(tab: MobileSessionTab) {
      const mounted = actions
      if (!mounted) {
        throw new Error('close actions not mounted')
      }
      return performHookAction(() => mounted.handleCloseSessionTab(tab))
    },
    dispose: () => hook.unmount()
  }
}

let disposeSession: (() => void) | null = null
afterEach(() => {
  disposeSession?.()
  disposeSession = null
})

function open(tabs: MobileSessionTab[], activeId: string | null) {
  const session = closeSession(tabs, activeId)
  disposeSession = session.dispose
  return session
}

describe('closing a session tab from the phone', () => {
  it('drops the tab from the strip the moment it is tapped, before the desktop answers', () => {
    const a = terminalTab('a')
    const b = terminalTab('b')
    const session = open([a, b], 'a')
    void session.close(b)
    expect(session.methods).toEqual(['session.tabs.close'])
    expect(session.strip()).toEqual(['a'])
    expect(session.rendered()).toEqual(['a'])
  })

  it('keeps a snapshot that lands mid-close from drawing the tab again', () => {
    const a = terminalTab('a')
    const b = terminalTab('b')
    const session = open([a, b], 'a')
    void session.close(b)
    // The host can take up to its 20 s renderer timeout to answer; the tombstone
    // must outlive the wait, not the 10 s it is given once the close lands.
    expect(session.tombstones.get('b')).toBeGreaterThan(Date.now() + 20_000)
  })

  it('selects a neighbour at once when the active tab is closed', () => {
    const a = terminalTab('a')
    const b = terminalTab('b')
    const session = open([a, b], 'b')
    void session.close(b)
    expect(session.switched).toEqual(['a'])
    expect(session.activeId()).toBe('a')
  })

  it('clears the selection at once when the last tab is closed', () => {
    const a = terminalTab('a')
    const session = open([a], 'a')
    void session.close(a)
    expect(session.strip()).toEqual([])
    expect(session.activeId()).toBeNull()
  })

  it('tears the terminal down only once the desktop has closed it', async () => {
    const a = terminalTab('a')
    const b = terminalTab('b')
    const session = open([a, b], 'a')
    const closing = session.close(b)
    expect(session.unsubscribed).toEqual([])
    session.replies[0].resolve(accepted())
    await closing
    expect(session.unsubscribed).toEqual(['term-b'])
    expect(session.strip()).toEqual(['a'])
    expect(session.toasts).toEqual([])
  })

  it('puts a refused close back where it was, with a toast naming the reason', async () => {
    const a = terminalTab('a')
    const b = terminalTab('b')
    const c = terminalTab('c')
    const session = open([a, b, c], 'a')
    const closing = session.close(b)
    expect(session.strip()).toEqual(['a', 'c'])
    session.replies[0].resolve(failed('terminal_tab_pinned'))
    await closing
    expect(session.strip()).toEqual(['a', 'b', 'c'])
    expect(session.rendered()).toEqual(['a', 'b', 'c'])
    expect(session.tombstones.has('b')).toBe(false)
    expect(session.unsubscribed).toEqual([])
    expect(session.toasts).toHaveLength(1)
    expect(session.toasts[0]).toContain('b')
    expect(session.toasts[0]).toContain('pinned')
  })

  it('puts the tab back when the close never reaches the desktop', async () => {
    const a = terminalTab('a')
    const b = terminalTab('b')
    const session = open([a, b], 'a')
    const closing = session.close(b)
    session.replies[0].reject(new Error('Relay connection lost'))
    await closing
    expect(session.strip()).toEqual(['a', 'b'])
    expect(session.toasts).toHaveLength(1)
    expect(session.toasts[0]).toContain('Relay connection lost')
  })

  it('puts the last tab back when its close is refused', async () => {
    const a = terminalTab('a')
    const session = open([a], 'a')
    const closing = session.close(a)
    expect(session.strip()).toEqual([])
    session.replies[0].resolve(failed('runtime_unavailable'))
    await closing
    expect(session.strip()).toEqual(['a'])
    expect(session.toasts).toHaveLength(1)
  })

  it('leaves a tab the desktop had already closed off the strip, without a toast', async () => {
    const a = terminalTab('a')
    const b = terminalTab('b')
    const session = open([a, b], 'a')
    const closing = session.close(b)
    session.replies[0].resolve(failed('runtime_error', 'tab_not_found'))
    await closing
    expect(session.strip()).toEqual(['a'])
    expect(session.toasts).toEqual([])
  })

  it('puts a refused split-leaf close back, keeping its sibling', async () => {
    const left = terminalTab('p::l', { parentTabId: 'p', leafId: 'l', terminal: 'term-l' })
    const right = terminalTab('p::r', { parentTabId: 'p', leafId: 'r', terminal: 'term-r' })
    const session = open([left, right], 'p::l')
    const closing = session.close(right)
    expect(session.methods).toEqual(['terminal.close'])
    expect(session.strip()).toEqual(['p::l'])
    session.replies[0].resolve(failed('timeout'))
    await closing
    expect(session.strip()).toEqual(['p::l', 'p::r'])
    expect(session.toasts).toHaveLength(1)
  })
})

describe('closing several tabs from the long-press sheet', () => {
  it('removes every target at once instead of one round trip at a time', () => {
    const tabs = [terminalTab('a'), terminalTab('b'), terminalTab('c')]
    const closing: string[] = []
    const actions = createBulkCloseSheetActions({
      sessionTabsRef: { current: tabs },
      markdownDocs: new Map(),
      activeSessionTabIdRef: { current: 'a' },
      switchSessionTab: () => {},
      closeSessionTab: (tab) => {
        closing.push(tab.id)
        return new Promise<void>(() => {})
      }
    })
    const others = actions('a', () => {}).find((action) => action.label === 'Close Other Tabs')
    others?.onPress?.()
    expect(closing).toEqual(['b', 'c'])
  })
})
