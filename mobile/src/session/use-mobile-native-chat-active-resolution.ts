import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'
import { useAgentHudBeacon } from './agent-hud-beacon'
import {
  nativeChatStatusReadingLogLine,
  type NativeChatSessionIdentity,
  type NativeChatStatusReading
} from './native-chat-kept-session'
import {
  nativeChatKeptSessionKey,
  useFreshNativeChatBeaconSession,
  useNativeChatTabStatusReading
} from './native-chat-kept-session-store'
import { chatDefaultAgent } from './mobile-session-view-default'
import { resolveMobileNativeChat, type MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { useMobileSessionViewMode } from './use-mobile-session-view-mode'
import { useTaskReaderStatus } from './agent-status-stand-in'

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
  /** The link is up and the tab list is the host's own, so the phone sees
   *  every status the tab is sent (agent-status-stand-in.ts). */
  watching?: boolean
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
  chatViewSelected: boolean
  showNativeChatRef: MutableRefObject<boolean>
  activeChatAgent: string | null
  activeChatAgentRef: MutableRefObject<string | null>
  activeChatSessionId: string | null
  activeChatStructured: boolean
  activeChatResolution: ReturnType<typeof resolveMobileNativeChat>
  /** The active tab's chat identity whichever view it shows; null for a tab
   *  with no chat. `activeChatResolution` is this while the chat is on screen. */
  activeChatIdentity: ReturnType<typeof resolveMobileNativeChat>
  activeTabAgentWorking: boolean
  nativeChatStatus: MobileNativeChatTab['agentStatus'] | null
  /** The tab's status as the chat may use it: null while it is a nested
   *  agent's (native-chat-kept-session.ts), so it drives no Working row, no
   *  model, no tasks. Everything in the chat reads this, not the raw status. */
  activeChatAgentStatus: NonNullable<MobileNativeChatTab['agentStatus']> | null
  /** The same status as the task readers read it (the running count, the
   *  tasks sheet, the task memory, the run clock): the pane's last hook row
   *  while Orca stands in its title with a status that says nothing about
   *  background work, when the phone watched the pane since (agent-status-stand-in.ts). */
  activeChatTaskStatus: NonNullable<MobileNativeChatTab['agentStatus']> | null
  /** The raw status, for the desk-prompt reader only: its own session check
   *  refuses a nested agent's prompt, and it must still SEE that prompt, or
   *  the same text coming back with the agent's own status reads as new. */
  activeChatPromptStatus: NonNullable<MobileNativeChatTab['agentStatus']> | null
  /** The session the chat reads, whichever view the tab shows, and the one a
   *  nested agent's status named instead, when one did. */
  activeChatSessionIdentity: NativeChatSessionIdentity | null
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
    watching = false,
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
  const beacon = useAgentHudBeacon(activeHandle)
  const beaconAgent = beacon?.agent ?? null
  const reportedIdentity =
    activeSessionTab != null
      ? resolveMobileNativeChat(
          activeSessionTab,
          nativeChatTranscriptIsLocalReadable,
          beaconAgent
        )
      : null
  // Whose word the status is. A nested agent (Grok launched from Claude's Bash
  // tool, 2026-09-28) posts as this pane; its session is not the chat's, and
  // the session the tab's own agent last named is kept instead.
  const tabStatus = activeSessionTab?.agentStatus ?? null
  const onTerminal = activeSessionTab?.type === 'terminal'
  const readAgent = onTerminal ? (reportedIdentity?.agent ?? null) : null
  const keptKey =
    readAgent && activeSessionTabId ? nativeChatKeptSessionKey(hostId, activeSessionTabId, readAgent) : null
  const painting = useFreshNativeChatBeaconSession(beacon, readAgent, activeHandle)
  const reading = useNativeChatTabStatusReading(keptKey, readAgent, tabStatus, painting)
  const chatIdentity = reportedIdentity ? withReadSession(reportedIdentity, reading) : null
  const readingLog = nativeChatStatusReadingLogLine(readAgent, reading)
  useEffect(() => {
    if (readingLog !== null) {
      console.warn(readingLog)
    }
  }, [readingLog])
  const chatStatus = reading.kind === 'nested' ? null : tabStatus
  // A beacon that keeps a heartbeat and is not painting has gone silent, or
  // was written off: its process has left the pane (agent-status-stand-in.ts).
  const heartbeatSilent =
    readAgent !== null && beacon?.agent === readAgent && beacon.heartbeatSeconds != null && Boolean(beacon.sessionId) && painting === null
  const taskStatus = useTaskReaderStatus(chatStatus, watching, {
    turnCompletedAt: activeSessionTab?.turnCompletedAt ?? null,
    heartbeatSilent
  })
  // The agent that decides the DEFAULT view, which a hand-started one does not:
  // see `chatDefaultAgent`. An explicit toggle is an override and still wins.
  const defaultViewAgent = chatDefaultAgent(chatIdentity?.agent, chatIdentity?.source)
  const tabWantsChat =
    activeSessionTab?.type === 'agent-session' ||
    (activeSessionTabId ? isTabChatView(activeSessionTabId, defaultViewAgent) : false)
  const activeChatResolution =
    activeSessionTab && activeSessionTabId && tabWantsChat ? chatIdentity : null
  const showNativeChat = activeChatResolution != null
  // True as soon as this tab is a chat, before its transcript id exists. The
  // terminal bar uses this so it does not flash under the chat field.
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
  const activeTabStatus = chatStatus
  const activeTabAgentWorking =
    activeTabStatus?.state === 'working' && activeTabStatus.workingMode !== 'monitoring'
  const nativeChatStatus = activeChatResolution && !activeChatStructured ? activeTabStatus : null
  const routeKey = `${hostId}\0${worktreeId}\0${activeSessionTabId ?? ''}`
  const streamIdentity = `${routeKey}\0${activeChatSessionId ?? ''}\0${activeHandle ?? ''}`
  // The session the chat reads, so a peek at the terminal keeps the scope the
  // chat had, a nested agent's status or not.
  const providerSessionId = chatIdentity?.sessionId ?? tabStatus?.providerSession?.id ?? ''
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
    chatViewSelected: tabWantsChat,
    showNativeChatRef,
    activeChatAgent,
    activeChatAgentRef,
    activeChatSessionId,
    activeChatStructured,
    activeChatResolution,
    activeChatIdentity: chatIdentity,
    activeTabAgentWorking,
    nativeChatStatus,
    activeChatAgentStatus: chatStatus,
    activeChatTaskStatus: taskStatus,
    activeChatPromptStatus:
      activeChatResolution && !activeChatStructured && !(reading.kind === 'nested' && reading.read === null)
        ? tabStatus
        : null,
    activeChatSessionIdentity: chatIdentity
      ? {
          sessionId: chatIdentity.sessionId,
          transcriptPath: chatIdentity.transcriptPath,
          nestedSessionId: reading.kind === 'nested' ? reading.nestedSessionId : null
        }
      : null,
    sourceIdentity: encodeNativeChatTranscriptIdentity([hostId, worktreeId]),
    streamIdentity,
    streamScopeKey
  }
}

/** The chat's identity with the session the reading says to read: the kept
 *  one over a nested agent's, the kept transcript for the kept session named
 *  bare, and the status's own otherwise. */
function withReadSession(
  identity: NonNullable<ReturnType<typeof resolveMobileNativeChat>>,
  reading: NativeChatStatusReading
): NonNullable<ReturnType<typeof resolveMobileNativeChat>> {
  if (reading.kind === 'own') {
    return { ...identity, sessionId: reading.sessionId, transcriptPath: reading.transcriptPath }
  }
  if (reading.kind === 'nested') {
    // With nothing better to read, the session as reported, minus a path that
    // is not this agent's.
    return reading.read
      ? { ...identity, sessionId: reading.read.sessionId, transcriptPath: reading.read.transcriptPath }
      : { ...identity, sessionId: reading.nestedSessionId, transcriptPath: null }
  }
  return identity
}
