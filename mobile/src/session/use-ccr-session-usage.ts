import { useRef, useSyncExternalStore } from 'react'
import { ccrAccountForTab, ccrSessionForTab } from './ccr-session-cache'
import { ccrUsageForTab, ccrUsageVersion, subscribeCcrUsage, type CcrUsageReading } from './ccr-session-usage'

/**
 * The tab's own session context and account plan usage from Anthropic (ccr-session-usage.ts), read
 * where the model hook writes them (`useCcrSessionModel` re-reads once a minute). `matchedAccount`
 * is true while the tab stands matched to an account, whether or not a reading is fresh: the usage
 * rows then come from that account or from nothing, never from the host's feed (ccr-usage-hud.ts).
 * Off, or no tab: no reading and not matched.
 */
export function useCcrSessionUsage(args: {
  enabled: boolean
  tabId: string | null
  agentSessionId?: string | null
  epoch: number | null
  /** For tests: the clock the freshness is read against. */
  now?: () => number
}): { reading: CcrUsageReading | null; matchedAccount: boolean } {
  useSyncExternalStore(subscribeCcrUsage, ccrUsageVersion, ccrUsageVersion)
  const nowRef = useRef(args.now ?? Date.now)
  nowRef.current = args.now ?? Date.now
  const { enabled, tabId, epoch } = args
  if (!enabled || !tabId) {
    return { reading: null, matchedAccount: false }
  }
  const agentSessionId = args.agentSessionId ?? null
  const sessionId = ccrSessionForTab(tabId, epoch, agentSessionId)
  const accountId = ccrAccountForTab(tabId, epoch, agentSessionId)
  return {
    reading: ccrUsageForTab(tabId, epoch, sessionId, accountId, nowRef.current()),
    matchedAccount: accountId !== null
  }
}
