import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { readNativeChatDraft, writeNativeChatDraft } from '../storage/native-chat-drafts'

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
    void readNativeChatDraft(draftKey).then((stored) => {
      if (cancelled || !stored) {
        return
      }
      // A key the user typed into meanwhile wins over the stored copy.
      setDrafts((previous) =>
        previous[draftKey] === undefined ? { ...previous, [draftKey]: stored } : previous
      )
    })
    return () => {
      cancelled = true
    }
  }, [draftKey, known, setDrafts])

  const currentDraft = draftKey ? drafts[draftKey] : undefined
  useEffect(() => {
    if (!draftKey || currentDraft === undefined) {
      return
    }
    const timer = setTimeout(() => {
      void writeNativeChatDraft(draftKey, currentDraft)
    }, DRAFT_WRITE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draftKey, currentDraft])
}
