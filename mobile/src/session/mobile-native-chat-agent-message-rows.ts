import { useEffect, useMemo } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { pendingPlacementAnchorId } from './mobile-native-chat-render-data'
import { rememberAgentMessagePlacement } from './agent-hud-beacon'
import {
  agentMessageRow,
  subagentNames,
  type BeaconAgentMessage,
  type SameRowPrompt
} from './mobile-native-chat-agent-messages'
import { deskEchoId } from './use-desktop-prompt-echoes'

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
 *  is (mobile-native-chat-render-data.ts, 2026-09-13). The row it was drawn
 *  after before it was stored (`drawnAfter`) stands in when the named row is
 *  not held: the hook can name a row Orca never publishes (another agent's
 *  delivery, an `isMeta` row), and such a message, drawn at the tail live,
 *  vanished after a relaunch (review of 2026-09-27). With neither loaded it
 *  stays held back. */
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
  if (message.restored && message.drawnAfter && raw.some((row) => row.id === message.drawnAfter)) {
    remember(anchorByKey, key, message.drawnAfter)
    return message.drawnAfter
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
      cut: message.cut,
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

/**
 * The pending bubbles, each prompt the hook took after a subagent message at
 * the same row drawn below that message's row. A pending bubble is drawn
 * straight after the row it anchors on, which put a desk prompt typed after
 * the message above it (review of 2026-09-26). By the prompt's text: the
 * pending copy may be the tab status's rather than the beacon's, and a phone
 * send's hook copy reads the same. Same array when nothing moves.
 */
export function drawnAfterEarlierAgentMessages<T extends MobileNativeChatPendingMessage>(
  pending: readonly T[],
  messages: readonly BeaconAgentMessage[],
  folded: readonly NativeChatMessage[],
  raw: readonly NativeChatMessage[] = folded
): T[] {
  if (!messages.some((message) => message.laterAtSameRow)) {
    return pending as T[]
  }
  const position = new Map(folded.map((row, index) => [row.id, index]))
  const foldedIds = new Set(position.keys())
  // Compared by the row each is drawn after, not by the raw id each names: a
  // tab status copy of the prompt is placed by the last row written before it
  // (lastRowBefore), often a tool row the named row's step folded in, and on
  // any host that publishes a status that copy is the one drawn (review of
  // 2026-09-27: the order came out reversed there).
  const holderOf = (id: string | null | undefined) =>
    !id ? null : foldedIds.has(id) ? id : foldedHolder(id, raw, foldedIds)
  let moved = false
  const out = pending.map((item) => {
    const row = holderOf(pendingPlacementAnchorId(item))
    let after: string | undefined
    for (const message of messages) {
      const at = position.get(message.id)
      if (
        at !== undefined &&
        row !== null &&
        (after === undefined || at > position.get(after)!) &&
        holderOf(message.anchorId) === row &&
        cameAfter(message, item)
      ) {
        after = message.id
      }
    }
    if (after === undefined) {
      return item
    }
    moved = true
    return { ...item, drawAfterId: after }
  })
  return moved ? out : (pending as T[])
}

/** Where each message is drawn now, by the row it follows, when that is not
 *  the row it was stored with. */
export function agentMessagePlacements(
  scope: string,
  messages: readonly BeaconAgentMessage[]
): { nonce: string; rowId: string }[] {
  return messages.flatMap((message) => {
    const key = `${scope}\0${message.id}`
    const rowId = anchorByKey.get(key) ?? provisionalByKey.get(key)
    const nonce = message.id.slice(message.id.indexOf(':') + 1)
    return rowId !== undefined && rowId !== message.drawnAfter ? [{ nonce, rowId }] : []
  })
}

/**
 * Whether a pending bubble is a prompt the hook took after this message. The
 * beacon's own copy says so by its nonce (`desk-<nonce>`). Another copy, the
 * tab status's or a phone send, only by its text, and only when no prompt of
 * that text came before the message at the same row: matched by text alone,
 * an "ok" typed before the message moved below it with the one typed after
 * (review of 2026-09-27).
 */
function cameAfter(message: BeaconAgentMessage, item: { id: string; text: string }): boolean {
  const later = message.laterAtSameRow ?? []
  const earlier = message.earlierAtSameRow ?? []
  const byNonce = (prompts: readonly SameRowPrompt[]) => prompts.some((prompt) => deskEchoId(prompt.nonce) === item.id)
  if (byNonce(later)) {
    return true
  }
  if (byNonce(earlier)) {
    return false
  }
  return later.some((prompt) => prompt.text === item.text) && !earlier.some((prompt) => prompt.text === item.text)
}

/** The folded chat with the prompt hook's subagent messages drawn in. Where
 *  each was drawn is stored with the beacon (rememberAgentMessagePlacement). */
export function useAgentMessageRows(
  messages: readonly BeaconAgentMessage[],
  folded: readonly NativeChatMessage[],
  raw: readonly NativeChatMessage[],
  scope: string | null
): NativeChatMessage[] {
  const rows = useMemo(
    () => (scope === null ? (folded as NativeChatMessage[]) : withAgentMessageRows(folded, raw, messages, scope)),
    [folded, messages, raw, scope]
  )
  useEffect(() => {
    if (scope !== null) {
      for (const { nonce, rowId } of agentMessagePlacements(scope, messages)) {
        rememberAgentMessagePlacement(nonce, rowId)
      }
    }
  }, [messages, rows, scope])
  return rows
}
