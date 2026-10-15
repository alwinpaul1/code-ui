import { useCallback, useRef, useState, type ReactNode } from 'react'
import { View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'

/**
 * How far to move content that sits centred in its container so it sits centred on the SCREEN.
 *
 * The chat's loading mark (Clawd, or the spinner) is centred in the space between the header and
 * the composer, which is taller at the top than the bottom, so it sat visibly above the middle of
 * the phone (2026-10-15: "make the mascot and the loading thingy on the center of the view port").
 * The shift is clamped to the room the container leaves around the content, so it never slides
 * under the header or the composer; with no room, or nothing measured yet, it does not move.
 */
export function viewportCentreOffset({
  windowHeight,
  containerTop,
  containerHeight,
  contentHeight
}: {
  windowHeight: number
  containerTop: number
  containerHeight: number
  contentHeight: number
}): number {
  if (![windowHeight, containerTop, containerHeight, contentHeight].every(Number.isFinite) || windowHeight <= 0 || containerHeight <= 0) {
    return 0
  }
  const wanted = windowHeight / 2 - (containerTop + containerHeight / 2)
  const room = Math.max(0, (containerHeight - Math.max(0, contentHeight)) / 2)
  return Math.round(Math.min(room, Math.max(-room, wanted)))
}

type Measurable = { measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void }

/**
 * A container that fills its space and draws `children` centred on the screen's middle, within
 * the container's bounds (viewportCentreOffset). Until both boxes are measured the children sit
 * centred in the container, exactly as before.
 */
export function ViewportCentred({ style, testID, children }: { style?: StyleProp<ViewStyle>; testID?: string; children: ReactNode }) {
  const { height: windowHeight } = useWindowDimensions()
  const container = useRef<View & Measurable>(null)
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const onContainerLayout = useCallback(() => {
    const target = container.current
    if (target === null || typeof target.measureInWindow !== 'function') {
      return
    }
    target.measureInWindow((_x, y, _width, height) => setBox({ top: y, height }))
  }, [])
  const onContentLayout = useCallback((event: LayoutChangeEvent) => setContentHeight(event.nativeEvent.layout.height), [])
  const offset =
    box === null || contentHeight === null
      ? 0
      : viewportCentreOffset({ windowHeight, containerTop: box.top, containerHeight: box.height, contentHeight })
  return (
    <View ref={container} onLayout={onContainerLayout} testID={testID} style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View onLayout={onContentLayout} testID="viewport-centred-content" style={{ alignItems: 'center', transform: [{ translateY: offset }] }}>
        {children}
      </View>
    </View>
  )
}
