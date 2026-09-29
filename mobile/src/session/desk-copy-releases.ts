import { useEffect, useRef, useState } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import type { DesktopPrompt } from './agent-hud-beacon'
import { STATUS_PROMPT_NONCE_PREFIX } from './agent-status-prompts'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { deskEchoId, withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'
import { QUEUE_SIGHTING_GRACE_MS } from './use-queued-own-sends'
import { DEQUEUED_ROW_LEADS_MS, DEQUEUED_ROW_TRAILS_MS } from './mobile-native-chat-pending-retirement'

/**
 * When the agent took each desk message the chat watched arrive on the tab
 * status: when its queue box let it go, by the phone's clock (as for the
 * phone's own taken sends), or, for one the box never listed within
 * QUEUE_SIGHTING_GRACE_MS of the chat reading it, its own stamp (`at`, the
 * desktop's clock): Claude took it at once, or it started a turn. Keyed by
 * the status copy's nonce. A copy the chat found (`atStateStart`), held back, or read
 * off the beacon is not here: the chat did not watch it arrive.
 *
 * Why: a row of a mid-turn message's words retired it wherever it was
 * stamped, so the same words typed at the desk as the next turn's prompt
 * retired the first turn's bubble, and one bubble stood for two messages
 * (gap D of the final review of fix/midturn-prompt-at-end, 2026-09-29).
 * Claude writes a row for a queued message only as it dequeues it at a
 * turn's end, and only a row stamped then is its own (withoutLandedDeskCopies),
 * the rule the phone's own taken sends already follow (dequeuedRowLanded).
 *
 * A message listed again after the box let it go (a relay drop hands the chat
 * an empty box) is taken again when the box lets it go again.
 */
export function useDeskCopyReleases(
  prompts: readonly DesktopPrompt[],
  queued: readonly string[],
  /** Marks a stored witness of a released copy taken at that time, so its
   *  retirement follows the same rule after a remount. */
  takeWitnesses: ((ids: readonly string[], at: number) => void) | undefined,
  /** The ids the pending store holds. */
  storedIds: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const states = useRef(new Map<string, { listed: boolean; releasedAt?: number }>())
  const [releases, setReleases] = useState<ReadonlyMap<string, number>>(NO_RELEASES)
  useEffect(() => {
    const evaluate = () => {
      const next = releasesAt(states.current, prompts, queued, Date.now())
      setReleases((previous) => (sameReleases(previous, next) ? previous : next))
    }
    evaluate()
    // A copy the box has not listed is taken at once once the chat has waited
    // QUEUE_SIGHTING_GRACE_MS for the box: evaluated then, without waiting for
    // something else to render the chat.
    const now = Date.now()
    const timers = prompts.flatMap((prompt) =>
      watched(prompt) && !states.current.get(prompt.nonce)?.listed && !states.current.get(prompt.nonce)?.releasedAt
        ? [setTimeout(evaluate, Math.max(0, prompt.seenAt + QUEUE_SIGHTING_GRACE_MS - now))]
        : []
    )
    return () => {
      for (const timer of timers) {
        clearTimeout(timer)
      }
    }
  }, [prompts, queued])
  const toTake = [...releases].filter(([nonce]) => storedIds.has(deskEchoId(nonce)))
  const signature = JSON.stringify(toTake)
  useEffect(() => {
    for (const [nonce, at] of JSON.parse(signature) as [string, number][]) {
      takeWitnesses?.([deskEchoId(nonce)], at)
    }
  }, [signature, takeWitnesses])
  return releases
}

const NO_RELEASES: ReadonlyMap<string, number> = new Map()

/** Move each watched copy's state on by what the box lists now, and return
 *  the release times known. */
function releasesAt(
  states: Map<string, { listed: boolean; releasedAt?: number }>,
  prompts: readonly DesktopPrompt[],
  queued: readonly string[],
  now: number
): ReadonlyMap<string, number> {
  const rows = queued.map(boxKey)
  const releases = new Map<string, number>()
  const live = new Set<string>()
  for (const prompt of prompts) {
    if (!watched(prompt)) {
      continue
    }
    live.add(prompt.nonce)
    const state = states.get(prompt.nonce) ?? { listed: false }
    if (rows.some((row) => listsCopy(row, prompt))) {
      state.listed = true
      state.releasedAt = undefined
    } else if (state.releasedAt === undefined) {
      if (state.listed) {
        state.releasedAt = now
      } else if (now - prompt.seenAt >= QUEUE_SIGHTING_GRACE_MS) {
        // Never listed: taken at once, or it started a turn. Its own stamp is
        // the desktop's clock, the one its row is stamped by, which the
        // phone's reading time is not.
        state.releasedAt = prompt.at
      }
    }
    states.set(prompt.nonce, state)
    if (state.releasedAt !== undefined) {
      releases.set(prompt.nonce, state.releasedAt)
    }
  }
  for (const nonce of states.keys()) {
    if (!live.has(nonce)) {
      states.delete(nonce)
    }
  }
  return releases
}

function sameReleases(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...a].every(([nonce, at]) => b.get(nonce) === at)
}

