import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { hasImagePromptMarker } from '../../../src/shared/native-chat-image-transcript-markers'
import { isToolCallBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { isAgentImageShown, useAgentImagesShownVersion } from './agent-image-visibility'
import {
  ccrImagesVersion,
  ccrMayRun,
  ccrToolImage,
  ccrUserImages,
  runCcrImagePipeline,
  setCcrSelfTestContext,
  subscribeCcrImages,
  type CcrPipelineDeps,
  type CcrWanted
} from './ccr-session-pipeline'
import { hostImageMissing, subscribeHostImageMissing } from './host-image-refusals'
import { isImageFilePath } from './mobile-native-chat-agent-images'
import { toolCallKind } from './mobile-native-chat-tool-kind'
import { NO_CCR_IMAGES, type CcrRemoteImages } from './ccr-remote-images'

/**
 * The pictures of a Claude tab that only Anthropic's copy of the session
 * still has (ccr-session-pipeline.ts), for use-host-image-previews.ts to put
 * where the chips are:
 *  - a picture the agent Read, once its slot is on screen
 *    (agent-image-visibility.ts) and the desktop has answered that it will
 *    not send it (host-image-refusals.ts): the desktop stays the first
 *    source, and the API is asked only for what it could not give;
 *  - the pictures pasted into a user message on the desktop, drawn today as
 *    "Image on Desktop" chips, when the phone holds no preview of its own.
 *
 * The result is read from the pipeline's cache, so a picture the one-tap
 * check fetched shows here too.
 */

export { NO_CCR_IMAGES, type CcrRemoteImages } from './ccr-remote-images'

type ReadSlot = { toolUseId: string; path: string }

/** Every Read of an image file in the tab, by its `toolu_…` call id. */
export function ccrReadSlots(messages: readonly NativeChatMessage[]): ReadSlot[] {
  const slots: ReadSlot[] = []
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.blocks)) {
      continue
    }
    for (const block of message.blocks) {
      if (!isToolCallBlock(block) || !block.callId || toolCallKind(block.name) !== 'read') {
        continue
      }
      const input = block.input as { file_path?: unknown; path?: unknown } | null
      const path = typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : null
      if (path && isImageFilePath(path)) {
        slots.push({ toolUseId: block.callId, path })
      }
    }
  }
  return slots
}

/** User messages whose prompt marked pasted images the phone has no preview of. */
export function ccrPastedMessageIds(
  messages: readonly NativeChatMessage[],
  localPreviews: Record<string, string[]>
): string[] {
  return messages
    .filter((message) => message.role === 'user' && Array.isArray(message.blocks) && hasImagePromptMarker(message) && !localPreviews[message.id]?.length)
    .map((message) => message.id)
}

/** The real deps, loaded on first use (ccr-session-default-deps.ts). */
export async function loadDefaultCcrPipelineDeps(): Promise<CcrPipelineDeps> {
  return (await import('./ccr-session-default-deps')).defaultCcrPipelineDeps()
}

