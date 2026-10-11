import { forgetSessionTab, pickNextSessionTabAfterClose } from './mobile-session-tab-history'
import { forgetFileTabDoc } from '../files/mobile-file-tab-read-cache'
import { planSessionTabClose } from './mobile-session-tab-close-plan'
import {
  CLOSE_IN_FLIGHT_TOMBSTONE_MS,
  CLOSED_TAB_TOMBSTONE_MS,
  readSessionTabCloseError,
  readSessionTabCloseReply,
  restoreRefusedTerminalRecord,
  restoreRefusedSessionTab,
  sessionTabCloseRefusedToast,
  type SessionTabCloseVerdict
} from './mobile-session-tab-close-refusal'
import {
  sessionTabClose,
  sessionTerminalClose,
  sessionTerminalRename
} from './mobile-session-write-operations'
import type { MobileSessionTab, Terminal } from './mobile-session-route-types'
import type { MobileSessionContentCreateActionsModel } from './use-mobile-session-content-create-actions'
import type { RpcResponse } from '../transport/types'

const CLOSE_REFUSED_TOAST_MS = 3000

export function useMobileSessionCloseActions(scope: MobileSessionContentCreateActionsModel) {
  const {
    worktreeId,
    client,
    setTerminals,
    terminals,
    terminalsRef,
    setSessionTabs,
    setFileDocs,
    setMarkdownDocs,
    sessionTabsRef,
    reconcileBufferedDraftsRef,
    closedTabTombstonesRef,
    clearTerminalLiveInputDefault,
    setActiveHandle,
    setActiveSessionTabId,
    activeSessionTabIdRef,
    visitedSessionTabIdsRef,
    switchSessionTabRef,
    selectedSessionTabIdRef,
    renameTarget,
    setRenameTarget,
    terminalRefs,
    initializedHandlesRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    pendingActiveTerminalHandleRef,
    pendingBrowserFocusPageIdRef,
    scheduleDelayedAction,
    unsubscribeTerminal,
    subscribeToTerminal,
    fetchTerminals,
    showToast
  } = scope
  async function handleRenameTerminal(value: string) {
    if (!client || !renameTarget) {
      return
    }
    const target = renameTarget
    setRenameTarget(null)

    try {
      const title = value.trim()
      const response = sessionTerminalRename.interpret(
        await sessionTerminalRename.request(client, { terminal: target.handle, title })
      )
      if (response.accepted) {
        setTerminals((prev) => {
          const next = prev.map((terminal) =>
            terminal.handle === target.handle
              ? { ...terminal, title: title || 'Terminal' }
              : terminal
          )
          terminalsRef.current = next
          return next
        })
        scheduleDelayedAction(() => void fetchTerminals(), 300)
      }
    } catch {
      // Rename failed — refresh will restore the server title.
    }
  }

  /**
   * Sends a close and reads the answer. A reply that names the tab as already gone counts as
   * closed; anything else that is not an accepted close is a refusal with a reason to show.
   */
  async function sendClose(
    send: () => Promise<RpcResponse>,
    accepted: (response: RpcResponse) => boolean
  ): Promise<SessionTabCloseVerdict> {
    try {
      const response = await send()
      const verdict = readSessionTabCloseReply(response)
      if (verdict.kind === 'refused' || !response.ok) {
        return verdict
      }
      return accepted(response) ? verdict : { kind: 'refused', reason: 'the desktop refused' }
    } catch (error) {
      return readSessionTabCloseError(error)
    }
  }

  /**
   * Closes one terminal by its handle, taking it off the phone first. Why: the desktop answers
   * only after its own close transaction (PTY inventory, renderer retirement, session flush), on
   * top of the relay's round trip; holding the record that long is the lag reported 2026-10-11.
   * The PTY stays subscribed until the desktop confirms, so a refusal puts the record back with
   * nothing to re-attach.
   */
  async function closeTerminalOptimistically(target: Terminal): Promise<SessionTabCloseVerdict> {
    const sendingClient = client
    if (!sendingClient) {
      return { kind: 'refused', reason: 'not connected' }
    }
    const before = terminals
    const index = before.findIndex((terminal) => terminal.handle === target.handle)
    const record = index === -1 ? null : before[index]
    const next = before.filter((terminal) => terminal.handle !== target.handle)
    setTerminals(next)
    terminalsRef.current = next
    if (activeHandleRef.current === target.handle) {
      const replacement = next[0] ?? null
      activeHandleRef.current = replacement?.handle ?? null
      pendingActiveTerminalHandleRef.current = replacement?.handle ?? null
      setActiveHandle(replacement?.handle ?? null)
      if (replacement) {
        subscribeToTerminal(replacement.handle)
      }
    }
    const verdict = await sendClose(
      () => sessionTerminalClose.request(sendingClient, { terminal: target.handle }),
      (response) => sessionTerminalClose.interpret(response).accepted
    )
    if (verdict.kind === 'closed') {
      unsubscribeTerminal(target.handle)
      terminalRefs.current.delete(target.handle)
      initializedHandlesRef.current.delete(target.handle)
      clearTerminalLiveInputDefault(target.handle)
      return verdict
    }
    if (record) {
      const restored = restoreRefusedTerminalRecord(terminalsRef.current, record, index)
      terminalsRef.current = restored
      setTerminals(restored)
    }
    return verdict
  }

  async function handleCloseTerminal(target: Terminal): Promise<boolean> {
    if (!client) {
      return false
    }
    const verdict = await closeTerminalOptimistically(target)
    if (verdict.kind === 'refused') {
      showToast(sessionTabCloseRefusedToast(target.title, verdict.reason), CLOSE_REFUSED_TOAST_MS)
      return false
    }
    return true
  }

  function selectAfterClose(tab: MobileSessionTab, remainingTabs: readonly MobileSessionTab[]) {
    // Why: bulk close re-activates the anchor before closing each target;
    // the render-synced ref sees that switch while this closure would not,
    // so comparing against the ref keeps the anchor from being nulled out.
    if (activeSessionTabIdRef.current === tab.id || remainingTabs.length === 0) {
      // Why (#15219): phone switches never update desktop recentTabIds, so
      // nulling the selection here let the next snapshot fall back to
      // tabs[0] (the leftmost tab). Return to the previously viewed tab,
      // else the newest remaining one, and only null out when none is left.
      const nextTab = pickNextSessionTabAfterClose(
        remainingTabs,
        visitedSessionTabIdsRef.current,
        tab.id
      )
      if (nextTab && switchSessionTabRef.current) {
        switchSessionTabRef.current(nextTab)
        return
      }
      activeSessionTabTypeRef.current = null
      selectedSessionTabIdRef.current = null
      activeSessionTabIdRef.current = null
      setActiveSessionTabId(null)
      activeHandleRef.current = null
      setActiveHandle(null)
    }
  }

  /**
   * Closes a tab the way Claude's app does: off the strip on tap, the close sent behind it, and
   * the tab back in its place, with a toast naming why, only if the desktop refuses. Exactly one
   * close goes out per tap: a second `terminal.close` on a split leaf's now-dead handle makes the
   * host close the whole tab (see `planSessionTabClose`).
   */
  async function handleCloseSessionTab(tab: MobileSessionTab) {
    const sendingClient = client
    if (!sendingClient) {
      return
    }
    const plan = planSessionTabClose(tab, sessionTabsRef.current)
    const index = sessionTabsRef.current.findIndex((candidate) => candidate.id === tab.id)
    const remainingTabs = sessionTabsRef.current.filter((candidate) => candidate.id !== tab.id)
    sessionTabsRef.current = remainingTabs
    setSessionTabs(remainingTabs)
    // Why: tombstone the closed tab and rely on the snapshot, not a blind refetch that often
    // re-added the not-yet-closed tab. It must outlive the close itself, which is still in flight.
    closedTabTombstonesRef.current.set(tab.id, Date.now() + CLOSE_IN_FLIGHT_TOMBSTONE_MS)
    forgetSessionTab(visitedSessionTabIdsRef.current, tab.id)
    selectAfterClose(tab, remainingTabs)

    const verdict =
      plan.via === 'terminal-handle'
        ? await closeTerminalOptimistically({
            handle: plan.handle,
            title: tab.title,
            isActive: tab.isActive
          })
        : await sendClose(
            () =>
              sessionTabClose.request(sendingClient, {
                worktree: `id:${worktreeId}`,
                tabId: plan.tabId,
                ...(plan.leafId ? { leafId: plan.leafId } : {}),
                // Why: a tapped tab close is explicit user intent; older hosts strip
                // the unknown field and keep their legacy behavior.
                reason: 'user'
              }),
            (response) => sessionTabClose.interpret(response).accepted
          )

    if (verdict.kind === 'refused') {
      closedTabTombstonesRef.current.delete(tab.id)
      const restored = restoreRefusedSessionTab(sessionTabsRef.current, tab, index)
      sessionTabsRef.current = restored
      setSessionTabs(restored)
      if (activeSessionTabIdRef.current === null && switchSessionTabRef.current) {
        // The last tab came back: nothing else is selected, so it is on screen again.
        switchSessionTabRef.current(tab)
      }
      showToast(sessionTabCloseRefusedToast(tab.title, verdict.reason), CLOSE_REFUSED_TOAST_MS)
      return
    }
    closedTabTombstonesRef.current.set(tab.id, Date.now() + CLOSED_TAB_TOMBSTONE_MS)
    if (plan.via === 'terminal-handle') {
      return
    }
    if (tab.type === 'markdown') {
      // The tab is gone on the host, so its document (up to megabytes of text) has no owner.
      // An unsaved phone draft stays: it is the user's text, not a cache.
      setMarkdownDocs((prev) => {
        const doc = prev.get(tab.id)
        if (!doc || (doc.status === 'ready' && doc.isDirty)) {
          return prev
        }
        const next = new Map(prev)
        next.delete(tab.id)
        return next
      })
    }
    if (tab.type === 'file') {
      // The read cache keeps a copy for the next open of this path; the tab is gone, so it goes too.
      forgetFileTabDoc(worktreeId, tab.relativePath)
      // The tab is gone on the host, so its preview (megabytes of base64 for an image) has no owner.
      setFileDocs((prev) => {
        if (!prev.has(tab.id)) {
          return prev
        }
        const next = new Map(prev)
        next.delete(tab.id)
        return next
      })
    }
    reconcileBufferedDraftsRef.current([...sessionTabsRef.current, tab], sessionTabsRef.current)
    if (tab.type === 'browser' && tab.browserPageId === pendingBrowserFocusPageIdRef.current) {
      pendingBrowserFocusPageIdRef.current = null
    }
    if (tab.type === 'terminal' && typeof tab.terminal === 'string') {
      const terminalHandle = tab.terminal
      unsubscribeTerminal(terminalHandle)
      terminalRefs.current.delete(terminalHandle)
      initializedHandlesRef.current.delete(terminalHandle)
      clearTerminalLiveInputDefault(terminalHandle)
    }
  }
  return {
    handleRenameTerminal,
    handleCloseTerminal,
    handleCloseSessionTab
  }
}

export type MobileSessionCloseActionsModel = MobileSessionContentCreateActionsModel &
  ReturnType<typeof useMobileSessionCloseActions>
