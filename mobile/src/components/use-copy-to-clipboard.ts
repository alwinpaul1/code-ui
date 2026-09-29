import { useCallback, useEffect, useRef, useState } from 'react'
import { useClipboardWriter } from '../platform/clipboard'

/** How long "copied" shows on the button, and a refusal above the code. */
const COPIED_MS = 1_500
const FAILED_MS = 5_000

export type CopyToClipboard = {
  copied: boolean
  /** Why the last copy did not land, while it is still worth showing. */
  error: string | null
  /** Resolves true when the clipboard took the text. */
  copy: (text: string) => Promise<boolean>
}

/**
 * Copying from the code viewer or a chat code block, with its outcome. A
 * refusal is kept and shown (MobileCodeView's notice line, the line under a
 * code block's header): a copy that fails without a word looks exactly like
 * one that worked, and the paste finds the old text.
 */
export function useCopyToClipboard(): CopyToClipboard {
  const clipboard = useClipboardWriter()
  const [state, setState] = useState<{ copied: boolean; error: string | null }>({ copied: false, error: null })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A copy can land after its button is gone: a chat cell unmounts its
  // markdown whenever the list recycles it. The timer is armed after the
  // write, so a cleanup that ran first could not clear it.
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
    async (text: string) => {
      let next: { copied: boolean; error: string | null }
      try {
        await clipboard.writeText(text)
        next = { copied: true, error: null }
      } catch (error) {
        next = { copied: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (!mounted.current) {
        return next.copied
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
        next.copied ? COPIED_MS : FAILED_MS
      )
      return next.copied
    },
    [clipboard]
  )
  return { copied: state.copied, error: state.error, copy }
}

/** The notice line for a copy the clipboard refused. */
export function copyFailedNotice(error: string): string {
  return `Couldn't copy: ${error}.`
}