export function useCcrSessionImages(args: {
  enabled: boolean
  tabId: string | null
  messages: readonly NativeChatMessage[]
  localPreviews: Record<string, string[]>
  /** `useLastConnectedAt(hostId)`: a new connection re-matches the tab and retries. */
  epoch: number | null
  /** The Claude Code session the tab shows, when known: the match is the one made for it. */
  agentSessionId?: string | null
  /** The Claude config dir the session writes under: its account is asked first. */
  configDir?: string | null
  deps?: CcrPipelineDeps
}): CcrRemoteImages {
  const { enabled, tabId, messages, localPreviews, epoch } = args
  const depsRef = useRef(args.deps)
  depsRef.current = args.deps
  const shownVersion = useAgentImagesShownVersion()
  const missingVersion = useSyncExternalStore(subscribeHostImageMissing, () =>
    readSlotsKey(messages)
  )
  const cacheVersion = useSyncExternalStore(subscribeCcrImages, ccrImagesVersion, ccrImagesVersion)
  const reads = useMemo(() => ccrReadSlots(messages), [messages])
  const pasted = useMemo(() => ccrPastedMessageIds(messages, localPreviews), [localPreviews, messages])
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages])
  /** Ids looked for on a connection and not found there: not asked again until the next one. */
  const triedRef = useRef(new Map<string, number | null>())

  useEffect(() => {
    if (!enabled || !tabId) {
      return
    }
    setCcrSelfTestContext({
      tabId,
      epoch,
      agentSessionId: args.agentSessionId ?? null,
      configDir: args.configDir ?? null,
      messageIds,
      wanted: { toolUseIds: reads.map((slot) => slot.toolUseId), userMessageIds: pasted }
    })
  }, [args.agentSessionId, args.configDir, enabled, epoch, messageIds, pasted, reads, tabId])
  useEffect(
    () => () => {
      setCcrSelfTestContext(null)
    },
    []
  )

  useEffect(() => {
    if (!enabled || !tabId) {
      return
    }
    const tried = triedRef.current
    const fresh = (id: string) => tried.get(id) !== epoch || !tried.has(id)
    const wanted: CcrWanted = {
      toolUseIds: reads
        .filter((slot) => isAgentImageShown(slot.path) && hostImageMissing(slot.path) !== undefined)
        .map((slot) => slot.toolUseId)
        .filter((id) => !ccrToolImage(id) && fresh(id)),
      userMessageIds: pasted.filter((id) => !ccrUserImages(id) && fresh(id))
    }
    if (wanted.toolUseIds.length + wanted.userMessageIds.length === 0 || !ccrMayRun(tabId, epoch)) {
      return
    }
    for (const id of [...wanted.toolUseIds, ...wanted.userMessageIds]) {
      tried.set(id, epoch)
    }
    const injected = depsRef.current
    void (injected ? Promise.resolve(injected) : loadDefaultCcrPipelineDeps())
      .then((deps) => runCcrImagePipeline({ tabId, epoch, agentSessionId: args.agentSessionId ?? null, configDir: args.configDir ?? null, messageIds, wanted }, deps))
      .then((result) => {
        // A run that failed before it looked at any events may be asked again
        // once its back-off is over; a run that read the events has its answer.
        if (!result.stages.some((stage) => stage.stage === 'images')) {
          for (const id of [...wanted.toolUseIds, ...wanted.userMessageIds]) {
            tried.delete(id)
          }
        }
      })
      .catch((error: unknown) => {
        for (const id of [...wanted.toolUseIds, ...wanted.userMessageIds]) {
          tried.delete(id)
        }
        console.warn(`[ccr-images] could not start: ${error instanceof Error ? error.message : String(error)}`)
      })
  }, [enabled, epoch, messageIds, missingVersion, pasted, reads, shownVersion, tabId])

  return useMemo(() => {
    if (!enabled) {
      return NO_CCR_IMAGES
    }
    const byToolUseId: Record<string, string> = {}
    for (const slot of reads) {
      const uri = ccrToolImage(slot.toolUseId)
      if (uri) {
        byToolUseId[slot.toolUseId] = uri
      }
    }
    const byUserMessageId: Record<string, string[]> = {}
    for (const id of pasted) {
      const uris = ccrUserImages(id)
      if (uris) {
        byUserMessageId[id] = uris
      }
    }
    return Object.keys(byToolUseId).length + Object.keys(byUserMessageId).length === 0 ? NO_CCR_IMAGES : { byToolUseId, byUserMessageId }
    // cacheVersion: the cache is read above, outside React's view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, enabled, pasted, reads])
}

/** Changes when any of the tab's Read paths gets or loses a desktop refusal. */
function readSlotsKey(messages: readonly NativeChatMessage[]): string {
  return ccrReadSlots(messages)
    .map((slot) => hostImageMissing(slot.path) ?? '')
    .join('\n')
}
