import { useEffect, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated'
import { SvgXml } from 'react-native-svg'
import {
  ZOOM_MIN,
  clampScale,
  clampTranslation,
  containedSize,
  doubleTapTarget,
  translationKeepingFocal
} from './zoomable-image-math'

export type ZoomableImageSource = { kind: 'bitmap'; uri: string } | { kind: 'svg'; xml: string }

const SETTLE = { damping: 22, stiffness: 240, mass: 0.6 }

/**
 * A picture the reader can pinch into, pan around and double-tap, inside a
 * box of a known size. Why the box is given rather than measured: the
 * translation clamp needs the drawn size at the same moment the gesture does,
 * and a measure that arrives a frame later lets the first pinch overshoot.
 *
 * Android has nothing built in for this — ScrollView's zoom props are iOS
 * only — so the gestures are gesture-handler's and the transform is a
 * reanimated style, both already in the app (2026-09-19, "click an image in
 * a md preview to zoom it to read the text in it").
 *
 * `onZoomedChange` tells a pager around the image to stop paging while the
 * reader is zoomed in, so a pan moves the picture and not the page.
 */
export function ZoomableImage({
  source,
  width,
  height,
  aspectRatio,
  accessibilityLabel,
  onSingleTap,
  onZoomedChange
}: {
  source: ZoomableImageSource
  width: number
  height: number
  /** Width over height of the picture; without it the picture is taken to
   *  fill the box, and the clamp is looser than it could be. */
  aspectRatio?: number
  accessibilityLabel?: string
  onSingleTap?: () => void
  onZoomedChange?: (zoomed: boolean) => void
}) {
  const box = { width, height }
  const drawn = containedSize(box, aspectRatio ?? 0)
  const scale = useSharedValue(ZOOM_MIN)
  const savedScale = useSharedValue(ZOOM_MIN)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)
  const [zoomed, setZoomed] = useState(false)

  const sourceKey = source.kind === 'bitmap' ? source.uri : source.xml
  useEffect(() => {
    // A new picture starts at fit.
    scale.value = ZOOM_MIN
    savedScale.value = ZOOM_MIN
    tx.value = 0
    ty.value = 0
    savedTx.value = 0
    savedTy.value = 0
    setZoomed(false)
  }, [sourceKey, scale, savedScale, tx, ty, savedTx, savedTy])

  useEffect(() => {
    onZoomedChange?.(zoomed)
  }, [onZoomedChange, zoomed])

  const settle = (toScale: number, to: { x: number; y: number }) => {
    'worklet'
    scale.value = withSpring(toScale, SETTLE)
    tx.value = withSpring(to.x, SETTLE)
    ty.value = withSpring(to.y, SETTLE)
    savedScale.value = toScale
    savedTx.value = to.x
    savedTy.value = to.y
    runOnJS(setZoomed)(toScale > ZOOM_MIN + 0.01)
  }

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value
      savedTx.value = tx.value
      savedTy.value = ty.value
    })
    .onUpdate((event) => {
      const next = clampScale(savedScale.value * event.scale)
      const focal = { x: event.focalX - width / 2, y: event.focalY - height / 2 }
      const moved = translationKeepingFocal(
        focal,
        { x: savedTx.value, y: savedTy.value },
        savedScale.value,
        next
      )
      scale.value = next
      tx.value = moved.x
      ty.value = moved.y
    })
    .onEnd(() => {
      const toScale = clampScale(scale.value)
      settle(toScale, clampTranslation({ x: tx.value, y: ty.value }, drawn, box, toScale))
    })

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .minPointers(1)
    .maxPointers(1)
    .onStart(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
    })
    .onUpdate((event) => {
      const next = clampTranslation(
        { x: savedTx.value + event.translationX, y: savedTy.value + event.translationY },
        drawn,
        box,
        scale.value
      )
      tx.value = next.x
      ty.value = next.y
    })
    .onEnd(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((event) => {
      const target = doubleTapTarget(
        scale.value,
        { x: event.x - width / 2, y: event.y - height / 2 },
        drawn,
        box
      )
      scale.value = withTiming(target.scale, { duration: 220 })
      tx.value = withTiming(target.translation.x, { duration: 220 })
      ty.value = withTiming(target.translation.y, { duration: 220 })
      savedScale.value = target.scale
      savedTx.value = target.translation.x
      savedTy.value = target.translation.y
      runOnJS(setZoomed)(target.scale > ZOOM_MIN + 0.01)
    })

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      if (onSingleTap) {
        runOnJS(onSingleTap)()
      }
    })

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap))

  const transform = useAnimatedStyle(
    () => ({
      transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }]
    }),
    // Named so the mapper has inputs where no Babel closure is written (the web bundle).
    [tx, ty, scale]
  )

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.box, { width, height }, transform]}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        testID="zoomable-image"
      >
        {source.kind === 'svg' ? (
          <View style={{ width: drawn.width, height: drawn.height }}>
            <SvgXml xml={source.xml} width={drawn.width} height={drawn.height} />
          </View>
        ) : (
          <Image
            source={{ uri: source.uri }}
            style={{ width: drawn.width, height: drawn.height }}
            resizeMode="contain"
            accessibilityLabel={accessibilityLabel}
          />
        )}
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' }
})
