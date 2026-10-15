import { useRef, useSyncExternalStore } from 'react'
import { ccrAccountForConfigDir, ccrAccountForTab, ccrSessionForTab } from './ccr-session-cache'
import { ccrSignedInAccountCount, ccrUsageForTab, ccrUsageVersion, subscribeCcrUsage, type CcrUsageReading } from './ccr-session-usage'

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
  /** The Claude config dir the tab's session writes under, from its transcript path. */
  configDir?: string | null
  epoch: number | null
  /** For tests: the clock the freshness is read against. */
  now?: () => number
}): { reading: CcrUsageReading | null; matchedAccount: boolean; hostFeedAllowed: boolean } {
  useSyncExternalStore(subscribeCcrUsage, ccrUsageVersion, ccrUsageVersion)
  const nowRef = useRef(args.now ?? Date.now)
  nowRef.current = args.now ?? Date.now
  const { enabled, tabId, epoch } = args
  if (!enabled || !tabId) {
    return { reading: null, matchedAccount: false, hostFeedAllowed: true }
  }
  const agentSessionId = args.agentSessionId ?? null
  const sessionId = ccrSessionForTab(tabId, epoch, agentSessionId)
  const accountId = ccrAccountForTab(tabId, epoch, agentSessionId)
  // Matched to a session, else bound through the config dir: the tab's account is known either way.
  const boundId = accountId === null && args.configDir ? ccrAccountForConfigDir(args.configDir) : null
  const known = accountId ?? boundId
  const count = ccrSignedInAccountCount()
  return {
    reading: ccrUsageForTab(tabId, epoch, sessionId, known, nowRef.current()),
    matchedAccount: known !== null,
    // No account known: the host's feed stands in only with at most one account signed in, where it
    // can only be that one. With several, or before the count is read, it could be the other's.
    hostFeedAllowed: count !== null && count <= 1
  }
}
