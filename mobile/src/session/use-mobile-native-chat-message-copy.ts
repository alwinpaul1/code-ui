import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, ToastAndroid } from 'react-native'
import { useClipboardWriter } from '../platform/clipboard'
import { triggerError, triggerSuccess } from '../platform/haptics'

/** The API level from which Android shows its own confirmation of every clipboard write (the
 *  Claude app's check, e730.A: `Build.VERSION.SDK_INT < 33`). */
export const SYSTEM_CONFIRMS_COPY_API = 33
/** What the Claude app says below that level: `generic_copied_toast`. */
export const COPIED_TOAST = 'Copied to clipboard'

/** How long `copied` stays true when the caller does not say. */
export const MESSAGE_COPIED_MS = 700
/** The longest text one Copy puts on the clipboard: the Claude app clips at 100000 characters
 *  (`qv7.a`, `eek.d0(100000, str)`). A longer reply passed whole can be refused by the system. */
export const MESSAGE_COPY_MAX_CHARS = 100_000
/** How long a refused copy's notice stays under the message. */
const MESSAGE_COPY_FAILED_MS = 5_000

export type MobileNativeChatMessageCopy = {
  /** The clipboard took the last copy (never set when the system confirms it). */
  copied: boolean
  /** Why the last copy did not land, while it is still worth showing. */
  error: string | null
  /** Never rejects: the outcome lands in `copied` or `error`. */
  copy: (text: string) => void
}

/**
 * A reply's Copy control, and the Copy message row of the menu a hold on a sent prompt opens.
 *
 * Why: this used to fire `setStringAsync` and forget it, then buzz success
 * and tint the bubble. `setStringAsync` answers false when the pasteboard did
 * not take the text, and it can reject, so the phone claimed a copy that
 * never landed and the rejection went unhandled. The write goes through the
 * clipboard seam (which turns false into a rejection) and is awaited: any
 * confirmation comes only once it lands; a refusal buzzes an error and leaves
 * a notice, the way the code block's Copy does.
 */
export function useMobileNativeChatMessageCopy(
  /** How long `copied` stays true: a reply's check (2000 ms, as the Claude app holds it). */
  copiedMs: number = MESSAGE_COPIED_MS,
  /**
   * Who says a copy landed. `own`: this hook, with the success buzz and `copied`. `system`: the
   * Claude app's way for the hold menu's Copy message (1.261013.20 e730.A): from Android 13 the
   * system confirms every copy itself (One UI draws a "Copied." pill above the composer), so the
   * app adds nothing; below 13 it says "Copied to clipboard" (`generic_copied_toast`), here as a
   * toast. No buzz and no tint either way. A refusal is reported the same in both.
   */
  confirm: 'own' | 'system' = 'own'
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
        if (next.copied && confirm === 'system') {
          if (Platform.OS === 'android' && Number(Platform.Version) < SYSTEM_CONFIRMS_COPY_API) {
            ToastAndroid.show(COPIED_TOAST, ToastAndroid.SHORT)
          }
          // A copy that landed retires an earlier refusal's notice.
          if (mounted.current && timer.current) {
            clearTimeout(timer.current)
            timer.current = null
            setState({ copied: false, error: null })
          }
          return
        }
        // A control with nothing to press back says how it went.
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
    [clipboard, copiedMs, confirm]
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
