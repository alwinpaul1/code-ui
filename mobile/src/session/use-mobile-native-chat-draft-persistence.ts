import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { useDebouncedPersist } from './use-debounced-persist'
import { takeSkippedReturns } from './mobile-native-chat-live-drafts'
import { nativeChatDraftEpoch, openNativeChatDraftRead, writeNativeChatDraft, type NativeChatDraftRead } from '../storage/native-chat-drafts'

const DRAFT_WRITE_DEBOUNCE_MS = 250

/**
 * Keeps a scope's unsent composer text on disk: hydrates it the first time the
 * scope is shown and mirrors edits back with a trailing debounce, so opening
 * another project and coming back finds the text still there.
 */
export function useMobileNativeChatDraftPersistence(
  draftKey: string | null,
  drafts: Record<string, string>,
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
): void {
  const known = draftKey ? drafts[draftKey] !== undefined : true
  useEffect(() => {
    if (!draftKey || known) {
      return
    }
    let cancelled = false
    let open: NativeChatDraftRead | null = null
    void openNativeChatDraftRead(draftKey).then((read) => {
      open = read
      if (cancelled) {
        read.close()
        return
      }
      // A key the user typed into meanwhile wins over the stored copy. The copy is worked out as
      // the screen takes it, with every append made since the read began (fourth review,
      // 2026-10-17): a refused send's words that skipped this still-unread screen are in it.
      // Typed into first, it gets the refused words that skipped it while unread (takeSkippedReturns).
      setDrafts((previous) => {
        const typed = previous[draftKey]
        const next = typed === undefined ? read.current() : takeSkippedReturns(setDrafts, draftKey, typed)
        if (typed === undefined) {
          takeSkippedReturns(setDrafts, draftKey, undefined)
        }
        read.close()
        return next && next !== typed ? { ...previous, [draftKey]: next } : previous
      })
    })
    return () => {
      cancelled = true
      open?.close()
    }
  }, [draftKey, known, setDrafts])

  // Stamped with the append epoch of the render that first shows the value, so a save read before
  // a refused send's words came back to the tab cannot write over them when its debounce fires
  // after the words are on disk (writeNativeChatDraft; 2026-10-17).
  const text = draftKey ? drafts[draftKey] : undefined
  const read = useMemo(() => (text === undefined ? undefined : { text, at: nativeChatDraftEpoch() }), [draftKey, text])
  useDebouncedPersist(draftKey, read, DRAFT_WRITE_DEBOUNCE_MS, writeObservedDraft)
}

function writeObservedDraft(draftKey: string, read: { text: string; at: number }): void {
  void writeNativeChatDraft(draftKey, read.text, read.at)
}
