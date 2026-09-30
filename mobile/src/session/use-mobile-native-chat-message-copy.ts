import { useCallback, useEffect, useRef, useState } from 'react'
import { useClipboardWriter } from '../platform/clipboard'
import { triggerError, triggerSuccess } from '../platform/haptics'

/** How long a message stays tinted once its copy landed. */
const MESSAGE_COPIED_MS = 700
/** How long a refused copy's notice stays under the message. */
const MESSAGE_COPY_FAILED_MS = 5_000

export type MobileNativeChatMessageCopy = {
  /** The clipboard took the last copy: tint the message. */
  copied: boolean
  /** Why the last copy did not land, while it is still worth showing. */
  error: string | null
  /** Never rejects: the outcome lands in `copied` or `error`. */
  copy: (text: string) => void
}

/**
 * A message's Copy control and a sent prompt's hold-to-copy.
 *
 * Why: this used to fire `setStringAsync` and forget it, then buzz success
 * and tint the bubble. `setStringAsync` answers false when the pasteboard did
 * not take the text, and it can reject, so the phone claimed a copy that
 * never landed and the rejection went unhandled. The write goes through the
 * clipboard seam (which turns false into a rejection) and is awaited: the
 * success haptic and the tint come only once it lands; a refusal buzzes an
 * error and leaves a notice, the way the code block's Copy does.
 */
export function useMobileNativeChatMessageCopy(): MobileNativeChatMessageCopy {
  const clipboard = useClipboardWriter()
  const [state, setState] = useState<{ copied: boolean; error: string | null }>({
    copied: false,
    error: null
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The chat list unmounts a row that scrolls out of its draw window, and the
  // write can land after that.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [])
  const copy = useCallback(
    (text: string) => {
      const write = async (): Promise<void> => {
        let next: { copied: boolean; error: string | null }
        try {
          await clipboard.writeText(text)
          next = { copied: true, error: null }
        } catch (error) {
          next = { copied: false, error: error instanceof Error ? error.message : String(error) }
        }
        // The hold has no button to press back, so the phone says how it went.
        if (next.copied) {
          triggerSuccess()
        } else {
          triggerError()
        }
        if (!mounted.current) {
          return
        }
        if (timer.current) {
          clearTimeout(timer.current)
        }
        setState(next)
        timer.current = setTimeout(
          () => {
            timer.current = null
            setState({ copied: false, error: null })
          },
          next.copied ? MESSAGE_COPIED_MS : MESSAGE_COPY_FAILED_MS
        )
      }
      void write()
    },
    [clipboard]
  )
  return { copied: state.copied, error: state.error, copy }
}
