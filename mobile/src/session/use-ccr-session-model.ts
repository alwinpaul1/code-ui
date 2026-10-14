import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ccrModelForTab, ccrModelVersion, CCR_MODEL_REFRESH_MS, subscribeCcrModel, type CcrModelReading } from './ccr-session-model'
import { ccrMayRun, ccrSessionForTab, refreshCcrModel, runCcrImagePipeline, type CcrPipelineDeps } from './ccr-session-pipeline'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

/**
 * The model and effort the tab's session last reported to Anthropic, while
 * fresh (ccr-session-model.ts), for the composer pill.
 *
 * Matches the tab once per relay connection (the same match the pictures
 * use, with nothing to fetch), then re-reads the session's row every
 * CCR_MODEL_REFRESH_MS while the chat is shown. Off, or not signed in, it
 * returns null and the pill keeps today's sources.
 */
export function useCcrSessionModel(args: {
  enabled: boolean
  tabId: string | null
  messages: readonly NativeChatMessage[]
  epoch: number | null
  deps?: CcrPipelineDeps
  /** For tests: the clock the freshness is read against. */
  now?: () => number
}): CcrModelReading | null {
  const { enabled, tabId, messages, epoch } = args
  const depsRef = useRef(args.deps)
  depsRef.current = args.deps
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const nowRef = useRef(args.now ?? Date.now)
  nowRef.current = args.now ?? Date.now
  useSyncExternalStore(subscribeCcrModel, ccrModelVersion, ccrModelVersion)
  const [, setTick] = useState(0)
  const hasMessages = messages.length > 0

  useEffect(() => {
    if (!enabled || !tabId || !hasMessages) {
      return
    }
    let active = true
    const deps = async () => depsRef.current ?? (await loadDefaultCcrPipelineDeps())
    const step = async () => {
      if (ccrSessionForTab(tabId, epoch)) {
        await refreshCcrModel(tabId, epoch, await deps())
      } else if (ccrMayRun(tabId, epoch)) {
        await runCcrImagePipeline(
          { tabId, epoch, messageIds: messagesRef.current.map((message) => message.id), wanted: { toolUseIds: [], userMessageIds: [] } },
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
    void run()
    const timer = setInterval(() => void run(), CCR_MODEL_REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [enabled, epoch, hasMessages, tabId])

  return enabled && tabId ? ccrModelForTab(tabId, epoch, nowRef.current()) : null
}
