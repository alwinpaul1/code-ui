import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StatusBar,
  useWindowDimensions,
  View
} from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'
import Svg, { Image as SvgImage, Path } from 'react-native-svg'
import { Check, Redo2, Undo2, X } from 'lucide-react-native'
import { closeImageMarkup, useImageMarkup } from '../session/image-markup-store'
import { loadMarkupImageSize } from './markup-image-size'
import { encodeMarkupOutput, loadMarkupSourceTraits } from './markup-image-output'
import { markupOutputFormat } from '../session/image-markup-format'
import {
  canRedoMarkupStroke,
  canUndoMarkupStroke,
  commitMarkupStroke,
  EMPTY_MARKUP_STROKE_STATE,
  hasMarkupStrokes,
  redoMarkupStroke,
  resolveMarkupCloseAction,
  undoMarkupStroke,
  type MarkupPoint,
  type MarkupStrokeState
} from '../session/image-markup-strokes'
import {
  displayPointToNatural,
  MARKUP_PEN_COLOR,
  markupOutputSize,
  markupPenWidth,
  markupStrokePathData
} from '../session/image-markup-geometry'
import { containedSize } from './zoomable-image-math'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { ConfirmModal } from './ConfirmModal'
import { useKeyboardDismissedOnOpen } from './use-keyboard-dismissed-on-open'

// The pen (MARKUP_PEN_COLOR) is deliberately theme-invariant: the Claude
// app's red on a light or a dark canvas alike. Every other colour in this
// screen comes from `useTheme()`.

type NaturalSize = { width: number; height: number }

/** Full-screen markup editor: draw red pen strokes over an attached photo,
 *  undo/redo them, and either discard the marks or flatten them onto the
 *  photo on Done. Mounted once in the root layout; opened with
 *  `openImageMarkup(uri, { onDone, onDiscard })` by the pencil in a composer
 *  photo's full-screen preview, the one way in (a tap on the chip opens that
 *  preview, 2026-09-26).
 *
 *  Flattening uses react-native-svg's native `toDataURL`, not a screenshot
 *  library: the photo and the strokes are both drawn inside one `<Svg>` (the
 *  photo as an SVG `<Image>`, matching the Claude app's markup flow), so
 *  asking that view for a bitmap at the photo's own resolution already
 *  contains both layers composited — no extra native dependency needed.
 *
 *  Copied from the Claude app (1.261009.20, `jgh`/`fl`): the bar is titled
 *  "Mark up image"; while Done writes the picture it adds "Saving…" and the
 *  screen can be neither closed nor drawn on; an opaque source is written as
 *  JPEG at 85, one with alpha as PNG (image-markup-format.ts). The bar keeps
 *  Code UI's own colours and sizes. */
