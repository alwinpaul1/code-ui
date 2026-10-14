import { useEffect, useRef, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useReducedMotion } from '../ui/use-reduced-motion'
import {
  DICTATION_ROW_SPRING,
  type DictationRowEnding,
  type DictationRowPhase
} from './MobileNativeChatDictationRow'

/**
 * The composer's half of the recording row (MobileNativeChatDictationRow.tsx): which phase the
 * take is in, which button ended it, the send that waits for its last words, and the swap between
 * the field + action row and the recording row.
 *
 * The Claude app swaps its whole composer to its speech toolbar while a take runs, transcribing
 * included (1.261009.20: `yv8` hands the toolbar to `x030.b` while `rs8.n3()`; the text field `aj1`
 * fades to 1 − p and its height to (1 − p) × its own, `dx0` case 11 and `fb8` case 0, whatever it
 * holds; p springs at ratio 1, stiffness 400, and snaps with animations off, `hb8` case 0).
 */
export function useComposerDictationRow({
  micActive,
  micTranscribing,
  onCancelDictation,
  onStopDictation,
  sendNow
}: {
  micActive: boolean
  micTranscribing: boolean
  onCancelDictation?: () => void
  onStopDictation?: () => void
  /** The composer's own send, run once a take ended by Send dictation has its last words in. */
  sendNow: () => void
}) {
  const reducedMotion = useReducedMotion() === true
  const available = onCancelDictation !== undefined && onStopDictation !== undefined
  const phase: DictationRowPhase = !available
    ? 'off'
    : micTranscribing
      ? 'transcribing'
      : micActive
        ? 'listening'
        : 'off'
  const up = phase !== 'off'
  const [ending, setEnding] = useState<DictationRowEnding>(null)
  const sendWhenEndedRef = useRef(false)
  const sendNowRef = useRef(sendNow)
  sendNowRef.current = sendNow

  const stop = (): void => {
    setEnding('stop')
    onStopDictation?.()
  }
  // Send dictation stops the take and sends once its last words are in (the Claude app's Send
  // dictation, `kcw.f` → `bdg`/`f86`: a pending-send flag, then the stop). Sending at the tap
  // would drop whatever the engine had not finished.
  const send = (): void => {
    sendWhenEndedRef.current = true
    setEnding('send')
    onStopDictation?.()
  }
  const cancel = (): void => {
    sendWhenEndedRef.current = false
    setEnding(null)
    onCancelDictation?.()
  }
  // The take has ended. Its words are in the draft in this same render: both engines set their
  // last transcript and their idle status in one callback, which React batches.
  useEffect(() => {
    if (up) {
      return
    }
    setEnding(null)
    if (sendWhenEndedRef.current) {
      sendWhenEndedRef.current = false
      sendNowRef.current()
    }
  }, [up])

  const swap = useSharedValue(up ? 1 : 0)
  useEffect(() => {
    const target = up ? 1 : 0
    swap.value = reducedMotion ? target : withSpring(target, DICTATION_ROW_SPRING)
  }, [up, reducedMotion, swap])
  // The field's own height, measured inside the fold; -1 until the first layout, so the first
  // frame is not drawn at zero height.
  const fieldHeight = useSharedValue(-1)
  const fieldStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, swap.value))
    return fieldHeight.value < 0
      ? { opacity: 1 - p }
      : { opacity: 1 - p, height: fieldHeight.value * (1 - p) }
  })
  const actionsStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, swap.value)) }))
  const layerStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, swap.value)) }))
  const onFieldLayout = (event: LayoutChangeEvent): void => {
    fieldHeight.value = event.nativeEvent.layout.height
  }

  return {
    /** For the field and the action row: out of a screen reader's reach while the row is up. */
    hiddenWhileUp: {
      importantForAccessibility: up ? ('no-hide-descendants' as const) : ('auto' as const),
      accessibilityElementsHidden: up
    },
    available,
    phase,
    up,
    ending,
    stop,
    send,
    cancel,
    fieldStyle,
    actionsStyle,
    layerStyle,
    onFieldLayout,
    /** The idle row's mic shows Stop only when no recording row takes over (the row has its own). */
    micShowsStop: micActive && !available
  }
}
