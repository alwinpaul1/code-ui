import { useCallback, useEffect, useState } from 'react'
import { Image, Modal, Pressable, ScrollView, StatusBar, useWindowDimensions, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { X } from 'lucide-react-native'
import {
  closeImagePreview,
  setImagePreviewIndex,
  useImagePreview,
  type ImagePreviewSource
} from '../session/image-preview-store'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { svgAspectRatio } from './markdown-image-source'
import { ZoomableImage } from './ZoomableImage'

/** Full-screen viewer for an image the app already holds (a phone upload's
 *  local file, a host thumbnail already fetched, a markdown figure read off
 *  the host). Pinch, pan and double-tap to read it (2026-09-19); tap the
 *  picture at fit, the scrim or the X to close. Dark scrim in both themes,
 *  like the Claude app's viewer. Mounted once, in the root layout, so any
 *  screen can open it. */
export function ImagePreviewModal(): React.JSX.Element | null {
  const preview = useImagePreview()
  const { width, height } = useWindowDimensions()
  const { colors, space } = useTheme()
  const [zoomed, setZoomed] = useState(false)
  const aspectRatios = useAspectRatios(preview?.sources ?? NO_SOURCES)
  const onZoomedChange = useCallback((value: boolean) => setZoomed(value), [])
  if (!preview) {
    return null
  }
  const barHeight = space.xl + space.lg + 40 + space.md
  const captionHeight = (space.lg + space.md) * 2 + 20
  const pictureHeight = Math.max(0, height - barHeight - captionHeight)
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeImagePreview}
    >
      <StatusBar barStyle="light-content" />
      {/* Why a gesture root of its own: a Modal is a separate native window on
          Android, and gesture-handler only sees touches under a root view in
          the same window. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Why not one Pressable around everything: the picture's own taps
            are gesture-handler's now, and a responder-system press underneath
            would also fire on the first tap of a double tap. The bar and the
            caption close on a tap; the picture closes itself at fit. */}
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
          {/* The close button owns a bar of its own above the picture, so it
              never sits on top of the image. */}
          <Pressable
            onPress={closeImagePreview}
            accessibilityRole="button"
            accessibilityLabel="Close image preview"
            style={{
              height: barHeight,
              paddingTop: space.xl + space.lg,
              paddingRight: space.md,
              alignItems: 'flex-end',
              justifyContent: 'flex-start'
            }}
          >
            <Pressable
              onPress={closeImagePreview}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)'
              })}
            >
              <X size={20} color="#fff" strokeWidth={2.2} />
            </Pressable>
          </Pressable>
          {/* Why a paged ScrollView: the Claude app's viewer swipes through the
              message's images and counts them ("5 of 6", 2026-09-12). Paging
              stops while a picture is zoomed in, so a pan moves the picture. */}
          <ScrollView
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            style={{ height: pictureHeight, flexGrow: 0 }}
            contentOffset={{ x: preview.index * width, y: 0 }}
            onMomentumScrollEnd={(event) =>
              setImagePreviewIndex(Math.round(event.nativeEvent.contentOffset.x / width))
            }
          >
            {preview.sources.map((source, index) => (
              <ZoomableImage
                key={`${index}:${sourceKey(source).slice(0, 40)}`}
                source={source}
                width={width}
                height={pictureHeight}
                aspectRatio={aspectRatios[sourceKey(source)]}
                accessibilityLabel={`${preview.label} ${index + 1} of ${preview.sources.length}`}
                onSingleTap={zoomed ? undefined : closeImagePreview}
                onZoomedChange={index === preview.index ? onZoomedChange : undefined}
              />
            ))}
          </ScrollView>
          <Pressable
            onPress={closeImagePreview}
            accessibilityRole="button"
            accessibilityLabel="Close image preview"
            style={{ flex: 1, paddingVertical: space.lg + space.md }}
          >
            <Txt
              variant="caption"
              align="center"
              style={{ color: colors.textInverse === '#fff' ? '#fff' : 'rgba(255,255,255,0.8)' }}
            >
              {preview.sources.length > 1
                ? `${preview.index + 1} of ${preview.sources.length}`
                : preview.label}
            </Txt>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const NO_SOURCES: ImagePreviewSource[] = []

function sourceKey(source: ImagePreviewSource): string {
  return source.kind === 'bitmap' ? source.uri : source.xml
}

/** Width over height per source, once known: an SVG's from its viewBox at
 *  once, a bitmap's from Image.getSize when it answers. Until then the
 *  picture fills its box and the zoom clamp is looser. */
function useAspectRatios(sources: ImagePreviewSource[]): Record<string, number> {
  const [ratios, setRatios] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    for (const source of sources) {
      const key = sourceKey(source)
      if (source.kind === 'svg') {
        setRatios((current) => (current[key] ? current : { ...current, [key]: svgAspectRatio(source.xml) }))
        continue
      }
      Image.getSize(
        source.uri,
        (w, h) => {
          if (!cancelled && w > 0 && h > 0) {
            setRatios((current) => (current[key] ? current : { ...current, [key]: w / h }))
          }
        },
        () => undefined
      )
    }
    return () => {
      cancelled = true
    }
  }, [sources])
  return ratios
}