export function MobileImageMarkupEditor(): React.JSX.Element | null {
  const session = useImageMarkup()
  const { colors, space, isDark } = useTheme()
  const { width, height } = useWindowDimensions()
  const svgRef = useRef<Svg>(null)
  const [natural, setNatural] = useState<NaturalSize | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [strokeState, setStrokeState] = useState<MarkupStrokeState>(EMPTY_MARKUP_STROKE_STATE)
  const [draftPoints, setDraftPoints] = useState<readonly MarkupPoint[]>([])
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [saving, setSaving] = useState(false)

  // A new session (even a reopen of the same photo) starts from a blank
  // canvas — keyed on `token`, not the uri, so picking the same photo twice
  // in a row cannot mistake the last session's strokes for this one's.
  useEffect(() => {
    setNatural(null)
    setLoadFailed(false)
    setStrokeState(EMPTY_MARKUP_STROKE_STATE)
    setDraftPoints([])
    setConfirmingDiscard(false)
    setSaving(false)
  }, [session?.token])

  useEffect(() => {
    if (!session) {
      return
    }
    let cancelled = false
    // Not Image.getSize alone: Android refuses a `data:` URL there, and a
    // marked-up photo's preview is one (markup-image-size.ts).
    loadMarkupImageSize(
      session.uri,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) {
          setNatural({ width: w, height: h })
        }
      },
      () => {
        if (!cancelled) {
          setLoadFailed(true)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [session?.token, session?.uri])

  const barHeight = space.xl + space.lg + 44 + space.md
  const box = { width, height: Math.max(0, height - barHeight) }
  const aspectRatio = natural && natural.height > 0 ? natural.width / natural.height : 0
  const drawn = containedSize(box, aspectRatio)
  const penWidth = natural ? markupPenWidth(natural.width, drawn.width) : 0

  const commitDraft = useCallback((points: readonly MarkupPoint[]) => {
    setDraftPoints([])
    if (points.length === 0) {
      return
    }
    setStrokeState((state) => commitMarkupStroke(state, { points }))
  }, [])

  const addDraftPoint = useCallback(
    (x: number, y: number, replace: boolean) => {
      if (saving || !natural || drawn.width <= 0 || drawn.height <= 0) {
        return
      }
      const point = displayPointToNatural({ x, y }, drawn, natural)
      setDraftPoints((prev) => (replace ? [point] : [...prev, point]))
    },
    [saving, natural, drawn.width, drawn.height]
  )

  // Reads this render's draftPoints directly (not through a setState updater,
  // which React may invoke more than once) so a finished stroke is committed
  // exactly once.
  const endDraftStroke = useCallback(() => {
    commitDraft(draftPoints)
  }, [commitDraft, draftPoints])

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart((event) => {
      runOnJS(addDraftPoint)(event.x, event.y, true)
    })
    .onUpdate((event) => {
      runOnJS(addDraftPoint)(event.x, event.y, false)
    })
    .onEnd(() => {
      runOnJS(endDraftStroke)()
    })

  // The pencil on a photo chip, right above the composer's keyboard.
  useKeyboardDismissedOnOpen(session !== null)
  if (!session) {
    return null
  }

  const handleClose = (): void => {
    // The Claude app's sheet cannot be dismissed while it saves; neither can
    // this, or Back would drop the marks the flatten is writing.
    if (saving) {
      return
    }
    if (resolveMarkupCloseAction(strokeState) === 'confirm-discard') {
      setConfirmingDiscard(true)
      return
    }
    closeImageMarkup()
  }

  const handleDiscard = (): void => {
    session.onDiscard?.()
    closeImageMarkup()
  }

  const handleDone = (): void => {
    if (saving) {
      return
    }
    if (!hasMarkupStrokes(strokeState) || !natural) {
      // Nothing drawn (or the photo never loaded): closing is the same as X,
      // and re-encoding an unmarked photo would only lose quality for nothing.
      closeImageMarkup()
      return
    }
    const svg = svgRef.current
    if (!svg) {
      closeImageMarkup()
      return
    }
    const format = markupOutputFormat(loadMarkupSourceTraits(session.uri))
    setSaving(true)
    svg.toDataURL((png) => {
      void encodeMarkupOutput(png, format).then((result) => {
        session.onDone(result)
        closeImageMarkup()
      })
    }, markupOutputSize(natural))
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {/* Own gesture root: a Modal is a separate native window on Android,
          and gesture-handler only sees touches under a root in the same
          window (same reasoning as ImagePreviewModal). */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <View
            style={{
              height: barHeight,
              paddingTop: space.xl + space.lg,
              paddingHorizontal: space.md,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: colors.bgPanel,
              borderBottomWidth: 1,
              borderBottomColor: colors.border
            }}
          >
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <TopBarButton
                accessibilityLabel="Close"
                onPress={handleClose}
                disabled={saving}
                background={colors.bgRaised}
              >
                <X size={20} color={colors.text} strokeWidth={2.2} />
              </TopBarButton>
              <TopBarButton
                accessibilityLabel="Undo"
                onPress={() => setStrokeState(undoMarkupStroke)}
                disabled={saving || !canUndoMarkupStroke(strokeState)}
                background={colors.bgRaised}
              >
                <Undo2
                  size={20}
                  color={canUndoMarkupStroke(strokeState) ? colors.text : colors.textMuted}
                  strokeWidth={2.2}
                />
              </TopBarButton>
              <TopBarButton
                accessibilityLabel="Redo"
                onPress={() => setStrokeState(redoMarkupStroke)}
                disabled={saving || !canRedoMarkupStroke(strokeState)}
                background={colors.bgRaised}
              >
                <Redo2
                  size={20}
                  color={canRedoMarkupStroke(strokeState) ? colors.text : colors.textMuted}
                  strokeWidth={2.2}
                />
              </TopBarButton>
            </View>
            <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: space.sm }}>
              <Txt variant="body" weight="semibold" numberOfLines={1}>
                Mark up image
              </Txt>
              {saving ? (
                <Txt variant="caption" tone="secondary" numberOfLines={1} accessibilityLiveRegion="polite">
                  Saving…
                </Txt>
              ) : null}
            </View>
            <TopBarButton accessibilityLabel="Done" onPress={handleDone} disabled={saving} background={colors.accent}>
              <Check size={20} color={colors.onAccent} strokeWidth={2.6} />
            </TopBarButton>
          </View>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {loadFailed ? (
              <Txt variant="body" tone="secondary">
                Couldn't load image
              </Txt>
            ) : !natural ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <GestureDetector gesture={pan}>
                <View style={{ width: drawn.width, height: drawn.height }} testID="markup-canvas">
                  <Svg
                    ref={svgRef}
                    width={drawn.width}
                    height={drawn.height}
                    viewBox={`0 0 ${natural.width} ${natural.height}`}
                  >
                    <SvgImage
                      href={session.uri}
                      x={0}
                      y={0}
                      width={natural.width}
                      height={natural.height}
                      preserveAspectRatio="none"
                    />
                    {strokeState.strokes.map((stroke, index) => (
                      <Path
                        key={index}
                        d={markupStrokePathData(stroke)}
                        stroke={MARKUP_PEN_COLOR}
                        strokeWidth={penWidth}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {draftPoints.length > 0 ? (
                      <Path
                        d={markupStrokePathData({ points: draftPoints })}
                        stroke={MARKUP_PEN_COLOR}
                        strokeWidth={penWidth}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                  </Svg>
                </View>
              </GestureDetector>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
      <ConfirmModal
        visible={confirmingDiscard}
        title="Discard markup?"
        confirmLabel="Discard"
        destructive
        onConfirm={handleDiscard}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </Modal>
  )
}

function TopBarButton({
  accessibilityLabel,
  onPress,
  disabled,
  background,
  children
}: {
  accessibilityLabel: string
  onPress: () => void
  disabled?: boolean
  background: string
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={disabled ? undefined : onPress}
      hitSlop={8}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
        opacity: disabled ? 0.5 : 1
      }}
    >
      {children}
    </Pressable>
  )
}
