import { useEffect, useRef, useState } from 'react'
import {
  mobileNativeChatFrameToShow,
  type MobileNativeChatFrame
} from './mobile-native-chat-frame-decision'

export const CHAT_FRAME_HOLD_MS = 1500

/**
 * What the chat overlay shows this render, and the held frame it replays.
 *
 * The last chat drawn for a surface is replayed while the source blanks
 * briefly: a reconnect re-hydrating the tab list, or a transcript re-read,
 * would otherwise drop to the terminal for a frame and back (2026-09-13). The
 * hold is decided in the same render that blanks: an earlier version set it
 * from an effect, so the first blank frame returned null, the terminal showed
 * for that frame and the whole chat list remounted. Only the expiry lives in
 * an effect.
 *
 * Once the overlay has yielded to the terminal, the held frame is replayed
 * only while the reader is asking for chat. Without that, a chat drawn before
 * the reader switched to terminal mode came back on its own: pressing Ctrl+C
 * twice ended Claude Code, the tab stopped being a chat tab, that read as a
 * blink, and the old chat covered the terminal for the length of the hold
 * (2026-09-23). Forgetting the frame outright fixed that and broke the way
 * back: returning to chat re-reads the transcript, and the reader got a
 * spinner for a relay round trip instead of the chat they had left.
 */
export function useNativeChatFrame(args: {
  /** The source has nothing to show right now: not a chat tab, or reloading empty. */
  blank: boolean
  /** The blank is a blip (identity lost, view unresolved), not the reader leaving. */
  blink: boolean
  showNativeChat: boolean
  hasTerminalUnderneath: boolean
  surfaceId: string
}): {
  frame: MobileNativeChatFrame
  held: React.JSX.Element | null
  remember: (drawn: React.JSX.Element) => void
} {
  const { blank, blink, showNativeChat, hasTerminalUnderneath, surfaceId } = args
  const holding = blank && blink
  const lastRef = useRef<{ surfaceId: string; element: React.JSX.Element } | null>(null)
  // The terminal has been on screen since the last chat frame was drawn.
  const yieldedRef = useRef(false)
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    if (!holding) {
      setExpired(false)
      return
    }
    const timer = setTimeout(() => setExpired(true), CHAT_FRAME_HOLD_MS)
    return () => clearTimeout(timer)
  }, [holding, surfaceId])
  const last = lastRef.current
  const held =
    holding && !expired && last?.surfaceId === surfaceId && (!yieldedRef.current || showNativeChat)
      ? last.element
      : null
  const frame = mobileNativeChatFrameToShow({
    blank,
    showNativeChat,
    hasHeldFrame: held != null,
    hasTerminalUnderneath
  })
  if (frame === 'terminal') {
    yieldedRef.current = true
  } else if (frame === 'hold' && showNativeChat) {
    // The reader asked for chat and is looking at it again, held or not: a
    // blip before the reload lands must hold as it would over a drawn chat.
    yieldedRef.current = false
  }
  return {
    frame,
    held: frame === 'hold' ? held : null,
    remember: (drawn) => {
      lastRef.current = { surfaceId, element: drawn }
      yieldedRef.current = false
    }
  }
}
