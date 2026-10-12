import { useMemo, type ReactNode } from 'react'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import type { TypeVariant } from '../theme/tokens'
import { Txt } from '../ui/Txt'

/**
 * Selectable text that lets go when the sheet's pan takes the touch.
 *
 * Why the gesture: the sheet scrolls and drags under gesture-handler, and once
 * a pan activates, its root stops passing the touch to the Android views below
 * without sending them a cancel. A selectable TextView arms its long-press on
 * touch-down, never hears the finger move or lift, and selects the word under
 * it mid-scroll (Copy / Translate / Select all, reported 2026-09-26). With a
 * Native gesture of its own, the pan's activation cancels that gesture, and
 * gesture-handler hands the TextView an ACTION_CANCEL, which drops the
 * pending long-press. A long-press that does not move still selects.
 */
export function SelectableSheetText({
  variant,
  tone = 'primary',
  testID,
  children
}: {
  variant: TypeVariant
  tone?: 'danger' | 'primary'
  testID?: string
  children: ReactNode
}) {
  const gesture = useMemo(() => Gesture.Native(), [])
  // The detector sets user-select: none on web unless told otherwise.
  return (
    <GestureDetector gesture={gesture} userSelect="text">
      <Txt variant={variant} tone={tone} testID={testID} selectable>
        {children}
      </Txt>
    </GestureDetector>
  )
}
