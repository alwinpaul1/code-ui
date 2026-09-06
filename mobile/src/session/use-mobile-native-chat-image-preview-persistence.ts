import { useEffect, type Dispatch, type SetStateAction } from 'react'
import {
  readNativeChatImagePreviews,
  writeNativeChatImagePreviews
} from '../storage/native-chat-image-previews'

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
    let cancelled = false
    void readNativeChatImagePreviews(sessionKey).then((stored) => {
      if (cancelled || !stored || Object.keys(stored).length === 0) {
        return
      }
      // Previews that landed meanwhile win per message; stored ones fill the rest.
      setPreviewsBySession((previous) => ({
        ...previous,
        [sessionKey]: { ...stored, ...previous[sessionKey] }
      }))
    })
    return () => {
      cancelled = true
    }
  }, [known, sessionKey, setPreviewsBySession])

  const current = sessionKey ? previewsBySession[sessionKey] : undefined
  useEffect(() => {
    if (!sessionKey || current === undefined) {
      return
    }
    const timer = setTimeout(() => {
      void writeNativeChatImagePreviews(sessionKey, current)
    }, PREVIEW_WRITE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [current, sessionKey])
}
