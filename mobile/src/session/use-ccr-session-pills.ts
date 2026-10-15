import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ccrPillsForTab, ccrPillsVersion, CCR_PILLS_REFRESH_MS, refreshCcrPills, subscribeCcrPills, type CcrPillsReading } from './ccr-session-pills'
import { ccrSessionForTab, ccrTriggerVersion, subscribeCcrTriggers, type CcrPipelineDeps } from './ccr-session-pipeline'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

/**
 * The pull request of the tab's Remote Control session (ccr-session-pills.ts), for the session
 * pills. Off, not matched, or not signed in, it returns null and the pills keep today's Orca sources.
 *
 * It never matches a tab: the match is the model hook's (use-ccr-session-model.ts), made once per
 * connection from the same events. This hook reads that match, asks for the pull request on each
 * of the same events (the tab opened, a new connection, a new Claude session in the tab, a
 * sign-in or sign-out, the app back in the foreground) and then every CCR_PILLS_REFRESH_MS while
 * the chat is shown. A tab not matched yet is looked at again after 1, 2, 4 and 8 seconds, which
 * costs a memory read each, not a request.
 */
const WAITS_FOR_MATCH_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000]

export function useCcrSessionPills(args: {
  enabled: boolean
  tabId: string | null
  agentSessionId?: string | null
  epoch: number | null
  deps?: CcrPipelineDeps
  now?: () => number
}): CcrPillsReading | null {
  const { enabled, tabId, epoch } = args
  const agentSessionId = args.agentSessionId ?? null
  const depsRef = useRef(args.deps)
  depsRef.current = args.deps
  const nowRef = useRef(args.now ?? Date.now)
  nowRef.current = args.now ?? Date.now
  useSyncExternalStore(subscribeCcrPills, ccrPillsVersion, ccrPillsVersion)
  const trigger = useSyncExternalStore(subscribeCcrTriggers, ccrTriggerVersion, ccrTriggerVersion)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!enabled || !tabId) {
      return
    }
    let active = true
    let waiting: ReturnType<typeof setTimeout> | null = null
    const run = async (attempt: number): Promise<void> => {
      if (!active) {
        return
      }
      if (!ccrSessionForTab(tabId, epoch, agentSessionId)) {
        const wait = WAITS_FOR_MATCH_MS[attempt]
        if (wait !== undefined) {
          waiting = setTimeout(() => void run(attempt + 1).catch(report), wait)
        }
        return
      }
      await refreshCcrPills(tabId, epoch, depsRef.current ?? (await loadDefaultCcrPipelineDeps()), agentSessionId)
      if (active) {
        setTick((tick) => tick + 1)
      }
    }
    // Why: the real deps load with import() and can reject (the secure store or the chunk fails);
    // an uncaught rejection would escape on every mount and tick with nothing naming the pills.
    const report = (error: unknown) => {
      console.warn(`[ccr-pills] could not run: ${error instanceof Error ? error.message : String(error)}`)
    }
    void run(0).catch(report)
    const timer = setInterval(() => void run(WAITS_FOR_MATCH_MS.length).catch(report), CCR_PILLS_REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
      if (waiting) {
        clearTimeout(waiting)
      }
    }
  }, [agentSessionId, enabled, epoch, tabId, trigger])

  if (!enabled || !tabId) {
    return null
  }
  const reading = ccrPillsForTab(tabId, epoch, nowRef.current())
  return reading && reading.sessionId === ccrSessionForTab(tabId, epoch, agentSessionId) ? reading : null
}
