import { useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'
import { useAgentHudBeacon } from './agent-hud-beacon'
import { resolveMobileNativeChat, type MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { useMobileSessionViewMode } from './use-mobile-session-view-mode'

export function useMobileNativeChatActiveResolution(args: {
  hostId: string
  worktreeId: string
  activeSessionTab: MobileNativeChatTab | null
  activeSessionTabId: string | null
  /** The active PTY as this render knows it. Everything derived below reads
   *  THIS, never `activeHandleRef`: a ref is mutated outside React, so reading
   *  one during render makes the render impure — the value is not tracked, and
   *  `useSyncExternalStore` keeps a snapshot closed over whichever handle the
   *  last render happened to see. */
  activeHandle: string | null
  /** Kept for callbacks and effects, which run after the ref has settled. */
  activeHandleRef: MutableRefObject<string | null>
  nativeChatTranscriptIsLocalReadable: boolean
}): {
  isTabChatView: (tabId: string, agent?: string | null) => boolean
  toggleTabChatView: (tabId: string, agent?: string | null) => void
  peekTerminalTab: (tabId: string) => void
  endTerminalPeek: () => void
  /** The active tab is a chat tab currently showing its terminal via a peek. */
  terminalPeekActive: boolean
  viewResolved: boolean
  /** The active tab could render chat (tracked agent with a readable transcript),
   *  whichever view it currently shows — drives the header's view toggle. */
  activeChatEligible: boolean
  showNativeChat: boolean
  showNativeChatRef: MutableRefObject<boolean>
  activeChatAgent: string | null
  activeChatAgentRef: MutableRefObject<string | null>
  activeChatSessionId: string | null
  activeChatStructured: boolean
  activeChatResolution: ReturnType<typeof resolveMobileNativeChat>
  activeTabAgentWorking: boolean
  nativeChatStatus: MobileNativeChatTab['agentStatus'] | null
  sourceIdentity: string
  streamIdentity: string
  streamScopeKey: string
} {
  const {
    activeHandle,
    activeSessionTab,
    activeSessionTabId,
    hostId,
    nativeChatTranscriptIsLocalReadable,
    worktreeId
  } = args
  const {
    isTabChatView,
    toggleTabChatView,
    peekTerminalTab,
    endTerminalPeek,
    peekedTerminalTabId,
    viewResolved
  } = useMobileSessionViewMode({ hostId, worktreeId })
  const terminalPeekActive = activeSessionTabId != null && peekedTerminalTabId === activeSessionTabId
  const beaconAgent = useAgentHudBeacon(activeHandle)?.agent ?? null
  const chatIdentity =
    activeSessionTab != null
      ? resolveMobileNativeChat(
          activeSessionTab,
          nativeChatTranscriptIsLocalReadable,
          beaconAgent
        )
      : null
  const tabWantsChat =
    activeSessionTab?.type === 'agent-session' ||
    (activeSessionTabId ? isTabChatView(activeSessionTabId, chatIdentity?.agent ?? null) : false)
  const activeChatResolution =
    activeSessionTab && activeSessionTabId && tabWantsChat ? chatIdentity : null
  const showNativeChat = activeChatResolution != null
  const activeChatEligible = activeSessionTab != null && activeSessionTabId != null && chatIdentity != null
  const showNativeChatRef = useRef(showNativeChat)
  const activeChatAgent = activeChatResolution?.agent ?? null
  const activeChatAgentRef = useRef<string | null>(activeChatAgent)

  useLayoutEffect(() => {
    showNativeChatRef.current = showNativeChat
    activeChatAgentRef.current = activeChatAgent
  }, [activeChatAgent, showNativeChat])

  const activeChatSessionId = activeChatResolution?.sessionId ?? null
  const activeChatStructured =
    activeChatResolution != null && activeSessionTab?.type === 'agent-session'
  const activeTabStatus = activeSessionTab?.agentStatus
  const activeTabAgentWorking =
    activeTabStatus?.state === 'working' && activeTabStatus.workingMode !== 'monitoring'
  const nativeChatStatus = activeChatResolution && !activeChatStructured ? activeTabStatus : null
  const routeKey = `${hostId}\0${worktreeId}\0${activeSessionTabId ?? ''}`
  const streamIdentity = `${routeKey}\0${activeChatSessionId ?? ''}\0${activeHandle ?? ''}`
  const providerSessionId = activeSessionTab?.agentStatus?.providerSession?.id ?? ''
  const streamScopeKey = `${routeKey}\0${activeChatSessionId ?? providerSessionId}\0${activeHandle ?? ''}`

  return {
    isTabChatView,
    toggleTabChatView,
    peekTerminalTab,
    endTerminalPeek,
    terminalPeekActive,
    viewResolved,
    activeChatEligible,
    showNativeChat,
    showNativeChatRef,
    activeChatAgent,
    activeChatAgentRef,
    activeChatSessionId,
    activeChatStructured,
    activeChatResolution,
    activeTabAgentWorking,
    nativeChatStatus,
    sourceIdentity: encodeNativeChatTranscriptIdentity([hostId, worktreeId]),
    streamIdentity,
    streamScopeKey
  }
}
