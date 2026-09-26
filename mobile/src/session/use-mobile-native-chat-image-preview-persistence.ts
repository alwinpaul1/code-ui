import { useDebouncedPersist } from './use-debounced-persist'
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import {
  knownNativeChatImagePreviews,
  loadNativeChatImagePreviews,
  nativeChatImagePreviewsSettledThisRun,
  saveNativeChatImagePreviews
} from './mobile-native-chat-image-preview-cache'

const PREVIEW_WRITE_DEBOUNCE_MS = 250

type PreviewsBySession = Record<string, Record<string, string[]>>

/**
 * Keeps a session's phone-local image previews on disk, keyed by transcript
 * message id: hydrates them the first time the session is shown and mirrors
 * changes back with a trailing debounce. Without this the thumbnail of a photo
 * the phone sent vanished from its bubble after a remount, and the host cannot
 * hand it back (see storage/native-chat-image-previews.ts).
 */
export function useMobileNativeChatImagePreviewPersistence(
  sessionKey: string | null,
  previewsBySession: PreviewsBySession,
  setPreviewsBySession: Dispatch<SetStateAction<PreviewsBySession>>
): void {
  const known = sessionKey ? previewsBySession[sessionKey] !== undefined : true
  useEffect(() => {
    if (!sessionKey || known) {
      return
    }
    // Previews that landed meanwhile win per message; stored ones fill the
    // rest, and win over a previous run's copy for a message both name: the
    // stored entry is the record, and the copy can be a change behind it.
    const fill = (stored: Record<string, string[]> | null | undefined, over?: Record<string, string[]>) => {
      if (!stored || Object.keys(stored).length === 0) {
        return
      }
      setPreviewsBySession((previous) => {
        const mine = previous[sessionKey] ?? {}
        const next = { ...stored, ...mine }
        for (const [messageId, uris] of Object.entries(over ?? {})) {
          if (mine[messageId] === uris && stored[messageId]) {
            next[messageId] = stored[messageId]
          }
        }
        return { ...previous, [sessionKey]: next }
      })
    }
    // What the chat already drew from the cache (use-mobile-native-chat-drafts.ts).
    const copy = knownNativeChatImagePreviews(sessionKey)
    fill(copy)
    // Written or read in this run, storage holds nothing newer; a previous
    // run's copy is only the start, and the read below completes it.
    if (nativeChatImagePreviewsSettledThisRun(sessionKey)) {
      return
    }
    // Not cancelled by a change of session: the state is kept per session,
    // and a read dropped then left the session's older photos out of the
    // next write, which replaced the stored entry (review, 2026-09-26).
    void loadNativeChatImagePreviews(sessionKey).then((stored) => fill(stored, copy))
  }, [known, sessionKey, setPreviewsBySession])

  useDebouncedPersist(
    sessionKey,
    sessionKey ? previewsBySession[sessionKey] : undefined,
    PREVIEW_WRITE_DEBOUNCE_MS,
    saveNativeChatImagePreviews
  )
}
