import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { RpcClient } from '../transport/rpc-client'
import { resolveActiveSessionTab } from './active-session-tab'
import { resolveMobileNativeChat } from './mobile-native-chat-eligibility'
import { reconcileSessionTabsWithTerminalList } from './mobile-session-tab-terminal-reconcile'
import {
  getTerminalRecordsFromSessionTabs,
  hasConnectedTerminalAbsentFromSessionTabs,
  mergeTerminalRecordsByCurrentOrder,
  mobileSessionTabsEqual,
  type MobileSessionTabLike,
  type MobileTerminalSessionTab,
  type TerminalRecord
} from './mobile-terminal-records'
import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'
import { useMobileNativeChatSession } from './use-mobile-native-chat-session'

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetNativeChatTranscriptCacheForTests()
})

// The shape the desktop published on 2026-09-25 (Orca 1.4.211, Claude Code
// 2.1.282) for the NexOS worktree: ONE Orca tab split into four panes, each
// its own hand-started Claude session. Ids are the real ones from Orca's saved
// statuses (`agent-hooks/last-status.json`, keyed `<tabId>:<leafId>`) and
// `orca terminal list --json`; only the home directory is renamed. The phone
// showed "Start a chat with Claude" in the 1037 pane's chat while its terminal
// held a 13,000-line conversation. These pin that the phone hands every pane
// its OWN session and transcript, never a sibling's, and none to a pane that
// reported none.
const TAB_ID = '12eaca17-5ae4-4948-a085-d33f13a25f41'
const PROJECT_DIR = '/Users/me/.claude-work/projects/-Users-me-Desktop-NexDash-NexOS/'

type Pane = {
  leafId: string
  sessionId: string
  title: string
  state: AgentStatusEntry['state']
  handle: string
}

const PANES: readonly Pane[] = [
  {
    leafId: '75b6e56c-c194-4d0b-890a-4f7228e8b50f',
    sessionId: '2ac2520e-61b2-4920-b3eb-ab2f1bc561db',
    title: '1092',
    state: 'working',
    handle: 'pty-3f221a94'
  },
  {
    leafId: '052ceda2-70ad-4c78-ba88-fc99dc338911',
    sessionId: 'ad1e3053-f9ac-40be-80be-8f33a800e9b1',
    title: '1037-chargingstations-rating',
    state: 'done',
    handle: 'pty-9dc06345'
  },
  {
    leafId: 'e797a2df-6bf9-4814-975d-9fb82a02ab39',
    sessionId: '858e0b66-4ffa-4207-8f8e-03b4f7fb7f00',
    title: 'fleet & drivers',
    state: 'done',
    handle: 'pty-e5d38c98'
  },
  {
    leafId: '764839df-f066-4b64-974f-cd10ece495b5',
    sessionId: '538e456b-3169-42d4-87ed-f234b258638c',
    title: '1100-driving-hrs-nexos',
    state: 'working',
    handle: 'pty-6142fd9b'
  }
]

const transcriptPathOf = (pane: Pane): string => `${PROJECT_DIR}${pane.sessionId}.jsonl`

function paneStatus(pane: Pane): AgentStatusEntry {
  return {
    state: pane.state,
    prompt: '',
    updatedAt: 1_790_343_051_462,
    stateStartedAt: 1_790_343_051_462,
    paneKey: `${TAB_ID}:${pane.leafId}`,
    tabId: TAB_ID,
    agentType: 'claude',
    terminalHandle: pane.handle,
    stateHistory: [],
    providerSession: {
      key: 'session_id',
      id: pane.sessionId,
      transcriptPath: transcriptPathOf(pane)
    }
  } as AgentStatusEntry
}

/** One pane as `session.tabs` publishes it: addressed `parentTabId::leafId`. */
function paneTab(pane: Pane, overrides: Partial<MobileTerminalSessionTab> = {}): MobileTerminalSessionTab {
  return {
    type: 'terminal',
    id: `${TAB_ID}::${pane.leafId}`,
    parentTabId: TAB_ID,
    leafId: pane.leafId,
    title: pane.title,
    terminal: pane.handle,
    agentStatus: paneStatus(pane),
    isActive: false,
    ...overrides
  }
}

