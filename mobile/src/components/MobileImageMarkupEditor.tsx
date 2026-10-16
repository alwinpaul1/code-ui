import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  StatusBar,
  useWindowDimensions,
  View
} from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Image as SvgImage, Path } from 'react-native-svg'
import { closeImageMarkup, peekImageMarkup, useImageMarkup } from '../session/image-markup-store'
import { closeImagePreview } from '../session/image-preview-store'
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
import { imageMarkupPalette } from '../theme/image-markup-palette'
import { Txt } from '../ui/Txt'
import { ConfirmModal } from './ConfirmModal'
import { useKeyboardDismissedOnOpen } from './use-keyboard-dismissed-on-open'
import { ImageMarkupBar, MARKUP_BAR_RETURN_MS, useScreenReaderRef } from './ImageMarkupBar'

// The pen (MARKUP_PEN_COLOR) is deliberately theme-invariant: the Claude
// app's red on its black canvas in either scheme. Every other colour in this
// screen comes from `useTheme()` (imageMarkupPalette).

type NaturalSize = { width: number; height: number }

/** How long Done waits for the flatten and the JPEG write before it gives the
 *  screen back; a 2000 px picture takes a second or two on a phone. */
const SAVE_TIMEOUT_MS = 30_000

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
 *  Laid out as the Claude app's (com.anthropic.claude 1.261013.20, `brh.c`,
 *  `zqh`, `vqh`, decompiled 2026-10-16): the photo fills a black screen, and
 *  a bar floats over its top inside the status-bar inset, 16/5 dp padding and
 *  8 dp gaps (zqh.java:110-116, `j7w.k`): a round Close, an Undo | Redo pill
 *  with a 20 dp hairline between (vqh.b), and, pushed to the end, a round
 *  Done whose check is clay and which stays disabled until something is drawn
 *  (zqh.java:145-167). The bar fades out while a stroke is drawn and comes
 *  back 400 ms after it ends, unless a screen reader is on (`mki.R`/m7d).
 *  "Mark up image" names the screen for a screen reader only (xqh.java:85-93);
 *  while Done writes the picture, Close and Done are disabled with "Saving…"
 *  as their reason (brh.java:207, d040.v) and the screen cannot be drawn on.
 *  An opaque source is written as JPEG at 85, one with alpha as PNG
 *  (image-markup-format.ts). */