/** The ids of the chat's pending list, for useDeskCopyReleases. */
export function pendingIds(pending: readonly { id: string }[]): ReadonlySet<string> {
  return new Set(pending.map((item) => item.id))
}

/**
 * withoutLandedDesktopPrompts, but a desk copy the agent took at a known time
 * (useDeskCopyReleases) lands only on a row of its words stamped as the box
 * let it go: up to DEQUEUED_ROW_LEADS_MS before that and
 * DEQUEUED_ROW_TRAILS_MS after, as for the phone's own taken sends. A row of
 * its words from any other time is another message. The rest land on any row
 * of their words, as before.
 */
export function withoutLandedDeskCopies(
  prompts: readonly DesktopPrompt[],
  releases: ReadonlyMap<string, number>,
  folded: readonly NativeChatMessage[],
  queued: readonly string[],
  raw: readonly NativeChatMessage[]
): DesktopPrompt[] {
  if (!prompts.some((prompt) => releases.has(prompt.nonce))) {
    return withoutLandedDesktopPrompts(prompts, folded, queued, raw)
  }
  const unknown = new Set(
    withoutLandedDesktopPrompts(
      prompts.filter((prompt) => !releases.has(prompt.nonce)),
      folded,
      queued,
      raw
    )
  )
  return prompts.filter((prompt) => {
    const releasedAt = releases.get(prompt.nonce)
    if (releasedAt === undefined) {
      return unknown.has(prompt)
    }
    const stampedThen = (message: NativeChatMessage) =>
      message.timestamp !== null &&
      message.timestamp >= releasedAt - DEQUEUED_ROW_LEADS_MS &&
      message.timestamp <= releasedAt + DEQUEUED_ROW_TRAILS_MS
    return withoutLandedDesktopPrompts([prompt], folded.filter(stampedThen), [], raw.filter(stampedThen)).length > 0
  })
}

/** A status copy the chat watched arrive: timed by its own stamp and read. */
function watched(prompt: DesktopPrompt): prompt is DesktopPrompt & { seenAt: number; at: number } {
  return (
    prompt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX) &&
    prompt.heldBack !== true &&
    prompt.atStateStart !== true &&
    prompt.at !== undefined &&
    typeof prompt.seenAt === 'number'
  )
}

/** Whether a queue box row is this copy's message: the same words, or the
 *  box's `…` stub of them, or the start of the words a copy the status cut
 *  runs on past. */
function listsCopy(row: string, prompt: DesktopPrompt): boolean {
  const key = boxKey(prompt.text)
  if (row === key) {
    return true
  }
  const stub = row.endsWith('…') ? row.slice(0, -1).trimEnd() : null
  return (stub !== null && stub.length > 0 && key.startsWith(stub)) || (prompt.cut === true && row.startsWith(key))
}

function boxKey(text: string): string {
  return normalizeNativeChatUserText(asPaintedPrompt(text))
}
