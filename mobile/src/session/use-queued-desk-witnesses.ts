import { useEffect, useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import { echoMemoryId } from './mobile-native-chat-remember-echo'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { witnessesToRemember, type WitnessToRemember } from './mobile-native-chat-witness-memory'

/** Sightings remembered at once, per chat scope. */
const SIGHTING_CAP = 64

/**
 * The messages the agent's queue box lists that are not the phone's own
 * sends, each with where it arrived: the raw row that was last when the chat
 * first saw it in the box, the place the queue-box witness draws a message
 * the agent takes (use-absorbed-queue-echoes.ts). The chat remembers them
 * while they sit in the box, held there while a row of exactly their words
 * is listed (useQueuedOwnSends), so one the agent takes while the chat is
 * closed is still drawn where it arrived when the chat comes back. Before, a message drawn only in the box was remembered
 * nowhere, and after the chat came back its status copy, found and timed by
 * its run's start, was on a page not loaded: the message was lost (final
 * review of fix/midturn-prompt-at-end, 2026-09-29).
 *
 * `entries` is the box as the chat draws it (useQueuedOwnSends): a row the
 * phone's own send stands in is not a string and is left out. A row that
 * carries a tool's rows (`⏺`, `●`, `⎿`) is the reader running into the
 * transcript and is left out too (mobile-native-chat-witness-dedupe.ts). A
 * message already in the box when the chat opened is placed where the chat
 * first saw it, which can be below rows written after it was sent.
 */
export function useQueuedDeskWitnesses(
  entries: readonly MobileChatQueueEntry[],
  rawMessages: readonly NativeChatMessage[],
  scopeKey: string
): WitnessToRemember[] {
  const sightings = useRef({ scope: scopeKey, byKey: new Map<string, string>() })
  if (sightings.current.scope !== scopeKey) {
    sightings.current = { scope: scopeKey, byKey: new Map() }
  }
  const tail = rawMessages.at(-1)?.id
  const out: WitnessToRemember[] = []
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.split('\n').some((line) => /^[⏺●⎿]/.test(line.trim()))) {
      continue
    }
    const key = normalizeNativeChatUserText(asPaintedPrompt(entry))
    if (key.length === 0) {
      continue
    }
    const byKey = sightings.current.byKey
    if (!byKey.has(key) && tail !== undefined) {
      byKey.set(key, tail)
      if (byKey.size > SIGHTING_CAP) {
        const oldest = byKey.keys().next()
        if (!oldest.done) {
          byKey.delete(oldest.value)
        }
      }
    }
    const anchorId = byKey.get(key)
    if (anchorId !== undefined) {
      out.push({ id: echoMemoryId(entry), text: entry, anchorId })
    }
  }
  return out
}

/**
 * Keep what the chat witnessed with the phone's own sends, so it survives a
 * reconnect, a tab switch and a relaunch (2026-09-13): the echoes it drew
 * (witnessesToRemember says which, and under what id), and the messages the
 * agent's queue box lists (useQueuedDeskWitnesses).
 */
export function useRememberedWitnesses(
  echoes: readonly MobileNativeChatPendingMessage[],
  queued: readonly WitnessToRemember[],
  rememberEcho: ((id: string, text: string, anchorId: string | null) => void) | undefined
): void {
  const drawn = JSON.stringify(witnessesToRemember(echoes))
  const listed = JSON.stringify(queued)
  useEffect(() => {
    for (const witness of JSON.parse(drawn) as WitnessToRemember[]) {
      rememberEcho?.(witness.id, witness.text, witness.anchorId)
    }
    for (const witness of JSON.parse(listed) as WitnessToRemember[]) {
      rememberEcho?.(witness.id, witness.text, witness.anchorId)
    }
  }, [drawn, listed, rememberEcho])
}
