import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { hostImageMissing } from './host-image-refusals'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import {
  agentShareName,
  askRowsIn,
  setShareAskRecord,
  shareAskKey,
  shareAskPhase,
  shareAskRecord,
  shareAskText,
  subscribeShareAsks,
  type ShareAskPhase
} from './agent-image-share-ask'

/** What a picture's placeholder needs to offer the ask (agent-image-share-ask.ts):
 *  the tab it belongs to, the agent's name, that tab's transcript, and the send. */
export type AgentImageShare = {
  /** The tab and session the asks belong to: an ask follows its tab, so
   *  another tab showing the same path offers its own. */
  tabKey: string
  agentName: string
  messages: readonly NativeChatMessage[]
  working: boolean
  ask: (path: string) => void
}

// No react-native import here: the controller imports this file, and its
// tests load no native module (the overlay's box is AgentImageShareView.tsx).
export const AgentImageShareContext = createContext<AgentImageShare | null>(null)

export function useAgentImageShareAsks(args: {
  tabId: string | null
  sessionId: string | null
  agent: string | null
  messages: readonly NativeChatMessage[]
  working: boolean
  /** The composer's text send; null where pictures are never asked of the host. */
  send: ((text: string) => Promise<MobileNativeChatSendOutcome>) | null
}): AgentImageShare | null {
  const { tabId, sessionId, agent, messages, working, send } = args
  const tabKey = tabId && sessionId ? `${tabId}\0${sessionId}` : null
  // Read at the tap, not as of the render the button was drawn in.
  const latest = useRef({ tabKey, messages, working, send })
  latest.current = { tabKey, messages, working, send }
  const ask = useCallback((path: string) => {
    const now = latest.current
    if (!now.tabKey || !now.send) {
      return
    }
    const key = shareAskKey(now.tabKey, path)
    const before = shareAskRecord(now.tabKey, path)
    const phase = shareAskPhase({ record: before, messages: now.messages, path, working: now.working, missing: hostImageMissing(path) })
    if (phase !== 'offer') {
      return
    }
    const text = shareAskText(path)
    setShareAskRecord(key, { asks: (before?.asks ?? 0) + 1, rowsBefore: askRowsIn(now.messages, text), sending: true })
    void now
      .send(text)
      .catch((): MobileNativeChatSendOutcome => 'rejected')
      .then((outcome) => {
        const sent = shareAskRecord(now.tabKey!, path)
        // Refused before it reached the desktop or the outbox: the button comes
        // back as it was. Held by the outbox, or written: it was asked.
        setShareAskRecord(key, outcome === 'rejected' ? before : sent && { ...sent, sending: false })
      })
  }, [])
  return useMemo(
    () => (tabKey && send ? { tabKey, agentName: agentShareName(agent), messages, working, ask } : null),
    [agent, ask, messages, send, tabKey, working]
  )
}

/** The placeholder's view of one picture's ask. */
export function useAgentImageSharePhase(path: string | undefined, missing: ReturnType<typeof hostImageMissing>): {
  share: AgentImageShare | null
  phase: ShareAskPhase
} {
  const share = useContext(AgentImageShareContext)
  const record = useSyncExternalStore(subscribeShareAsks, () => shareAskRecord(share?.tabKey, path))
  const phase =
    share && path ? shareAskPhase({ record, messages: share.messages, path, working: share.working, missing }) : 'none'
  return { share, phase }
}
