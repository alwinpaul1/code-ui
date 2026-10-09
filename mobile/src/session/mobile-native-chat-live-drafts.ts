import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

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
 * message that never went (reported 2026-10-09, Claude Code 2.1.295). A write for a scope
 * goes to the screen showing that scope now, and only to the sender's own when none is.
 *
 * A stack per scope, newest last: the agent-history panel pushes a second session screen over
 * the first, so two screens can show one tab, and when the top one goes the one underneath
 * is on view again and takes the writes back (Opus review of 4103c597b).
 */
const liveDrafts = new Map<string, MobileNativeChatLiveDrafts[]>()

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

/** The newest draft store showing `draftKey`, or `own` when no screen shows it. */
export function liveNativeChatDrafts(
  draftKey: string | null,
  own: MobileNativeChatLiveDrafts
): MobileNativeChatLiveDrafts {
  return (draftKey === null ? undefined : liveDrafts.get(draftKey)?.at(-1)) ?? own
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
  useEffect(() => (draftKey ? registerLiveNativeChatDrafts(draftKey, own) : undefined), [draftKey, own])
  return own
}
