import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Modal, Pressable, ScrollView, StatusBar, useWindowDimensions, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Check, Download, Pencil, X } from 'lucide-react-native'
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
import { useKeyboardDismissedOnOpen } from './use-keyboard-dismissed-on-open'
import type { MobileImageDownloadOutcome } from '../files/mobile-image-download'

/** Full-screen viewer for an image the app already holds (a phone upload's
 *  local file, a host thumbnail already fetched, a markdown figure read off
 *  the host). Pinch, pan and double-tap to read it (2026-09-19). It closes
 *  on the X, Back, or a deliberate swipe down at fit, and on nothing else
 *  (2026-10-13: a pinch read as a tap closed it under the reader's fingers,
 *  ZoomableImage.tsx says how). Opaque black in both themes, like the Claude
 *  app's gallery, so the chat never shows through. Mounted once, in the root
 *  layout, so any screen can open it. */
export function ImagePreviewModal({
  onSave
}: {
  /** Saves the picture on screen (the root layout passes the device's save
   *  picker, mobile-image-download-device.ts). Absent, no Download button. */
  onSave?: (uri: string) => Promise<MobileImageDownloadOutcome>
} = {}): React.JSX.Element | null {
  const preview = useImagePreview()
  const save = useViewerSave(onSave, preview?.uri ?? null)
  const { width, height } = useWindowDimensions()
  const { colors, space } = useTheme()
  const [zoomed, setZoomed] = useState(false)
  const aspectRatios = useAspectRatios(preview?.sources ?? NO_SOURCES)
  const onZoomedChange = useCallback((value: boolean) => setZoomed(value), [])
  // A photo chip sits right above the composer: opened with its keyboard up,
  // the viewer's window would otherwise sit under the keyboard until it took focus.
  useKeyboardDismissedOnOpen(preview !== null)
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
        {/* Why nothing around the picture closes on a tap: a stray touch
            beside a picture being pinched shut the viewer, and the reader
            reaches the X, Back or a swipe down on purpose. */}
        <View style={{ flex: 1, backgroundColor: VIEWER_BACKGROUND }}>
          {/* The close (and, on an editable photo, edit) buttons own a bar of
              their own above the picture, so neither ever sits on top of the
              image. */}
          <View
            style={{
              height: barHeight,
              paddingTop: space.xl + space.lg,
              paddingHorizontal: space.md,
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between'
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
            {/* The composer's own attachment: opens the markup editor on
                this exact photo, the one way into it (the Claude app's
                pencil, 2026-09-24, on the right since 2026-09-26; a tap on the chip opens this preview
                first, 2026-09-26). Absent
                for a markdown figure or a sent bubble. A picture the agent
                read or sent opens the same editor, its Done attaching the
                drawing to the composer (chat-image-markup-target.ts). The
                pencil sits left of download, as in the Claude app. */}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
            {preview.onEdit ? (
              <Pressable
                onPress={() => {
                  const onEdit = preview.onEdit
                  closeImagePreview()
                  onEdit?.()
                }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Edit image"
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)'
                })}
              >
                <Pencil size={20} color="#fff" strokeWidth={2.2} />
              </Pressable>
            ) : null}
            {save.available && preview.sources[preview.index]?.kind === 'bitmap' ? (
              <Pressable
                onPress={save.run}
                disabled={save.state === 'saving'}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={
                  save.state === 'saved' ? 'Saved' : save.state === 'failed' ? "Couldn't save" : 'Download image'
                }
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: save.state === 'saving' ? 0.6 : 1,
                  backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)'
                })}
              >
                {save.state === 'saved' ? (
                  <Check size={20} color="#fff" strokeWidth={2.2} />
                ) : (
                  <Download size={20} color="#fff" strokeWidth={2.2} />
                )}
              </Pressable>
            ) : null}
            </View>
          </View>
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
                onSwipeDown={closeImagePreview}
                onZoomedChange={index === preview.index ? onZoomedChange : undefined}
              />
            ))}
          </ScrollView>
          <View style={{ flex: 1, paddingVertical: space.lg + space.md }}>
            <Txt
              variant="caption"
              align="center"
              style={{ color: colors.textInverse === '#fff' ? '#fff' : 'rgba(255,255,255,0.8)' }}
            >
              {preview.sources.length > 1
                ? `${preview.index + 1} of ${preview.sources.length}`
                : preview.label}
            </Txt>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const NO_SOURCES: ImagePreviewSource[] = []
/** The same in light and dark: a photo reads against black, as in the Claude
 *  app's gallery, and the screen under the viewer must not show through. */
const VIEWER_BACKGROUND = '#000'
const SAVE_FEEDBACK_MS = 2000
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/** The Download button's state: what the last save of this picture did,
 *  shown for a moment, and a line naming a failure, since the viewer has no
 *  toast and a dead button reads the same as a slow one. */
function useViewerSave(
  onSave: ((uri: string) => Promise<MobileImageDownloadOutcome>) | undefined,
  uri: string | null
): { available: boolean; state: SaveState; run: () => void } {
  const [state, setState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [])
  useEffect(() => setState('idle'), [uri])
  const run = useCallback(() => {
    if (!onSave || !uri) {
      return
    }
    setState('saving')
    void onSave(uri)
      .catch((error: unknown): MobileImageDownloadOutcome => {
        console.warn(`[image-viewer] save failed: ${error instanceof Error ? error.message : String(error)}`)
        return { status: 'failed' }
      })
      .then((outcome) => {
        if (!live.current) {
          return
        }
        if (outcome.status === 'failed-left-incomplete') {
          console.warn(`[image-viewer] save failed, and an incomplete ${outcome.fileName} is left where it was saved`)
        } else if (outcome.status === 'failed') {
          console.warn('[image-viewer] save failed: the picture could not be written where it was chosen')
        }
        setState(outcome.status === 'saved' ? 'saved' : outcome.status === 'cancelled' ? 'idle' : 'failed')
        if (timer.current) {
          clearTimeout(timer.current)
        }
        timer.current = setTimeout(() => setState('idle'), SAVE_FEEDBACK_MS)
      })
  }, [onSave, uri])
  return { available: onSave !== undefined, state, run }
}

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
