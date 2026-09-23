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
 * The held frame is forgotten the moment the overlay yields to the terminal.
 * Without that, a chat drawn before the reader switched to terminal mode came
 * back later: pressing Ctrl+C twice ended Claude Code, the tab stopped being a
 * chat tab, that read as a blink, and the old chat covered the terminal for
 * the length of the hold (2026-09-23). A hold bridges two chat frames; once
 * the terminal is on screen there is no chat left to bridge.
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
  const held = holding && !expired && last?.surfaceId === surfaceId ? last.element : null
  const frame = mobileNativeChatFrameToShow({
    blank,
    showNativeChat,
    hasHeldFrame: held != null,
    hasTerminalUnderneath
  })
  if (frame === 'terminal') {
    lastRef.current = null
  }
  return {
    frame,
    held: frame === 'hold' ? held : null,
    remember: (drawn) => {
      lastRef.current = { surfaceId, element: drawn }
    }
  }
}
