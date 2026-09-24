// Why: react-native-gesture-handler's entry requires real 'react-native',
// whose Flow-typed internals Node cannot parse ("Unexpected token 'typeof'").
// Tool rows reach it through the detail sheet (DraggableDetailSheet), so every
// chat-message test died at import. Gestures here are inert builders and the
// views are host tags; a test that drives a gesture can still vi.mock the
// module (local wins).
import { createElement, type ReactNode } from 'react'

type Props = Record<string, unknown> & { children?: ReactNode }

// Any configuration call (onStart, activeOffsetY, simultaneousWithExternalGesture…)
// returns the same builder, so chained setup in component bodies runs as written.
function gesture(): unknown {
  const builder: unknown = new Proxy({}, { get: () => () => builder })
  return builder
}

export const Gesture = {
  Pan: gesture,
  Pinch: gesture,
  Tap: gesture,
  LongPress: gesture,
  Fling: gesture,
  Native: gesture,
  Manual: gesture,
  Rotation: gesture,
  Hover: gesture,
  Simultaneous: gesture,
  Exclusive: gesture,
  Race: gesture
}

export const GestureDetector = (props: Props) => createElement('GestureDetector', props)
export const GestureHandlerRootView = (props: Props) => createElement('GestureHandlerRootView', props)
