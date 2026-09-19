import { useEffect, useRef, useState } from 'react'
import { Image, Pressable, Text, View, type TextStyle } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { openImagePreviewSources } from '../session/image-preview-store'
import {
  isRemoteImageUrl,
  svgAspectRatio,
  type MarkdownImageResolver,
  type MarkdownImageSource
} from './markdown-image-source'

type Loaded = { source: MarkdownImageSource; aspectRatio: number }

/** What each url resolved to, per resolver (a document's figures) and for
 *  remote urls, so a remount draws the picture on its first render. Why:
 *  the run around a figure is remounted once the figure has its size (see
 *  MobileMarkdown), and a remount that started over from the link would lay
 *  the run out without the figure again, then grow it, which is the very
 *  layout the remount exists to avoid. Bounded by a document's figures. */
const loadedByResolver = new WeakMap<MarkdownImageResolver, Map<string, Loaded>>()
const loadedRemote = new Map<string, Loaded>()

function loadedCache(resolve: MarkdownImageResolver | undefined, url: string): Map<string, Loaded> | null {
  if (isRemoteImageUrl(url)) {
    return loadedRemote
  }
  if (!resolve) {
    return null
  }
  let cache = loadedByResolver.get(resolve)
  if (!cache) {
    cache = new Map()
    loadedByResolver.set(resolve, cache)
  }
  return cache
}

/**
 * An image block of a markdown document, drawn as the image, inside the
 * document's selectable prose run.
 *
 * A remote URL is handed to Image as it is. A file beside the document goes
 * through `resolve`, which reads it off the desktop; until that answers, and
 * if it never does, the block is the tappable link it has always been, so a
 * document with a figure the phone cannot fetch still reads. The image takes
 * the document's width at its own aspect ratio (a bitmap's from Image, an
 * SVG's from its viewBox), so a figure is never cropped or stretched.
 *
 * Why it sits INSIDE the run, as an inline view with a size of its own: a
 * figure that was its own View split the prose into two Texts, and Android
 * lets a selection cross an inline view but never a second Text. A thesis
 * write-up with a figure per section could be copied one section at a time
 * (2026-09-19, "the same copying issue is for md file previews too"). The
 * width comes from the document, measured once, because an inline view
 * cannot ask for a percentage of a Text.
 *
 * Tapping a drawn figure opens the full-screen viewer, where it can be
 * pinched to read the labels in it (2026-09-19).
 */
export function MobileMarkdownImage({
  alt,
  url,
  width,
  resolve,
  onOpen,
  onSized,
  styles
}: {
  alt: string
  url: string
  /** The document's width; 0 until measured, when the link is drawn instead. */
  width: number
  resolve?: MarkdownImageResolver
  onOpen: () => void
  /** Called with the url once the picture has a size, so the Text around
   *  it can lay itself out again (see MobileMarkdown's inline layout epoch). */
  onSized?: (url: string) => void
  styles: { link: TextStyle; imageCaptionInline: TextStyle }
}) {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(() =>
    loadedCache(resolve, url)?.get(url)
  )
  useEffect(() => {
    let cancelled = false
    const cache = loadedCache(resolve, url)
    const known = cache?.get(url)
    if (known) {
      setLoaded(known)
      return
    }
    setLoaded(undefined)
    const settle = (value: Loaded | null) => {
      if (value) {
        cache?.set(url, value)
      }
      if (!cancelled) {
        setLoaded(value)
      }
    }
    if (isRemoteImageUrl(url)) {
      Image.getSize(
        url,
        (w, h) => settle({ source: { kind: 'bitmap', uri: url }, aspectRatio: w > 0 && h > 0 ? w / h : 16 / 9 }),
        () => settle(null)
      )
    } else if (resolve) {
      void resolve(url).then((source) => {
        if (!source) {
          settle(null)
          return
        }
        if (source.kind === 'svg') {
          settle({ source, aspectRatio: svgAspectRatio(source.xml) })
          return
        }
        Image.getSize(
          source.uri,
          (w, h) => settle({ source, aspectRatio: w > 0 && h > 0 ? w / h : 16 / 9 }),
          () => settle(null)
        )
      })
    } else {
      settle(null)
    }
    return () => {
      cancelled = true
    }
  }, [resolve, url])

  const sized = loaded !== undefined && loaded !== null && width > 0
  const onSizedRef = useRef(onSized)
  onSizedRef.current = onSized
  useEffect(() => {
    if (sized) {
      onSizedRef.current?.(url)
    }
  }, [sized, url])

  if (!loaded || !(width > 0)) {
    return (
      <Text testID="markdown-image-link">
        <Text style={styles.link} onPress={onOpen}>
          {alt || 'Open image'}
        </Text>
        {'\n'}
        <Text style={styles.imageCaptionInline}>{url}</Text>
      </Text>
    )
  }
  const height = Math.max(1, Math.round(width / loaded.aspectRatio))
  const { source } = loaded
  return (
    <View style={{ width, height }}>
      <Pressable
        onPress={() => openImagePreviewSources([source], alt || url)}
        accessibilityRole="imagebutton"
        accessibilityLabel={alt || url}
        accessibilityHint="Opens the image full screen, where it can be zoomed"
        testID="markdown-image"
        style={{ width, height }}
      >
        {source.kind === 'svg' ? (
          <SvgXml xml={source.xml} width={width} height={height} />
        ) : (
          <Image
            source={{ uri: source.uri }}
            style={{ width, height }}
            resizeMode="contain"
            accessibilityLabel={alt || undefined}
          />
        )}
      </Pressable>
    </View>
  )
}
