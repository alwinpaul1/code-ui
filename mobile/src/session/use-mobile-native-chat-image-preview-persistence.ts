import { useDebouncedPersist } from './use-debounced-persist'
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
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
  // The read answers for the session it was asked for, however soon the
  // state gains an entry: the cached copy below and a photo that lands both
  // give it one, and neither holds everything storage does.
  const activeKey = useRef(sessionKey)
  activeKey.current = sessionKey
  useEffect(() => {
    if (!sessionKey || known) {
      return
    }
    // Previews that landed meanwhile win per message; stored ones fill the rest.
    const fill = (stored: Record<string, string[]> | null | undefined) => {
      if (stored && Object.keys(stored).length > 0) {
        setPreviewsBySession((previous) => ({ ...previous, [sessionKey]: { ...stored, ...previous[sessionKey] } }))
      }
    }
    // What the chat already drew from the cache (use-mobile-native-chat-drafts.ts).
    fill(knownNativeChatImagePreviews(sessionKey))
    // Written or read in this run, storage holds nothing newer; a previous
    // run's copy is only the start, and the read below completes it.
    if (nativeChatImagePreviewsSettledThisRun(sessionKey)) {
      return
    }
    void loadNativeChatImagePreviews(sessionKey).then((stored) => {
      if (activeKey.current === sessionKey) {
        fill(stored)
      }
    })
  }, [known, sessionKey, setPreviewsBySession])

  useDebouncedPersist(
    sessionKey,
    sessionKey ? previewsBySession[sessionKey] : undefined,
    PREVIEW_WRITE_DEBOUNCE_MS,
    saveNativeChatImagePreviews
  )
}
