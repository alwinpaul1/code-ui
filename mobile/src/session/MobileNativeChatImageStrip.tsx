import { useEffect, useState } from 'react'
import { Image, Pressable, ScrollView, useWindowDimensions } from 'react-native'
import { openImagePreview } from './image-preview-store'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'

/** A figure the agent read fills the message width, up to most of the screen
 *  tall, so a diagram stays readable. Taller than that and it scrolls. */
const FIGURE_MAX_SCREEN = 0.72
const FIGURE_MIN_HEIGHT = 96

/** The picture itself, rounded, at its own proportions — no frame, no
 *  letterbox (2026-09-12: a bordered 4:3 box around a phone screenshot read
 *  as "a square box with a small image inside"). Height follows the image's
 *  aspect between sane bounds; until the size is known, 4:3. */
export function MobileNativeChatImageThumb({
  uri,
  label,
  styles
}: {
  uri: string
  label: string
  styles: ChatMessageStyles
}) {
  const { height: windowHeight } = useWindowDimensions()
  const [width, setWidth] = useState(0)
  const aspect = useImageAspect(uri)
  const height =
    width > 0
      ? Math.min(
          Math.max(Math.round(width * aspect), FIGURE_MIN_HEIGHT),
          Math.round(windowHeight * FIGURE_MAX_SCREEN)
        )
      : FIGURE_MIN_HEIGHT
  return (
    <Pressable
      onPress={() => openImagePreview(uri, label)}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width)
        if (next > 0 && next !== width) {
          setWidth(next)
        }
      }}
      accessibilityRole="imagebutton"
      style={{ alignSelf: 'stretch' }}
    >
      <Image
        source={{ uri }}
        style={[styles.imageThumb, { width: '100%', height }]}
        resizeMode="contain"
        accessibilityLabel={label}
      />
    </Pressable>
  )
}

/** Several images in one message, side by side and scrollable sideways, the
 *  way the Claude app lays out a multi-image upload or the screenshots an
 *  agent read. A tap opens the viewer on that image, paging through the rest. */
export function MobileNativeChatImageStrip({
  uris,
  label,
  styles
}: {
  uris: string[]
  label: string
  styles: ChatMessageStyles
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Why a fixed height and no clipping: the strip sits inside an inverted
      // FlashList row, and a nested scroller whose height Android re-derives
      // mid-scroll made the row grow and the next row draw over it
      // (2026-09-13). The tiles are fixed-size, so the strip's height is known.
      style={styles.imageStripFrame}
      contentContainerStyle={styles.imageStrip}
      removeClippedSubviews={false}
      nestedScrollEnabled
      testID="chat-image-strip"
    >
      {uris.map((uri, index) => (
        <Pressable
          key={`${index}:${uri.slice(0, 40)}`}
          onPress={() => openImagePreview(uris, label, index)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`${label} ${index + 1} of ${uris.length}`}
        >
          <Image source={{ uri }} style={styles.imageTile} resizeMode="cover" />
        </Pressable>
      ))}
    </ScrollView>
  )
}

function useImageAspect(uri: string): number {
  const [aspect, setAspect] = useState(3 / 4)
  useEffect(() => {
    let live = true
    // The react-native mock in tests has no getSize; the 4:3 default stands.
    if (typeof Image.getSize !== 'function') {
      return undefined
    }
    Image.getSize(
      uri,
      (w, h) => {
        if (live && w > 0 && h > 0) {
          setAspect(h / w)
        }
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [uri])
  return aspect
}
