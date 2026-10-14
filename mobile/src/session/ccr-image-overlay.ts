import { normalizeImageTranscriptMessages } from '../../../src/shared/native-chat-image-transcript-markers'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { CcrRemoteImages } from './ccr-remote-images'
import { agentImageCallIds, agentImagePaths } from './mobile-native-chat-agent-images'
import { foldQueuedImageTurns } from './mobile-native-chat-queued-image-fold'

/**
 * Where pictures from Anthropic's copy of the session go in the chat's
 * preview map (use-host-image-previews.ts): the desktop's picture first, and
 * Anthropic's only where the desktop left a slot empty.
 */

/** The Read call id behind each path `collectHostImagePaths` holds for an
 *  agent's record, in the same order (undefined for a picture SendUserFile
 *  sent), from the same fold. */
export function collectHostImageCallIds(messages: readonly NativeChatMessage[]): Record<string, (string | undefined)[]> {
  const ids: Record<string, (string | undefined)[]> = {}
  for (const message of normalizeImageTranscriptMessages(foldQueuedImageTurns([...messages]))) {
    if (agentImagePaths(message).length > 0) {
      ids[message.id] = agentImageCallIds(message)
    }
  }
  return ids
}

/**
 * `previews` with Anthropic's pictures laid in:
 *  - an agent record's empty slot gets the picture of the Read at that place;
 *  - a user message's pasted pictures ("Image on Desktop" chips, filled in
 *    order by the view, buildMobileNativeChatTransientData) when neither the
 *    phone's own preview nor the desktop's is there.
 */
export function applyCcrImages(
  previews: Record<string, string[]>,
  args: {
    remote: CcrRemoteImages
    /** The raw rows the paths were collected from (for each slot's Read call id). */
    messages: readonly NativeChatMessage[]
    agentIds: ReadonlySet<string>
    localPreviews: Record<string, string[]>
  }
): Record<string, string[]> {
  const { remote, messages, agentIds, localPreviews } = args
  let callIds: Record<string, (string | undefined)[]> | null = null
  for (const [messageId, uris] of Object.entries(previews)) {
    if (Object.keys(remote.byToolUseId).length === 0 || !agentIds.has(messageId) || uris.every((uri) => uri.length > 0)) {
      continue
    }
    callIds ??= collectHostImageCallIds(messages.filter((message) => Array.isArray(message.blocks)))
    previews[messageId] = uris.map((uri, index) => {
      const callId = callIds?.[messageId]?.[index]
      return uri || (callId && remote.byToolUseId[callId]) || ''
    })
  }
  for (const [messageId, uris] of Object.entries(remote.byUserMessageId)) {
    if (localPreviews[messageId]?.length || previews[messageId]?.some((uri) => uri.length > 0)) {
      continue
    }
    previews[messageId] = uris
  }
  return previews
}
