import { useEffect, useRef, type RefObject } from 'react'
import { findNodeHandle, type TextInput } from 'react-native'
import {
  addRichPasteImageListener,
  attachRichPaste,
  detachRichPaste,
  isRichPasteSupported
} from '@codeui/expo-rich-paste'

/** When the attach is tried after the effect's first go, in ms. Fabric mounts
 *  the native view on the UI thread after the JS commit, so the first try
 *  can run before the view exists; a second or third try is usually enough,
 *  and the last one is late enough for a slow screen. */
export const RICH_PASTE_ATTACH_RETRY_MS = [300, 1000, 3000] as const

/**
 * Let the composer's TextInput take an image straight from the keyboard's
 * clipboard panel or the paste menu, the way the Claude app's does — no
 * "+ → Paste image" detour (2026-09-19).
 *
 * The native side needs the input's view tag, which exists only once the
 * input has mounted, and Fabric may recreate the view; so the attach is
 * retried a few times and the tag re-read each time. An image the native
 * side received for THIS input is handed to `onImageFile` as a `file://`
 * copy in the app cache.
 *
 * Nothing here may throw: the first build threw "Unable to find view for tag
 * 7800" out of this effect when the view had not been mounted yet, and the
 * error boundary replaced the whole chat with "Something went wrong"
 * (device, 2026-09-19). A missed attach costs the paste, never the screen.
 */
export function useRichPasteInput(
  inputRef: RefObject<TextInput | null>,
  onImageFile: ((uri: string) => void) | undefined
): void {
  const onImageFileRef = useRef(onImageFile)
  useEffect(() => {
    onImageFileRef.current = onImageFile
  }, [onImageFile])
  const enabled = onImageFile !== undefined && isRichPasteSupported
  useEffect(() => {
    if (!enabled) {
      return
    }
    let viewTag: number | null = null
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const attach = () => {
      if (cancelled || viewTag !== null) {
        return
      }
      const tag = inputRef.current ? findNodeHandle(inputRef.current) : null
      if (tag === null) {
        return
      }
      attachRichPaste(tag)
        .then((attached) => {
          if (!cancelled && attached) {
            viewTag = tag
          }
        })
        .catch(() => undefined)
    }
    attach()
    for (const delay of RICH_PASTE_ATTACH_RETRY_MS) {
      timers.push(setTimeout(attach, delay))
    }
    const subscription = addRichPasteImageListener((image) => {
      if (viewTag !== null && image.viewTag === viewTag) {
        onImageFileRef.current?.(image.uri)
      }
    })
    return () => {
      cancelled = true
      for (const timer of timers) {
        clearTimeout(timer)
      }
      subscription.remove()
      if (viewTag !== null) {
        detachRichPaste(viewTag)
      }
    }
  }, [enabled, inputRef])
}
