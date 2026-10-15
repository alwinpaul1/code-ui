import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ccrModelForTab, ccrModelVersion, CCR_MODEL_REFRESH_MS, subscribeCcrModel, type CcrModelReading } from './ccr-session-model'
import { ccrMayRun, ccrSessionForTab, ccrTriggerVersion, clearCcrFailure, refreshCcrModel, runCcrImagePipeline, subscribeCcrTriggers, type CcrPipelineDeps } from './ccr-session-pipeline'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

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
export function useCcrSessionModel(args: {
  enabled: boolean
  tabId: string | null
  /** The Claude Code session the tab shows, when known (the hook's `session_id`). */
  agentSessionId?: string | null
  messages: readonly NativeChatMessage[]
  epoch: number | null
  deps?: CcrPipelineDeps
  /** For tests: the clock the freshness is read against. */
  now?: () => number
}): CcrModelReading | null {
  const { enabled, tabId, messages, epoch } = args
  const agentSessionId = args.agentSessionId ?? null
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
          { tabId, epoch, agentSessionId, messageIds: messagesRef.current.map((message) => message.id), wanted: { toolUseIds: [], userMessageIds: [] } },
          await deps()
        )
      }
      if (active) {
        setTick((tick) => tick + 1)
      }
    }
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
    }
  }, [agentSessionId, enabled, epoch, hasMessages, tabId, trigger])

  if (!enabled || !tabId) {
    return null
  }
  const reading = ccrModelForTab(tabId, epoch, nowRef.current())
  // A reading of the session the tab showed before (a /clear, another --resume) is not this one's.
  return reading && reading.sessionId === ccrSessionForTab(tabId, epoch, agentSessionId) ? reading : null
}
