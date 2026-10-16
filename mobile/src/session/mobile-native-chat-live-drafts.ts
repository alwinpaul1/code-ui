import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { appendReturnedDraftText } from '../../../src/shared/returned-draft-text'
import { appendNativeChatDraft, forgetNativeChatDraftReturns, nativeChatDraftEpoch } from '../storage/native-chat-drafts'
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

/** `own` while its screen is mounted, else the newest store showing `draftKey`; null when no
 *  mounted screen holds it. A write into `own` then is a write into React state that is gone:
 *  the caller must put it in the stored draft instead (a send that fails after the chat closed,
 *  2026-10-16). */
export function shownNativeChatDrafts(
  draftKey: string | null,
  own: MobileNativeChatLiveDrafts
): MobileNativeChatLiveDrafts | null {
  if (mountedDrafts.has(own)) {
    return own
  }
  return (draftKey === null ? undefined : liveDrafts.get(draftKey)?.at(-1)) ?? null
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

/**
 * A refused send's words back into `draftKey`'s draft, after what it holds; `retire` takes the
 * send's outbox entry out once they are on disk.
 *  - A screen shows the tab (shownNativeChatDrafts): it shows them at once, and the STORED draft
 *    gets them at once too, not on the screen's 250 ms debounce: retiring first and leaving them
 *    in React state lost them to an app killed inside that window (2026-10-17).
 *  - No screen shows it (the chat closed while the send was out, either lane): the stored draft,
 *    and every MOUNTED store that already holds the tab's draft (second review, 2026-10-17).
 * Either way the stored write is one step on the draft's write chain (appendNativeChatDraft), so
 * two of these, or the Anthropic queue's give-back, cannot drop each other, and a reopened tab's
 * hydration reads the result. `retire` waits for it, so a kill between the two leaves the words in
 * the draft AND the outbox (a resend at worst), never in neither; a write that fails keeps the
 * outbox entry and says so.
 */
export function returnRejectedDraftWords(draftKey: string, own: MobileNativeChatLiveDrafts, words: string, retire: () => void = () => undefined): void {
  if (!words.trim()) {
    retire()
    return
  }
  const shown = shownNativeChatDrafts(draftKey, own)
  const when = shown ? 'refused in the open chat' : 'that failed after the chat closed'
  void giveWordsToTabDraft(draftKey, (current) => appendReturnedDraftText(current, words), shown).then(
    () => {
      // Runs on the write chain now, not in the caller's stack: a retire that throws (an outbox
      // listener failing) was an unhandled rejection that named nothing (images-leave-composer-
      // when-send-lands.test.ts). The words are on disk; only the entry's removal failed.
      try {
        retire()
      } catch (error) {
        console.warn(`[native-chat-send] a send ${when} put its words back in its tab's draft, but its outbox entry could not be taken out (${error instanceof Error ? error.message : String(error)})`)
      }
      if (!shown) {
        console.warn("[native-chat-send] a send that failed after the chat closed put its words back in its tab's stored draft")
      }
    },
    (error: unknown) => console.warn(`[native-chat-send] a send ${when} could not put its words back in its tab's stored draft (${error instanceof Error ? error.message : String(error)}); they are kept in the outbox for the next launch`)
  )
}

/**
 * Words given back to a tab: `merge(current)` applied to the STORED draft as one step on its write
 * chain, then to `shown` (the screen showing the tab, if any) and to every other MOUNTED store that
 * already holds the tab's draft (a screen that showed it and shows another tab now never hydrates
 * it again, and its next save would write its old copy over them). The append comes first, so a
 * save or a hydration read from before it gets the words merged in (native-chat-drafts.ts). A
 * `shown` store whose draft is still unread gets what the stored draft holds once the words are
 * in it, never the words alone: that stopped its hydration and wrote over what the user had typed
 * (third review, 2026-10-17). `reapply` is `merge` for a save or read that may already hold the
 * words (appendNativeChatDraft). Resolves once the stored draft holds them.
 */
export function giveWordsToTabDraft(draftKey: string, merge: (current: string) => string, shown: MobileNativeChatLiveDrafts | null = null, reapply: (current: string) => string = merge): Promise<string> {
  const stored = appendNativeChatDraft(draftKey, merge, reapply)
  const epoch = nativeChatDraftEpoch()
  let held = false
  for (const store of new Set([...(shown ? [shown] : []), ...mountedDrafts])) {
    store.setDrafts((previous) => {
      const current = previous[draftKey]
      if (current === undefined) {
        noteSkippedReturn(store.setDrafts, draftKey, reapply)
        return previous
      }
      held = true
      const next = merge(current)
      return next === current ? previous : { ...previous, [draftKey]: next }
    })
  }
  return stored.then((written) => {
    shown?.setDrafts((previous) => {
      const current = previous[draftKey]
      const next = current === undefined ? written || undefined : takeSkippedReturns(shown.setDrafts, draftKey, current)
      return next === undefined || next === current ? previous : { ...previous, [draftKey]: next }
    })
    if (!held && !shown) {
      // No screen holds a copy to save over it: the record is only for reads still out.
      forgetNativeChatDraftReturns(draftKey, epoch)
    }
    return written
  })
}

/** Per store (its setDrafts), per tab: give-backs that skipped it because its draft was unread. */
const skippedReturns = new WeakMap<MobileNativeChatLiveDrafts['setDrafts'], Map<string, ((current: string) => string)[]>>()

function noteSkippedReturn(setDrafts: MobileNativeChatLiveDrafts['setDrafts'], draftKey: string, reapply: (current: string) => string): void {
  const byKey = skippedReturns.get(setDrafts) ?? new Map<string, ((current: string) => string)[]>()
  byKey.set(draftKey, [...(byKey.get(draftKey) ?? []), reapply])
  skippedReturns.set(setDrafts, byKey)
}

/**
 * `typed` with the give-backs that skipped this store's unread draft of `draftKey` applied, and
 * forgets them; `undefined` (the store is taking the stored draft, which holds them) only forgets.
 * Fifth review, 2026-10-17: a user who typed into a reopened chat before it took its draft won over
 * the stored copy, and with it the refused words that had skipped the screen; its save then wrote
 * what was typed over them. Only these, never every append since the read: one that reached the
 * store live is in `typed` already.
 */
export function takeSkippedReturns(setDrafts: MobileNativeChatLiveDrafts['setDrafts'], draftKey: string, typed: string | undefined): string | undefined {
  const byKey = skippedReturns.get(setDrafts)
  const skipped = byKey?.get(draftKey) ?? []
  // Forgotten a microtask later, not now: it is called from a state updater, and StrictMode calls
  // an updater twice in a row, so the second call must see the same give-backs as the first.
  if (byKey && skipped.length > 0) {
    queueMicrotask(() => {
      if (byKey.get(draftKey) === skipped) {
        byKey.delete(draftKey)
      }
    })
  }
  return typed === undefined ? undefined : skipped.reduce((draft, reapply) => reapply(draft), typed)
}
