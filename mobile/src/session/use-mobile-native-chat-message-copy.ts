import { useCallback, useEffect, useRef, useState } from 'react'
import { useClipboardWriter } from '../platform/clipboard'
import { triggerError, triggerSuccess } from '../platform/haptics'

/** How long a sent prompt stays tinted once its copy landed. */
export const MESSAGE_COPIED_MS = 700
/** The longest text one Copy puts on the clipboard: the Claude app clips at 100000 characters
 *  (`qv7.a`, `eek.d0(100000, str)`). A longer reply passed whole can be refused by the system. */
export const MESSAGE_COPY_MAX_CHARS = 100_000
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
 * A reply's Copy control and a sent prompt's Copy message (the row of the menu a hold opens).
 *
 * Why: this used to fire `setStringAsync` and forget it, then buzz success
 * and tint the bubble. `setStringAsync` answers false when the pasteboard did
 * not take the text, and it can reject, so the phone claimed a copy that
 * never landed and the rejection went unhandled. The write goes through the
 * clipboard seam (which turns false into a rejection) and is awaited: the
 * success haptic and the tint come only once it lands; a refusal buzzes an
 * error and leaves a notice, the way the code block's Copy does.
 */
export function useMobileNativeChatMessageCopy(
  /** How long `copied` stays true: a prompt's tint, or a reply's check (2000 ms, as the Claude app holds it). */
  copiedMs: number = MESSAGE_COPIED_MS
): MobileNativeChatMessageCopy {
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
    (full: string) => {
      const text = clippedForClipboard(full)
      const write = async (): Promise<void> => {
        let next: { copied: boolean; error: string | null }
        try {
          await clipboard.writeText(text)
          next = { copied: true, error: null }
        } catch (error) {
          next = { copied: false, error: error instanceof Error ? error.message : String(error) }
        }
        // A menu row has no button to press back (and the sheet is gone), so the phone says how it went.
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
          next.copied ? copiedMs : MESSAGE_COPY_FAILED_MS
        )
      }
      void write()
    },
    [clipboard, copiedMs]
  )
  return { copied: state.copied, error: state.error, copy }
}

/** `text` cut to the clipboard's limit, never between the two halves of a surrogate pair (`eek.d0`). */
function clippedForClipboard(text: string): string {
  if (text.length <= MESSAGE_COPY_MAX_CHARS) {
    return text
  }
  const last = text.charCodeAt(MESSAGE_COPY_MAX_CHARS - 1)
  const end = last >= 0xd800 && last <= 0xdbff ? MESSAGE_COPY_MAX_CHARS - 1 : MESSAGE_COPY_MAX_CHARS
  return text.slice(0, end)
}
