import {
  getTerminalRecordsFromSessionTabs,
  type MobileSessionTabLike,
  type MobileTerminalSessionTab,
  type TerminalRecord
} from './mobile-terminal-records'

/** The tab id a terminal tab belongs to. The host addresses every terminal tab
 *  as `parentTabId::leafId`; a host that predates those fields sends the tab id
 *  as the id itself. */
function sessionTabGroupId(tab: MobileTerminalSessionTab): string {
  return tab.parentTabId ?? tab.id
}

/**
 * `session.tabs` owns the strip. `terminal.list` may only ADD a split leaf the
 * snapshot omitted, and may only take back a leaf it added itself.
 *
 * A host terminal tab carries what `terminal.list` does not: `launchAgent`, the
 * live `agentStatus`, its status and launch draft. Dropping one and rebuilding
 * it from a terminal record therefore costs the session its agent identity,
 * which is what took the header's Chat/Terminal toggle away and stopped Claude
 * and Codex sessions opening in Chat UI (0.3.4 — the filter here matched every
 * host tab, because `parentTabId !== id` is true for all of them, not just for
 * a split leaf).
 */
export function reconcileSessionTabsWithTerminalList(
  tabs: readonly MobileSessionTabLike[],
  terminals: readonly TerminalRecord[]
): MobileSessionTabLike[] {
  const liveHandles = new Set(
    terminals
      .filter((terminal) => terminal.connected === true && terminal.orphaned !== true)
      .map((terminal) => terminal.handle)
  )
  const kept = tabs.filter(
    (tab) =>
      tab.type !== 'terminal' ||
      tab.synthesizedFromTerminalList !== true ||
      (typeof tab.terminal === 'string' && liveHandles.has(tab.terminal))
  )
  return appendUnlistedConnectedTerminalTabs(kept, terminals)
}

export function appendUnlistedConnectedTerminalTabs(
  tabs: readonly MobileSessionTabLike[],
  terminals: readonly TerminalRecord[]
): MobileSessionTabLike[] {
  const listedHandles = new Set(
    getTerminalRecordsFromSessionTabs(tabs).map((terminal) => terminal.handle)
  )
  // Why: a leaf may only join a tab the host still reports. A closed tab's PTY
  // lingers in the last `terminal.list` for a beat, and without this the sweep
  // put the tab the user had just closed straight back on the strip.
  const hostTabGroupIds = new Set(
    tabs.flatMap((tab) =>
      tab.type === 'terminal' && tab.synthesizedFromTerminalList !== true
        ? [sessionTabGroupId(tab)]
        : []
    )
  )
  const extras: MobileTerminalSessionTab[] = []
  for (const terminal of terminals) {
    const parentTabId = terminal.tabId
    if (
      terminal.connected !== true ||
      terminal.orphaned === true ||
      listedHandles.has(terminal.handle) ||
      !parentTabId ||
      !hostTabGroupIds.has(parentTabId)
    ) {
      continue
    }
    listedHandles.add(terminal.handle)
    extras.push({
      type: 'terminal',
      // The host's own address for a leaf. A tab id that churns between the
      // snapshot and the sweep loses the per-tab chat/terminal override and the
      // buffered draft, both of which are keyed by it.
      id: terminal.leafId ? `${parentTabId}::${terminal.leafId}` : terminal.handle,
      title: terminal.title || 'Terminal',
      parentTabId,
      leafId: terminal.leafId,
      terminal: terminal.handle,
      terminalTheme: terminal.terminalTheme,
      // The only agent identity a synthesized leaf can have: the host named it
      // on the terminal record, since no session tab carried this leaf.
      ...(terminal.agentIdentity ? { launchAgent: terminal.agentIdentity } : {}),
      synthesizedFromTerminalList: true,
      isActive: false
    })
  }
  return extras.length === 0 ? [...tabs] : [...tabs, ...extras]
}
