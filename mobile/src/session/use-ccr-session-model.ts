import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ccrModelForTab, ccrModelVersion, CCR_MODEL_REFRESH_MS, subscribeCcrModel, type CcrModelReading } from './ccr-session-model'
import { CCR_QUICK_RETRY_MS, ccrMayRun, ccrRetryAt, ccrSessionForTab, ccrTriggerVersion, clearCcrFailure, refreshCcrModel, runCcrImagePipeline, subscribeCcrTriggers, type CcrPipelineDeps } from './ccr-session-pipeline'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'
import { newestTranscriptMessageAt } from './ccr-session-match'
import { refreshCcrUsage } from './ccr-session-usage'

/**
 * The model and effort the tab's session last reported to Anthropic, while
 * fresh (ccr-session-model.ts), for the composer pill.
 *
 * Matches the tab once per relay connection (the same match the pictures
 * use, with nothing to fetch), then re-reads the session's row every
 * CCR_MODEL_REFRESH_MS while the chat is shown. Off, or not signed in, it
 * returns null and the pill keeps today's sources.
 *
 * One attempt at once, whatever back-off is on record, on each of: the tab
 * opened (or the app started on it), a new relay connection, a new Claude
 * session in the tab (`agentSessionId`), a sign-in or sign-out, and the app
 * back in the foreground (ccr-session-cache.ts, triggers). The back-off only
 * spaces the timed retries of a tab left open. Keyed on those events, never
 * on a render ("it must match the session when i open asap", 2026-10-15).
 */
const QUICK_RETRY_LONGEST_MS = Math.max(...CCR_QUICK_RETRY_MS)

export function useCcrSessionModel(args: {
  enabled: boolean
  tabId: string | null
  /** The Claude Code session the tab shows, when known (the hook's `session_id`). */
  agentSessionId?: string | null
  /** The Claude config dir the session writes under, from its transcript path. */
  configDir?: string | null
  messages: readonly NativeChatMessage[]
  epoch: number | null
  /** False while a live beacon or screen already states this session's context: the events read
   *  for it (ccr-session-usage.ts) is then skipped. The plan usage is read either way. */
  needsContext?: boolean
  deps?: CcrPipelineDeps
  /** For tests: the clock the freshness is read against. */
  now?: () => number
}): CcrModelReading | null {
  const { enabled, tabId, messages, epoch } = args
  const agentSessionId = args.agentSessionId ?? null
  const configDir = args.configDir ?? null
  const needsContextRef = useRef(args.needsContext ?? true)
  needsContextRef.current = args.needsContext ?? true
  const depsRef = useRef(args.deps)
  depsRef.current = args.deps
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const nowRef = useRef(args.now ?? Date.now)
  nowRef.current = args.now ?? Date.now
  useSyncExternalStore(subscribeCcrModel, ccrModelVersion, ccrModelVersion)
  const trigger = useSyncExternalStore(subscribeCcrTriggers, ccrTriggerVersion, ccrTriggerVersion)
  const [, setTick] = useState(0)
  const hasMessages = messages.length > 0

  useEffect(() => {
    if (!enabled || !tabId || !hasMessages) {
      return
    }
    let active = true
    const deps = async () => depsRef.current ?? (await loadDefaultCcrPipelineDeps())
    const step = async () => {
      if (ccrSessionForTab(tabId, epoch, agentSessionId)) {
        await refreshCcrModel(tabId, epoch, await deps(), agentSessionId)
      } else if (ccrMayRun(tabId, epoch)) {
        await runCcrImagePipeline(
          { tabId, epoch, agentSessionId, configDir, messageIds: messagesRef.current.map((message) => message.id), newestMessageAt: newestTranscriptMessageAt(messagesRef.current), wanted: { toolUseIds: [], userMessageIds: [] } },
          await deps()
        )
      }
      // The matched account's plan usage and this session's context, for the ring (ccr-session-usage.ts).
      // An unmatched tab is read through its config dir's account (ccr-session-usage.ts).
      await refreshCcrUsage(tabId, epoch, await deps(), agentSessionId, needsContextRef.current, configDir)
      if (active) {
        setTick((tick) => tick + 1)
        // Not found yet: a session just started may be listed a moment later, so the quick
        // retries (0.5, 1, 2, 4 s) are timed here rather than left to the minute's tick.
        const retryAt = ccrSessionForTab(tabId, epoch, agentSessionId) ? null : ccrRetryAt(tabId, epoch)
        const wait = retryAt === null ? null : retryAt - Date.now()
        if (wait !== null && wait <= QUICK_RETRY_LONGEST_MS) {
          quickRetry = setTimeout(() => void run(), Math.max(0, wait))
        }
      }
    }
    let quickRetry: ReturnType<typeof setTimeout> | null = null
    // Why: the real deps load with import() and can reject (the secure store or the chunk fails,
    // or, under Node, react-native under expo-modules-core). Uncaught, that rejection escaped on
    // every mount and every tick with nothing naming the pill; the pill keeps today's sources.
    const run = () =>
      step().catch((error: unknown) => {
        console.warn(`[ccr-model] could not run: ${error instanceof Error ? error.message : String(error)}`)
      })
    // This run is an event's (see above): a back-off recorded before it does not hold it.
    clearCcrFailure(tabId)
    void run()
    const timer = setInterval(() => void run(), CCR_MODEL_REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
      if (quickRetry) {
        clearTimeout(quickRetry)
      }
    }
  }, [agentSessionId, configDir, enabled, epoch, hasMessages, tabId, trigger])

  if (!enabled || !tabId) {
    return null
  }
  const reading = ccrModelForTab(tabId, epoch, nowRef.current())
  // A reading of the session the tab showed before (a /clear, another --resume) is not this one's.
  return reading && reading.sessionId === ccrSessionForTab(tabId, epoch, agentSessionId) ? reading : null
}
