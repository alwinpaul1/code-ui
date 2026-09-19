import { useEffect, useRef, type RefObject } from 'react'
import { findNodeHandle, type TextInput } from 'react-native'
import {
  addRichPasteImageListener,
  attachRichPaste,
  detachRichPaste,
  isRichPasteSupported
} from '@codeui/expo-rich-paste'

/**
 * Let the composer's TextInput take an image straight from the keyboard's
 * clipboard panel or the paste menu, the way the Claude app's does — no
 * "+ → Paste image" detour (2026-09-19).
 *
 * The native side needs the input's view tag, which exists only once the
 * input has mounted, and Fabric may recreate the view; so the attach is
 * retried on every effect run and the tag re-read each time. An image the
 * native side received for THIS input is handed to `onImageFile` as a
 * `file://` copy in the app cache.
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
    const attach = () => {
      const tag = inputRef.current ? findNodeHandle(inputRef.current) : null
      if (tag !== null && tag !== viewTag) {
        if (attachRichPaste(tag)) {
          viewTag = tag
        }
      }
    }
    attach()
    // The view may not exist on the first frame; try again shortly.
    const retry = setTimeout(attach, 300)
    const subscription = addRichPasteImageListener((image) => {
      if (viewTag !== null && image.viewTag === viewTag) {
        onImageFileRef.current?.(image.uri)
      }
    })
    return () => {
      clearTimeout(retry)
      subscription.remove()
      if (viewTag !== null) {
        detachRichPaste(viewTag)
      }
    }
  }, [enabled, inputRef])
}