/** The same pane as `terminal.list` reports it. */
function paneTerminal(pane: Pane): TerminalRecord {
  return {
    handle: pane.handle,
    title: pane.title,
    isActive: false,
    connected: true,
    tabId: TAB_ID,
    leafId: pane.leafId
  }
}

/** What the chat of the pill the reader tapped resolves, the way the route
 *  does it: reconcile the snapshot with the terminal list, select the pill,
 *  resolve the selected tab. */
function chatForPill(
  tabs: readonly MobileSessionTabLike[],
  terminals: readonly TerminalRecord[],
  pillId: string
): ReturnType<typeof resolveMobileNativeChat> {
  const strip = reconcileSessionTabsWithTerminalList(tabs, terminals)
  const { activeTab } = resolveActiveSessionTab(strip, {
    pendingActiveSessionTabId: null,
    selectedSessionTabId: pillId
  })
  return activeTab?.type === 'terminal' ? resolveMobileNativeChat(activeTab) : null
}

describe('a split tab whose panes run separate Claude sessions', () => {
  it("opens each pane on its own session and transcript, not a sibling pane's", () => {
    const tabs = PANES.map((pane) => paneTab(pane))
    const terminals = PANES.map(paneTerminal)
    for (const pane of PANES) {
      expect(chatForPill(tabs, terminals, `${TAB_ID}::${pane.leafId}`)).toEqual({
        agent: 'claude',
        source: 'status',
        sessionId: pane.sessionId,
        transcriptPath: transcriptPathOf(pane)
      })
    }
  })

  it("asks the desktop for the 1037 pane's own transcript when its chat opens", async () => {
    const pane = PANES[1]!
    const chat = chatForPill(
      PANES.map((each) => paneTab(each)),
      PANES.map(paneTerminal),
      `${TAB_ID}::${pane.leafId}`
    )
    const subscribe = vi.fn((() => () => {}) as RpcClient['subscribe'])
    const client = { sendRequest: vi.fn(), subscribe } as unknown as RpcClient
    function Harness(): null {
      useMobileNativeChatSession({
        client,
        sourceIdentity: 'host-1\0nexos',
        agent: chat?.agent ?? null,
        sessionId: chat?.sessionId ?? null,
        transcriptPath: chat?.transcriptPath ?? null
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe.mock.calls[0]?.[0]).toBe('nativeChat.subscribe')
    expect(subscribe.mock.calls[0]?.[1]).toMatchObject({
      agent: 'claude',
      sessionId: 'ad1e3053-f9ac-40be-80be-8f33a800e9b1',
      transcriptPath: `${PROJECT_DIR}ad1e3053-f9ac-40be-80be-8f33a800e9b1.jsonl`
    })
  })

  it('opens a lone pane on its session too', () => {
    const pane = PANES[1]!
    expect(
      chatForPill([paneTab(pane, { isActive: true })], [paneTerminal(pane)], `${TAB_ID}::${pane.leafId}`)
    ).toMatchObject({ sessionId: pane.sessionId, transcriptPath: transcriptPathOf(pane) })
  })

  it("gives a pane that reported no session none, rather than a sibling's", () => {
    // The pane Orca launched Claude in names it on the tab, but its status has
    // not carried a session yet. The chat waits; it must not borrow one.
    const bare = PANES[1]!
    const tabs = PANES.map((pane) =>
      pane === bare ? paneTab(pane, { agentStatus: undefined, launchAgent: 'claude' }) : paneTab(pane)
    )
    expect(chatForPill(tabs, PANES.map(paneTerminal), `${TAB_ID}::${bare.leafId}`)).toEqual({
      agent: 'claude',
      source: 'launch',
      sessionId: null,
      transcriptPath: null
    })
    for (const pane of PANES.filter((each) => each !== bare)) {
      expect(chatForPill(tabs, PANES.map(paneTerminal), `${TAB_ID}::${pane.leafId}`)?.sessionId).toBe(
        pane.sessionId
      )
    }
  })

  it('offers no chat on a pane with no status and no agent named', () => {
    const bare = PANES[1]!
    const tabs = PANES.map((pane) => (pane === bare ? paneTab(pane, { agentStatus: undefined }) : paneTab(pane)))
    expect(chatForPill(tabs, PANES.map(paneTerminal), `${TAB_ID}::${bare.leafId}`)).toBeNull()
  })

  it('gives a pane the snapshot left out no session when the terminal list adds it back', () => {
    // A leaf only `terminal.list` knows is built on the phone with no status.
    const missing = PANES[1]!
    const tabs = PANES.filter((pane) => pane !== missing).map((pane) => paneTab(pane))
    const strip = reconcileSessionTabsWithTerminalList(tabs, PANES.map(paneTerminal))
    const added = strip.find((tab) => tab.id === `${TAB_ID}::${missing.leafId}`)
    expect(added).toMatchObject({ synthesizedFromTerminalList: true, terminal: missing.handle })
    expect(added?.type === 'terminal' ? resolveMobileNativeChat(added) : 'not a terminal').toBeNull()
  })
})

// The same tab as the desktop published it on 2026-09-25 (Orca 1.4.211): the
// 1037 pane came through `session.tabs` as `status: 'pending-handle'`,
// `terminal: null`, while `terminal.list` listed its PTY live under the same
// `tabId`/`leafId`. The phone drew that pane twice under one id, a pill with
// its activity dot and a second, dotless one built from the terminal list, and
// React warned about the duplicate key.
describe('a split pane the desktop published before its handle', () => {
  const PENDING = PANES[1]!
  const pendingTab = (): MobileTerminalSessionTab =>
    paneTab(PENDING, { status: 'pending-handle', terminal: null })
  const tabsWithPendingPane = (): MobileTerminalSessionTab[] =>
    PANES.map((pane) => (pane === PENDING ? pendingTab() : paneTab(pane)))
  const pillsFor = (strip: readonly MobileSessionTabLike[], pane: Pane): MobileTerminalSessionTab[] =>
    strip.filter(
      (tab): tab is MobileTerminalSessionTab =>
        tab.type === 'terminal' && tab.id === `${TAB_ID}::${pane.leafId}`
    )

  it('draws each of the four panes once, the pending one with its activity dot', () => {
    const strip = reconcileSessionTabsWithTerminalList(tabsWithPendingPane(), PANES.map(paneTerminal))

    expect(strip.map((tab) => tab.id)).toEqual(PANES.map((pane) => `${TAB_ID}::${pane.leafId}`))
    const pills = pillsFor(strip, PENDING)
    // The one pill is the host's, exactly as published: it keeps the status
    // the dot is drawn from, and waits for the desktop to name its handle.
    expect(pills).toEqual([pendingTab()])
    expect(chatForPill(tabsWithPendingPane(), PANES.map(paneTerminal), pills[0]!.id)).toMatchObject({
      sessionId: PENDING.sessionId,
      transcriptPath: transcriptPathOf(PENDING)
    })
  })

  it('draws a lone pending pane once', () => {
    expect(reconcileSessionTabsWithTerminalList([pendingTab()], [paneTerminal(PENDING)])).toEqual([
      pendingTab()
    ])
  })

  it('draws nothing for a tab the desktop reports no panes for', () => {
    expect(reconcileSessionTabsWithTerminalList([], [paneTerminal(PENDING)])).toEqual([])
    expect(reconcileSessionTabsWithTerminalList([], [])).toEqual([])
  })

  it('leaves the pending pane waiting when the terminal list has no live PTY for it', () => {
    for (const listed of [
      [],
      [{ ...paneTerminal(PENDING), connected: false }],
      [{ ...paneTerminal(PENDING), orphaned: true }]
    ]) {
      expect(reconcileSessionTabsWithTerminalList([pendingTab()], listed)).toEqual([pendingTab()])
    }
  })

  it('draws a pending pane once when the terminal list names two PTYs for it', () => {
    const strip = reconcileSessionTabsWithTerminalList(
      [pendingTab()],
      [paneTerminal(PENDING), { ...paneTerminal(PENDING), handle: 'pty-other' }]
    )

    expect(strip).toEqual([pendingTab()])
  })

  it('keeps the handle the desktop gave a pane when the list names a second PTY for it', () => {
    const strip = reconcileSessionTabsWithTerminalList(
      [paneTab(PENDING)],
      [paneTerminal(PENDING), { ...paneTerminal(PENDING), handle: 'pty-other' }]
    )

    expect(strip).toEqual([paneTab(PENDING)])
  })

  it('keeps the pending pane the same through a snapshot, a sweep and the next snapshot', () => {
    // The route folds each applied strip back into its terminal records
    // (mergeTerminalRecordsByCurrentOrder), and those records no longer carry
    // the leaf address, so whatever the strip derives from that address must
    // not flip between the snapshot phase and the sweep phase.
    const listed = PANES.map(paneTerminal)
    const first = reconcileSessionTabsWithTerminalList(tabsWithPendingPane(), listed)
    const folded = mergeTerminalRecordsByCurrentOrder(getTerminalRecordsFromSessionTabs(first), listed)
    const nextSnapshot = reconcileSessionTabsWithTerminalList(tabsWithPendingPane(), folded)
    const sweep = reconcileSessionTabsWithTerminalList(nextSnapshot, listed)

    expect(nextSnapshot).toEqual(first)
    expect(sweep).toEqual(first)
  })

  it('keeps the handle once the desktop names it, even when a sweep then misses the PTY', () => {
    // setSessionTabs keeps the previous strip when the next one compares equal,
    // so anything the phone put on the pending pane outlives the snapshot
    // that superseded it.
    const ready = paneTab(PENDING, { status: 'ready' })
    const beforeHandle = reconcileSessionTabsWithTerminalList([pendingTab()], [paneTerminal(PENDING)])
    const withHandle = reconcileSessionTabsWithTerminalList([ready], [paneTerminal(PENDING)])
    const kept = mobileSessionTabsEqual(beforeHandle, withHandle) ? beforeHandle : withHandle

    const swept = reconcileSessionTabsWithTerminalList(kept, [
      { ...paneTerminal(PENDING), connected: false }
    ])

    expect(swept).toEqual([ready])
  })

  it('builds one pill for a leaf the snapshot left out even when the list names it twice', () => {
    const strip = reconcileSessionTabsWithTerminalList(
      [paneTab(PANES[0]!)],
      [paneTerminal(PANES[0]!), paneTerminal(PENDING), { ...paneTerminal(PENDING), handle: 'pty-other' }]
    )

    expect(strip.map((tab) => tab.id)).toEqual([
      `${TAB_ID}::${PANES[0]!.leafId}`,
      `${TAB_ID}::${PENDING.leafId}`
    ])
  })

  it('leaves the wait on a pending pane to its own retry budget, not an endless tab poll', () => {
    // "A connected terminal the snapshot dropped" forces a session.tabs poll
    // every 2 s with no budget. The pending pane was not dropped: it is on the
    // strip waiting for a handle, and the pending-handle recovery, which gives
    // up after five tries and offers Retry, owns that wait.
    const listed = PANES.map(paneTerminal)
    const strip = reconcileSessionTabsWithTerminalList(tabsWithPendingPane(), listed)

    expect(hasConnectedTerminalAbsentFromSessionTabs(listed, strip)).toBe(false)
    expect(
      hasConnectedTerminalAbsentFromSessionTabs(
        [{ ...paneTerminal(PENDING), handle: 'pty-other' }],
        [paneTab(PENDING)]
      )
    ).toBe(false)
  })

  it('still asks again for a live PTY whose leaf the strip does not have', () => {
    expect(hasConnectedTerminalAbsentFromSessionTabs([paneTerminal(PENDING)], [])).toBe(true)
    expect(
      hasConnectedTerminalAbsentFromSessionTabs(
        [{ ...paneTerminal(PENDING), leafId: undefined }],
        [pendingTab()]
      )
    ).toBe(true)
  })
})
