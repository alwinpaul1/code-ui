import { useCallback, useEffect, useRef } from 'react'
import type { GestureResponderEvent } from 'react-native'
import { useChatTextHoldSelects } from '../components/chat-text-selectable-context'
import { triggerMediumImpact } from '../platform/haptics'

/**
 * A hold on a message in the chat, as the Claude app takes it (com.anthropic.claude 1.261009.20).
 *
 * The app gives a message row of a Code session a `detectTapGestures(onLongPress = open)`
 * (gv20.java `p`, through t77 case 3 and hrx.f; 1.261013.20 qs30.A, l87 case 4). Code UI holds
 * only the user's own prompt this way: Claude's words sit in the app's SelectionContainer
 * (1.261013.20 gy30.j, t8i.o), whose long press selects them in place. `open()` buzzes the long-press haptic before
 * it holds the message (xlg.java:84-96, `HapticFeedback.a(0)`, Compose's LongPress). Compose waits
 * Android's long-press timeout, 400 ms, and gives the hold up the moment the list's scroll takes
 * the pointer, which it does once the finger has moved past the touch slop (8 dp).
 *
 * React Native's Pressable gives up a long press the same way when the scroll view takes the
 * touch (it gets a touchcancel) and when the finger moves 10 dp. This gate says no on top of
 * that, so a scroll can never open a menu even where a cancel is late or never sent:
 *
 *   - the finger moved past the slop before the timeout (a press that became a scroll);
 *   - the list was scrolling when the finger went down (it went down to stop a fling);
 *   - the list began to scroll while the hold was pending.
 *
 * "Scrolling" is the chat's own scroll flag (useChatTextHoldSelects: false from a drag's or a
 * fling's begin until the list has been quiet with the finger up).
 */

/** Android's long-press timeout (ViewConfiguration.getLongPressTimeout()), which Compose's
 *  detectTapGestures waits for. */
export const CHAT_HOLD_MS = 400

/** Android's touch slop in dp (ViewConfiguration.getScaledTouchSlop()): past it, the list's
 *  scroll takes the pointer and Compose's long press is cancelled. */
export const CHAT_HOLD_SLOP_DP = 8

export type ChatHoldGate = {
  /** The finger went down at (x, y); `listAtRest` is false while the list scrolls. */
  pressIn(x: number, y: number, listAtRest: boolean): void
  move(x: number, y: number): void
  /** The list started scrolling while the finger was down. */
  listScrolled(): void
  /** The finger lifted or the touch was cancelled. */
  release(): void
  /** The long-press timeout fired: may the menu open? `listAtRest` is the flag now. */
  mayOpen(listAtRest: boolean): boolean
}

export function createChatHoldGate(slop: number = CHAT_HOLD_SLOP_DP): ChatHoldGate {
  let down: { x: number; y: number } | null = null
  let spoiled = false
  return {
    pressIn(x, y, listAtRest) {
      down = { x, y }
      spoiled = !listAtRest
    },
    move(x, y) {
      if (down && Math.hypot(x - down.x, y - down.y) > slop) {
        spoiled = true
      }
    },
    listScrolled() {
      if (down) {
        spoiled = true
      }
    },
    release() {
      down = null
      spoiled = false
    },
    mayOpen(listAtRest) {
      return down !== null && !spoiled && listAtRest
    }
  }
}

/** Where the hold landed, for the menu's anchor when the held view cannot be measured. */
export type ChatHoldPoint = { x: number; y: number }

/**
 * The props a Pressable needs to open a message's menu on a hold, gated as above. `onOpen` is
 * called after the haptic, with the point the finger is on; absent, the props do nothing.
 */
export function useChatMessageHold(onOpen: ((at: ChatHoldPoint) => void) | undefined): {
  onPressIn?: (event: GestureResponderEvent) => void
  onTouchMove?: (event: GestureResponderEvent) => void
  onPressOut?: () => void
  onLongPress?: (event: GestureResponderEvent) => void
  delayLongPress?: number
} {
  const listAtRest = useChatTextHoldSelects()
  const restRef = useRef(listAtRest)
  restRef.current = listAtRest
  const gate = useRef<ChatHoldGate | null>(null)
  if (gate.current === null) {
    gate.current = createChatHoldGate()
  }
  // The flag going false while a finger is down: the list began to scroll under the hold.
  useEffect(() => {
    if (!listAtRest) {
      gate.current?.listScrolled()
    }
  }, [listAtRest])
  const onPressIn = useCallback((event: GestureResponderEvent) => {
    gate.current?.pressIn(event.nativeEvent.pageX, event.nativeEvent.pageY, restRef.current)
  }, [])
  const onTouchMove = useCallback((event: GestureResponderEvent) => {
    gate.current?.move(event.nativeEvent.pageX, event.nativeEvent.pageY)
  }, [])
  const onPressOut = useCallback(() => {
    gate.current?.release()
  }, [])
  const onLongPress = useCallback(
    (event: GestureResponderEvent) => {
      if (!onOpen || !gate.current?.mayOpen(restRef.current)) {
        return
      }
      triggerMediumImpact()
      onOpen({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })
    },
    [onOpen]
  )
  if (!onOpen) {
    return {}
  }
  return { onPressIn, onTouchMove, onPressOut, onLongPress, delayLongPress: CHAT_HOLD_MS }
}
