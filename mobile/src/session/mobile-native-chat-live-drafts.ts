import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { dropMobileNativeChatPending, type MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

type PendingByKey = Record<string, MobileNativeChatPendingMessage[]>

/** One mounted chat screen's draft store: the composer text and the optimistic bubbles. */
export type MobileNativeChatLiveDrafts = {
  readonly setDrafts: Dispatch<SetStateAction<Record<string, string>>>
  readonly setPendingBySession: Dispatch<SetStateAction<PendingByKey>>
  readonly setPendingWaitingForSession: Dispatch<SetStateAction<PendingByKey>>
}

/**
 * The draft store mounted now for each composer scope.
 *
 * Why: a send outlives the chat screen it was tapped on. Its chips live in a store that
 * outlives the screen too (mobile-native-chat-image-attachments-store.ts), but its words and
 * its bubble lived only in the screen's React state. A send that was still out when the
 * screen remounted wrote its clear, its bubble and a refusal's undo into the old screen,
 * which was gone, so the new one drew the photos back with no words over a bubble for a
 * message that never went (reported 2026-10-09, Claude Code 2.1.295).
 *
 * So a send writes to the screen it was tapped on for as long as that screen is mounted,
 * whatever tab it shows now (its store keeps every tab's draft and bubbles). Only once it has
 * gone does a write follow the scope, to the newest screen showing it. A stack per scope: the
 * agent-history panel pushes a second session screen over the first, so two screens can show
 * one tab, and when the top one goes the one underneath takes the writes back. Routing to the
 * newest screen while the sender was still mounted sent a refusal's undo into a screen pushed
 * over it, and the sender kept a bubble and lost the words (reviews of 4103c597b, 2026-10-09).
 */
const liveDrafts = new Map<string, MobileNativeChatLiveDrafts[]>()
/** Every draft store whose screen is mounted now. */
const mountedDrafts = new Set<MobileNativeChatLiveDrafts>()

/** Test-only: the registry outlives a single test's hooks. */
export function resetLiveNativeChatDraftsForTests(): void {
  liveDrafts.clear()
  mountedDrafts.clear()
}

/** Marks `drafts` as a mounted screen's store; the returned call marks it gone. */
export function markNativeChatDraftsMounted(drafts: MobileNativeChatLiveDrafts): () => void {
  mountedDrafts.add(drafts)
  return () => {
    mountedDrafts.delete(drafts)
  }
}

/** Registers `drafts` as the newest screen showing `draftKey`; the returned call takes that
 *  one registration out, wherever it now sits in the stack. */
export function registerLiveNativeChatDrafts(
  draftKey: string,
  drafts: MobileNativeChatLiveDrafts
): () => void {
  liveDrafts.set(draftKey, [...(liveDrafts.get(draftKey) ?? []), drafts])
  return () => {
    const rest = (liveDrafts.get(draftKey) ?? []).filter((entry) => entry !== drafts)
    if (rest.length > 0) {
      liveDrafts.set(draftKey, rest)
    } else {
      liveDrafts.delete(draftKey)
    }
  }
}

/** `own` while its screen is mounted; once it has gone, the newest store showing `draftKey`,
 *  or `own` still when no screen shows it. */
export function liveNativeChatDrafts(
  draftKey: string | null,
  own: MobileNativeChatLiveDrafts
): MobileNativeChatLiveDrafts {
  if (mountedDrafts.has(own) || draftKey === null) {
    return own
  }
  return liveDrafts.get(draftKey)?.at(-1) ?? own
}

/** Drops bubble `id` from `own` and every registered store: wherever it landed, a retraction
 *  takes it out (a no-op in a store without it). */
export function dropNativeChatPendingEverywhere(own: MobileNativeChatLiveDrafts, id: string): void {
  for (const store of new Set([own, ...[...liveDrafts.values()].flat()])) {
    store.setPendingBySession((previous) => dropMobileNativeChatPending(previous, id))
    store.setPendingWaitingForSession((previous) => dropMobileNativeChatPending(previous, id))
  }
}

/** A chat screen's own draft store, registered as the one showing `draftKey` while it is. */
export function useLiveNativeChatDrafts(
  draftKey: string | null,
  setDrafts: MobileNativeChatLiveDrafts['setDrafts'],
  setPendingBySession: MobileNativeChatLiveDrafts['setPendingBySession'],
  setPendingWaitingForSession: MobileNativeChatLiveDrafts['setPendingWaitingForSession']
): MobileNativeChatLiveDrafts {
  const own = useMemo(
    () => ({ setDrafts, setPendingBySession, setPendingWaitingForSession }),
    [setDrafts, setPendingBySession, setPendingWaitingForSession]
  )
  useEffect(() => markNativeChatDraftsMounted(own), [own])
  useEffect(() => (draftKey ? registerLiveNativeChatDrafts(draftKey, own) : undefined), [draftKey, own])
  return own
}
