import { useMemo } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  agentMessageRow,
  subagentNames,
  type BeaconAgentMessage
} from './mobile-native-chat-agent-messages'

/**
 * Where each subagent message the prompt hook carried is drawn: after the row
 * it came after, remembered for the session.
 *
 * The hook beacons the transcript row that was last when Claude took the
 * message (`at=`, a text row: tool rows never reach the phone). When the phone
 * holds that row the message goes after the row that shows it; tool calls
 * made after it fold into the same row, so the message sits after that step's
 * work. Until the row arrives, and when it never does, the message stays
 * where the chat's tail was when it was first seen; it never follows the tail
 * down, which is how a desktop prompt once ended up under its own reply
 * (use-desktop-prompt-echoes.ts, 2026-09-15). Kept outside the component for
 * the same reason as those anchors: the chat remounts on a tab switch.
 */
const anchorByKey = new Map<string, string>()
const provisionalByKey = new Map<string, string>()
const ANCHOR_CAP = 256

function remember(map: Map<string, string>, key: string, value: string): void {
  map.delete(key)
  map.set(key, value)
  for (const oldest of map.keys()) {
    if (map.size <= ANCHOR_CAP) {
      break
    }
    map.delete(oldest)
  }
}

export function resetAgentMessageAnchorsForTests(): void {
  anchorByKey.clear()
  provisionalByKey.clear()
}

/** The raw row a message is drawn after, or undefined while there is no row
 *  at all to anchor on (a beacon restored before the transcript loaded).
 *
 *  A message restored from the warm-start store (`restored`) has no anchor in
 *  memory, and the tail is the newest page, not where it came: taking it drew
 *  an hour-old message under the newest reply after every relaunch (review of
 *  2026-09-26). It is drawn after the row the hook named once that row is
 *  loaded, and held back until paging brings it in, the way a remembered echo
 *  is (mobile-native-chat-render-data.ts, 2026-09-13). One the hook named no
 *  row for (an older hook) has nowhere to go and stays held back. */
function rawAnchor(scope: string, message: BeaconAgentMessage, raw: readonly NativeChatMessage[]): string | undefined {
  const key = `${scope}\0${message.id}`
  const known = anchorByKey.get(key)
  if (known !== undefined) {
    return known
  }
  const tail = raw[raw.length - 1]
  if (message.anchorId && raw.some((row) => row.id === message.anchorId)) {
    provisionalByKey.delete(key)
    remember(anchorByKey, key, message.anchorId)
    return message.anchorId
  }
  if (!tail || message.restored) {
    return undefined
  }
  if (message.anchorId) {
    // Its row may still be on the way: hold the tail seen first, not the latest.
    const held = provisionalByKey.get(key) ?? tail.id
    remember(provisionalByKey, key, held)
    return held
  }
  remember(anchorByKey, key, tail.id)
  return tail.id
}

/** The folded row that shows a raw row: itself, or the row it folded into.
 *  Null when it is not in the loaded window, or folded into nothing held. */
function foldedHolder(
  rawId: string,
  raw: readonly NativeChatMessage[],
  foldedIds: ReadonlySet<string>
): string | null {
  let holder: string | null = null
  for (const row of raw) {
    if (foldedIds.has(row.id)) {
      holder = row.id
    }
    if (row.id === rawId) {
      return holder
    }
  }
  return null
}

/** The folded chat with each message drawn after its anchor. Same array when
 *  there is nothing to draw. */
export function withAgentMessageRows(
  folded: readonly NativeChatMessage[],
  raw: readonly NativeChatMessage[],
  messages: readonly BeaconAgentMessage[],
  scope: string
): NativeChatMessage[] {
  if (messages.length === 0) {
    return folded as NativeChatMessage[]
  }
  const names = subagentNames(raw)
  const foldedIds = new Set(folded.map((row) => row.id))
  const after = new Map<string, NativeChatMessage[]>()
  const atTop: NativeChatMessage[] = []
  for (const message of messages) {
    const anchor = rawAnchor(scope, message, raw)
    if (anchor === undefined) {
      continue
    }
    const holder = foldedHolder(anchor, raw, foldedIds)
    const held = holder === null ? undefined : folded.find((row) => row.id === holder)
    const row = agentMessageRow({
      id: message.id,
      sender: names.get(message.from) ?? message.from,
      // The hook cut the prompt mid-word; say the message goes on.
      body: message.cut && message.body && !message.body.endsWith('…') ? `${message.body}…` : message.body,
      timestamp: held?.timestamp ?? null
    })
    if (holder === null) {
      // Its row left the loaded window: it came before everything loaded.
      atTop.push(row)
    } else {
      after.set(holder, [...(after.get(holder) ?? []), row])
    }
  }
  if (after.size === 0 && atTop.length === 0) {
    return folded as NativeChatMessage[]
  }
  const out: NativeChatMessage[] = [...atTop]
  for (const row of folded) {
    out.push(row, ...(after.get(row.id) ?? []))
  }
  return out
}

/** The folded chat with the prompt hook's subagent messages drawn in. */
export function useAgentMessageRows(
  messages: readonly BeaconAgentMessage[],
  folded: readonly NativeChatMessage[],
  raw: readonly NativeChatMessage[],
  scope: string | null
): NativeChatMessage[] {
  return useMemo(
    () => (scope === null ? (folded as NativeChatMessage[]) : withAgentMessageRows(folded, raw, messages, scope)),
    [folded, messages, raw, scope]
  )
}