export function MobileImageMarkupEditor(): React.JSX.Element | null {
  const session = useImageMarkup()
  const { scheme, space } = useTheme()
  const palette = imageMarkupPalette(scheme)
  const { width, height } = useWindowDimensions()
  const svgRef = useRef<Svg>(null)
  const [natural, setNatural] = useState<NaturalSize | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [strokeState, setStrokeState] = useState<MarkupStrokeState>(EMPTY_MARKUP_STROKE_STATE)
  const [draftPoints, setDraftPoints] = useState<readonly MarkupPoint[]>([])
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [saving, setSaving] = useState(false)
  /** The bar is faded out while a stroke is drawn. */
  const [barHidden, setBarHidden] = useState(false)
  const barTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const screenReaderRef = useScreenReaderRef()
  const insets = useSafeAreaInsets()
  /** The stroke being drawn, kept current outside renders (endDraftStroke). */
  const draftRef = useRef<readonly MarkupPoint[]>([])
  /** The save in flight, so a flatten answering after it was given up on is
   *  dropped; null while nothing saves. Read by the gesture too, which may
   *  run with an older render's closures. */
  const savingRef = useRef<object | null>(null)

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
    setBarHidden(false)
    clearBarTimer(barTimerRef)
    draftRef.current = []
    savingRef.current = null
  }, [session?.token])

  useEffect(() => () => {
    savingRef.current = null
    clearBarTimer(barTimerRef)
  }, [])

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

  // The photo is fitted to the whole window; the bar floats over it.
  const box = { width, height }
  const aspectRatio = natural && natural.height > 0 ? natural.width / natural.height : 0
  const drawn = containedSize(box, aspectRatio)
  const penWidth = natural ? markupPenWidth(natural.width, drawn.width) : 0

  const addDraftPoint = useCallback(
    (x: number, y: number, replace: boolean) => {
      if (savingRef.current !== null || !natural || drawn.width <= 0 || drawn.height <= 0) {
        return
      }
      const point = displayPointToNatural({ x, y }, drawn, natural)
      draftRef.current = replace ? [point] : [...draftRef.current, point]
      setDraftPoints(draftRef.current)
      if (replace && !screenReaderRef.current) {
        clearBarTimer(barTimerRef)
        setBarHidden(true)
      }
    },
    [natural, drawn.width, drawn.height, screenReaderRef]
  )

  // Commits from the ref, not from a render's draftPoints: the gesture's
  // callbacks hold the closures of the render they were built in, and a drag
  // that ends on its first sample sends its end before the canvas re-renders,
  // so the render's draft was still empty and the dot was lost. Not through a
  // setState updater either, which React may run more than once.
  const endDraftStroke = useCallback(() => {
    const points = draftRef.current
    draftRef.current = []
    setDraftPoints([])
    clearBarTimer(barTimerRef)
    barTimerRef.current = setTimeout(() => {
      barTimerRef.current = null
      setBarHidden(false)
    }, MARKUP_BAR_RETURN_MS)
    if (points.length === 0) {
      return
    }
    setStrokeState((state) => commitMarkupStroke(state, { points }))
  }, [])

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
    // this, or Back would drop the marks the flatten is writing. The ref, not
    // the render: two taps can land before the re-render.
    if (savingRef.current !== null) {
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
    // Not while saving, and, as in the Claude app, not with a stroke in
    // progress: a second finger's Done would flatten the half-drawn line.
    if (savingRef.current !== null || draftRef.current.length > 0) {
      return
    }
    if (!hasMarkupStrokes(strokeState) || !natural) {
      // Done is disabled until something is drawn, as in the Claude app; a
      // tap that lands anyway does nothing rather than re-encode an unmarked
      // photo for nothing.
      return
    }
    const svg = svgRef.current
    if (!svg) {
      closeImageMarkup()
      return
    }
    const format = markupOutputFormat(loadMarkupSourceTraits(session.uri))
    const attempt = {}
    savingRef.current = attempt
    setSaving(true)
    // Delivered and closed only while this save is the live one for the
    // session it started in: a token check, since the ref is reset in an
    // effect that can run after the store has already moved on.
    const token = session.token
    const current = (): boolean => savingRef.current === attempt && peekImageMarkup()?.token === token
    const giveUp = (why: string): void => {
      clearTimeout(timer)
      if (!current()) {
        return
      }
      savingRef.current = null
      setSaving(false)
      console.warn(`[markup] the marked-up picture was not saved: ${why}; the editor is open again`)
    }
    // Saving holds Close and Back, so a flatten that never answers (react-
    // native-svg can drop the callback) must not hold them for good.
    const timer = setTimeout(() => giveUp(`the flatten never answered in ${SAVE_TIMEOUT_MS / 1000} s`), SAVE_TIMEOUT_MS)
    const finish = async (png: string): Promise<void> => {
      if (!current()) {
        return
      }
      const result = await encodeMarkupOutput(png, format)
      if (!current()) {
        return
      }
      clearTimeout(timer)
      session.onDone(result)
      savingRef.current = null
      closeImageMarkup()
    }
    try {
      svg.toDataURL((png) => {
        finish(png).catch((error: unknown) => giveUp(describeError(error)))
      }, markupOutputSize(natural))
    } catch (error) {
      giveUp(describeError(error))
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
      // The preview's pencil leaves the preview up so the two Modals never swap in one tick
      // (Android dropped this window when they did, 2026-10-14); it gives way once this one shows.
      onShow={closeImagePreview}
    >
      {/* The canvas is black in both schemes, so the status bar is light on it. */}
      <StatusBar barStyle="light-content" />
      {/* Own gesture root: a Modal is a separate native window on Android,
          and gesture-handler only sees touches under a root in the same
          window (same reasoning as ImagePreviewModal). */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          style={{ flex: 1, backgroundColor: palette.canvas }}
          accessibilityLabel="Mark up image"
          testID="markup-screen"
        >
          {/* The photo first and the bar after it: the bar paints over the
              photo by source order, with no z-index. */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {loadFailed ? (
              <Txt
                variant="body"
                style={{ color: palette.canvasText, textAlign: 'center', paddingHorizontal: space.xl }}
              >
                Preview unavailable
              </Txt>
            ) : !natural ? (
              <ActivityIndicator color={palette.canvasText} />
            ) : (
              <GestureDetector gesture={pan}>
                <View style={{ width: drawn.width, height: drawn.height }} testID="markup-canvas">
                  <Svg
                    ref={svgRef}
                    width={drawn.width}
                    height={drawn.height}
                    viewBox={`0 0 ${natural.width} ${natural.height}`}
                    // The output size rounds width and height apart, so its
                    // shape can differ from the viewBox by under a pixel;
                    // letterboxing that left a transparent strip, black in a
                    // JPEG (Opus review). Stretching it is invisible.
                    preserveAspectRatio="none"
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

          <ImageMarkupBar
            palette={palette}
            insetTop={insets.top}
            hidden={barHidden}
            saving={saving}
            canUndo={canUndoMarkupStroke(strokeState)}
            canRedo={canRedoMarkupStroke(strokeState)}
            hasStrokes={hasMarkupStrokes(strokeState)}
            onClose={handleClose}
            onUndo={() => setStrokeState(undoMarkupStroke)}
            onRedo={() => setStrokeState(redoMarkupStroke)}
            onDone={handleDone}
          />
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

function clearBarTimer(timer: { current: ReturnType<typeof setTimeout> | null }): void {
  if (timer.current !== null) {
    clearTimeout(timer.current)
    timer.current = null
  }
}
