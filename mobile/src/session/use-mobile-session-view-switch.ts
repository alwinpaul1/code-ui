import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { mobileVisibleTerminalDisplayMode } from './mobile-session-route-helpers'
import { releaseFloorUntilAccepted, shouldReleaseFloor } from './mobile-terminal-floor-release'
import type { MobileSessionPanelRouteActionsModel } from './use-mobile-session-panel-route-actions'

/**
 * Chat and terminal want different PTY widths. Under Chat UI the terminal is
 * covered, so it should run at desktop width and the person at the desk keeps
 * a full-width TUI; when the terminal view is shown on the phone it should run
 * at phone width ('auto'), including a plain shell and an agent already in
 * terminal mode. Switching view therefore switches display mode too.
 *
 * Order matters for the glitch: going chat → terminal, the mode is requested
 * and acknowledged BEFORE the view flips, so the terminal is first painted at
 * phone width instead of appearing at desktop width and reflowing. Going
 * terminal → chat, the view flips first and the width changes under cover.
 */
export function useMobileSessionViewSwitch(scope: MobileSessionPanelRouteActionsModel) {
  const { activeHandle, sessionTabs, setDisplayMode, nativeChatController } = scope
  const { isTabChatView, toggleTabChatView, showNativeChat } = nativeChatController

  const handleForTab = useCallback(
    (tabId: string): string | null => {
      const tab = sessionTabs.find((candidate) => candidate.id === tabId)
      return tab && tab.type === 'terminal' ? (tab.terminal ?? null) : null
    },
    [sessionTabs]
  )

  const switchTabView = useCallback(
    async (tabId: string): Promise<void> => {
      const tab = sessionTabs.find((candidate) => candidate.id === tabId)
      const agent =
        tab?.type === 'terminal'
          ? (tab.launchAgent ?? tab.agentStatus?.agentType ?? null)
          : tab?.type === 'agent-session'
            ? tab.agent
            : null
      const handle = handleForTab(tabId)
      if (isTabChatView(tabId, agent)) {
        if (handle) {
          await setDisplayMode(handle, 'auto')
        }
        toggleTabChatView(tabId, agent)
        return
      }
      toggleTabChatView(tabId, agent)
      if (handle) {
        void setDisplayMode(handle, 'desktop')
      }
    },
    [handleForTab, isTabChatView, sessionTabs, setDisplayMode, toggleTabChatView]
  )

  // Transitions the switch above did not drive (default chat on open, the
  // slash-command terminal peek, the "Back to chat" chip): apply the same
  // pairing when the visible view changes. Only on a change — a manual
  // phone/desktop toggle inside the terminal view is left alone.
  const lastRef = useRef<{ handle: string | null; chat: boolean } | null>(null)
  useEffect(() => {
    const last = lastRef.current
    lastRef.current = { handle: activeHandle, chat: showNativeChat }
    const want = mobileVisibleTerminalDisplayMode(activeHandle, showNativeChat)
    if (!activeHandle || !want) {
      return
    }
    if (last && last.handle === activeHandle && last.chat === showNativeChat) {
      return
    }
    void setDisplayMode(activeHandle, want)
  }, [activeHandle, setDisplayMode, showNativeChat])

  // Why: asking for phone dims is also the presence-lock take-floor gesture, so
  // a terminal this route drove leaves the desk showing "Your phone is in
  // control" with its keyboard paused. Leaving the route is the phone saying it
  // is done with that PTY; hand it back to desktop width rather than making
  // someone click "Take back this terminal".
  const drivenHandlesRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const want = mobileVisibleTerminalDisplayMode(activeHandle, showNativeChat)
    if (activeHandle && want === 'auto') {
      drivenHandlesRef.current.add(activeHandle)
    }
  }, [activeHandle, showNativeChat])
  const setDisplayModeRef = useRef(setDisplayMode)
  setDisplayModeRef.current = setDisplayMode
  const activeHandleStateRef = useRef(activeHandle)
  activeHandleStateRef.current = activeHandle
  const showNativeChatStateRef = useRef(showNativeChat)
  showNativeChatStateRef.current = showNativeChat

  /** Hand one handle back, retrying, unless the reader is driving it again.
   *
   *  The app being FOREGROUND is part of "driving it": backgrounded, the
   *  terminal is still the active view and `showNativeChat` is still false, so
   *  a reclaim check that looked only at those two fired instantly on the very
   *  case it exists to handle and the release never went out. Measured: HOME
   *  left the desk at COLS=51 with this fix in place. */
  const releaseHandle = useCallback((handle: string) => {
    const driven = drivenHandlesRef.current
    if (!shouldReleaseFloor({ drivenHandles: driven, handle })) {
      return
    }
    driven.delete(handle)
    void releaseFloorUntilAccepted({
      release: () => setDisplayModeRef.current(handle, 'desktop'),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isReclaimed: () =>
        AppState.currentState === 'active' &&
        activeHandleStateRef.current === handle &&
        !showNativeChatStateRef.current
    })
  }, [])

  // Measured: HOME left the desk at 51 columns indefinitely. Backgrounding
  // unmounts nothing, so without this nothing ever hands the floor back.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        return
      }
      // Snapshot first: releasing removes the handle from the same set.
      const driven = Array.from(drivenHandlesRef.current)
      for (const handle of driven) {
        releaseHandle(handle)
      }
    })
    return () => subscription.remove()
  }, [releaseHandle])

  // Measured: switching to another tab left the desk at 51 columns too. The
  // switch nulls activeHandle before the effect above runs, so the handle the
  // phone actually drove has to be remembered and released by name.
  const lastDrivenHandleRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = lastDrivenHandleRef.current
    const current = mobileVisibleTerminalDisplayMode(activeHandle, showNativeChat) === 'auto'
      ? activeHandle
      : null
    lastDrivenHandleRef.current = current
    if (previous && previous !== current) {
      releaseHandle(previous)
    }
  }, [activeHandle, releaseHandle, showNativeChat])

  useEffect(() => {
    const driven = drivenHandlesRef.current
    return () => {
      for (const handle of driven) {
        void setDisplayModeRef.current(handle, 'desktop')
      }
      driven.clear()
    }
  }, [])

  return { switchTabView }
}
