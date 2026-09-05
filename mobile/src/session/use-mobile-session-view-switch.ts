import { useCallback, useEffect, useRef } from 'react'
import type { MobileSessionPanelRouteActionsModel } from './use-mobile-session-panel-route-actions'

type DisplayMode = 'auto' | 'desktop'

/**
 * Chat and terminal want different PTY widths. Under Chat UI the terminal is
 * covered, so it should run at desktop width and the person at the desk keeps
 * a full-width TUI; when the terminal view is shown on the phone it should run
 * at phone width ('auto'). Switching view therefore switches display mode too.
 *
 * Order matters for the glitch: going chat → terminal, the mode is requested
 * and acknowledged BEFORE the view flips, so the terminal is first painted at
 * phone width instead of appearing at desktop width and reflowing. Going
 * terminal → chat, the view flips first and the width changes under cover.
 */
export function useMobileSessionViewSwitch(scope: MobileSessionPanelRouteActionsModel) {
  const { activeHandle, sessionTabs, setDisplayMode, nativeChatController } = scope
  const { isTabChatView, toggleTabChatView, showNativeChat, activeChatEligible } =
    nativeChatController

  const handleForTab = useCallback(
    (tabId: string): string | null => {
      const tab = sessionTabs.find((candidate) => candidate.id === tabId)
      return tab && tab.type === 'terminal' ? (tab.terminal ?? null) : null
    },
    [sessionTabs]
  )

  const switchTabView = useCallback(
    async (tabId: string): Promise<void> => {
      const handle = handleForTab(tabId)
      if (isTabChatView(tabId)) {
        if (handle) {
          await setDisplayMode(handle, 'auto')
        }
        toggleTabChatView(tabId)
        return
      }
      toggleTabChatView(tabId)
      if (handle) {
        void setDisplayMode(handle, 'desktop')
      }
    },
    [handleForTab, isTabChatView, setDisplayMode, toggleTabChatView]
  )

  // Transitions the switch above did not drive (default chat on open, the
  // slash-command terminal peek, the "Back to chat" chip): apply the same
  // pairing when the visible view changes. Only on a change — a manual
  // phone/desktop toggle inside the terminal view is left alone.
  const lastRef = useRef<{ handle: string | null; chat: boolean } | null>(null)
  useEffect(() => {
    const last = lastRef.current
    lastRef.current = { handle: activeHandle, chat: showNativeChat }
    if (!activeHandle || !activeChatEligible) {
      return
    }
    if (last && last.handle === activeHandle && last.chat === showNativeChat) {
      return
    }
    const want: DisplayMode = showNativeChat ? 'desktop' : 'auto'
    void setDisplayMode(activeHandle, want)
  }, [activeChatEligible, activeHandle, setDisplayMode, showNativeChat])

  return { switchTabView }
}
