import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'

/** Where the last composer height is kept between runs. */
export const CHAT_DOCK_HEIGHT_KEY = 'codeui:chat-dock-height-v1'
/** A stored height past this is not a composer with the keyboard down: ignored. */
const MAX_REMEMBERED_DOCK_DP = 1000

/**
 * The composer dock's height as last measured with the keyboard down, for this run and the next.
 *
 * The dock is an absolutely positioned overlay (the transcript shows through it), so the list
 * learns its height only from the dock's `onLayout`, which lands a frame after the rows are drawn.
 * Starting every open at 0 drew the newest row under the composer on the first frame and slid
 * every row up by the dock's height on the next: the open "populated and scrolled down" (the
 * user, 2026-10-15). The Claude app's Code session has no such frame: its list's bottom padding
 * is the scaffold's inset for the composer, measured in the same layout pass as the rows
 * (docs/claude-app-implementation-notes.md sections 7 and 9). Seeding the spacer with the last
 * height measured is the nearest a JS-measured overlay gets; a dock that differs this time (a
 * permission card, the key strip) still corrects itself on its first layout, as before.
 *
 * A height measured with the keyboard up is not remembered: a session opens with it down.
 */
let rememberedDockHeight = 0
/** Bumped by every measure, so a hydrate that lands late does not overwrite a fresher one. */
let measuredSinceStart = false

function saneHeight(value: number): number | null {
  return Number.isFinite(value) && value > 0 && value <= MAX_REMEMBERED_DOCK_DP ? Math.round(value) : null
}

/** Reads the last run's height (app start, session-caches-hydrate.ts). Never rejects: an
 *  unreadable value is an open at 0, as before. */
export async function hydrateChatDockHeight(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CHAT_DOCK_HEIGHT_KEY)
    const stored = raw ? saneHeight(Number(raw)) : null
    if (stored !== null && !measuredSinceStart) {
      rememberedDockHeight = stored
    }
  } catch {
    // A missing or unreadable height costs only the first open its spacer.
  }
}

function rememberDockHeight(height: number): void {
  const sane = saneHeight(height)
  measuredSinceStart = true
  if (sane === null || sane === rememberedDockHeight) {
    return
  }
  rememberedDockHeight = sane
  // A failed write costs the next cold start's first open its spacer, nothing else.
  void AsyncStorage.setItem(CHAT_DOCK_HEIGHT_KEY, String(sane)).catch(() => undefined)
}

export function resetChatDockHeightForTests(): void {
  rememberedDockHeight = 0
  measuredSinceStart = false
}

/** The dock's measured height, which the spacer at the list's end clears.
 *  When it changes while the reader sits at the live edge, re-pin, or the newest row
 *  ends up under the dock (2026-09-13, first open of 0.5.29).
 *
 *  The re-pin goes through the tail-follow owner's `pinToTail`, which is the
 *  one caller allowed to move the list and already refuses while the reader
 *  holds it — this hook no longer reaches for the list's ref itself.
 *
 *  `keyboardUp`: the dock is measured over the keyboard, so the height is not remembered. */
export function useChatDock(pinToTail: () => void, keyboardUp = false): {
  dockHeight: number
  onDockLayout: (event: LayoutChangeEvent) => void
} {
  // The first frame holds the composer's room already (see rememberedDockHeight).
  const [dockHeight, setDockHeight] = useState(() => rememberedDockHeight)
  // A change re-pins; the height the chat opened with does not: the list opens at its tail.
  const openedWith = useRef<number | null>(dockHeight)
  useEffect(() => {
    if (openedWith.current === dockHeight) {
      return
    }
    openedWith.current = null
    if (dockHeight > 0) {
      pinToTail()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockHeight])
  const onDockLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = Math.round(event.nativeEvent.layout.height)
      if (!keyboardUp) {
        rememberDockHeight(height)
      }
      setDockHeight(height)
    },
    [keyboardUp]
  )
  return { dockHeight, onDockLayout }
}
