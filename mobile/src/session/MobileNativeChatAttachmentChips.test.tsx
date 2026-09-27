import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatAttachmentChips } from './MobileNativeChatAttachmentChips'
import { openImageMarkup, peekImageMarkup, resetImageMarkupForTests } from './image-markup-store'
import { peekImagePreview, resetImagePreviewForTests } from './image-preview-store'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { NO_NATIVE_CHAT_IMAGE_ATTACHMENTS } from './mobile-native-chat-image-scope-state'
import { methodNotFound, ok } from './use-mobile-native-chat-image-attachments.test-support'
import { useMobileNativeChatImageMarkup } from './use-mobile-native-chat-image-markup'
import { useNativeChatAttachmentScopeWriters } from './use-native-chat-attachment-scope-writers'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Image: Object.assign((props: Record<string, unknown>) => React.createElement('Image', props), {
      getSize: vi.fn()
    }),
    Modal: 'Modal',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StatusBar: 'StatusBar',
    Text: 'Text',
    View: 'View',
    StyleSheet: { create: <T,>(styles: T) => styles },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 400, height: 800 })
  }
})

vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }))

vi.mock('lucide-react-native', () => ({ FileText: 'FileText', Film: 'Film', Pencil: 'Pencil', X: 'X' }))

vi.mock('../components/ZoomableImage', () => ({ ZoomableImage: 'ZoomableImage' }))

// 2026-09-26, the user: a tap on a composer photo opens it full-screen first,
// the way the Claude app does, with a pencil there for markup and an X to
// close. The chip itself carries no pencil (2026-09-24: a white circle over
// the picture, beside the remove X). From 360ef269 to this change a tap went
// straight into markup. Everything here is real except the platform views:
// the strip, the one full-screen viewer the root layout mounts, and the store
// between them.

type Scheme = 'light' | 'dark'
const SCHEMES: Scheme[] = ['light', 'dark']
const PALETTE = { light: lightColors, dark: darkColors }

const PHOTO: PendingNativeChatImage = { id: 'img-1', path: '/tmp/a.png', previewUri: 'file:///a.jpg' }
const SECOND: PendingNativeChatImage = { id: 'img-2', path: '/tmp/b.png', previewUri: 'file:///b.jpg' }
const THIRD: PendingNativeChatImage = { id: 'img-3', path: '/tmp/c.png', previewUri: 'file:///c.jpg' }
const MARKUP_SCOPE = 'h\0w\0tab'

type ChipProps = Parameters<typeof MobileNativeChatAttachmentChips>[0]

function screen(scheme: Scheme, props: ChipProps) {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileNativeChatAttachmentChips {...props} />
      <ImagePreviewModal />
    </ThemeProvider>
  )
}

function pressables(renderer: ReactTestRenderer, label: string): ReactTestInstance[] {
  return renderer.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)
}

function thumbnails(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'imagebutton'
  )
}

/** The viewer is the only Modal on this screen; the strip never opens one. */
function viewer(renderer: ReactTestRenderer): ReactTestInstance | null {
  return renderer.root.findAll((node) => String(node.type) === 'Modal')[0] ?? null
}

function pictureInViewer(renderer: ReactTestRenderer): string | undefined {
  const picture = viewer(renderer)?.findAll((node) => String(node.type) === 'ZoomableImage')[0]
  return picture?.props.source?.uri
}

function chipPictures(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => String(node.type) === 'Image')
    .filter((node) => !viewer(renderer)?.findAll((inner) => inner === node).length)
    .map((node) => node.props.source.uri)
}

function tap(node: ReactTestInstance | undefined): void {
  expect(node).toBeDefined()
  act(() => {
    node!.props.onPress()
  })
}

describe('a photo in the attachment strip opens full-screen first', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetImagePreviewForTests()
    resetImageMarkupForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })

  function draw(scheme: Scheme, props: ChipProps): ReactTestRenderer {
    act(() => {
      renderer = create(screen(scheme, props))
    })
    return renderer!
  }

  it.each(SCHEMES)('opens the preview, not markup, on a tap on the only photo (%s)', (scheme) => {
    const onEditAttachment = vi.fn()
    const screenNow = draw(scheme, { attachments: [PHOTO], onEditAttachment, onRemoveAttachment: vi.fn() })
    expect(viewer(screenNow)).toBeNull()

    tap(thumbnails(screenNow)[0])

    expect(onEditAttachment).not.toHaveBeenCalled()
    expect(pictureInViewer(screenNow)).toBe('file:///a.jpg')
    expect(pressables(screenNow, 'Edit image')).toHaveLength(1)
    expect(pressables(screenNow, 'Close')).toHaveLength(1)
    // The strip is drawn in the reader's own theme, under the viewer's scrim.
    const chip = screenNow.root.find(
      (node) => String(node.type) === 'View' && node.props.style?.height === 60 && node.props.style?.width === 60
    )
    expect(chip.props.style).toMatchObject({
      borderColor: PALETTE[scheme].border,
      backgroundColor: PALETTE[scheme].bgRaised
    })
  })

  it.each(SCHEMES)('opens markup on the tapped photo from the preview\'s pencil (%s)', (scheme) => {
    const onEditAttachment = vi.fn()
    const screenNow = draw(scheme, { attachments: [PHOTO], onEditAttachment })
    tap(thumbnails(screenNow)[0])

    tap(pressables(screenNow, 'Edit image')[0])

    expect(onEditAttachment).toHaveBeenCalledExactlyOnceWith('img-1', 'file:///a.jpg')
    // The viewer gives way to the editor rather than sitting under it.
    expect(viewer(screenNow)).toBeNull()
    expect(peekImagePreview()).toBeNull()
  })

  it.each(SCHEMES)('closes back to the composer with the chip as it was (%s)', (scheme) => {
    const onEditAttachment = vi.fn()
    const onRemoveAttachment = vi.fn()
    const screenNow = draw(scheme, { attachments: [PHOTO], onEditAttachment, onRemoveAttachment })
    tap(thumbnails(screenNow)[0])

    tap(pressables(screenNow, 'Close')[0])

    expect(viewer(screenNow)).toBeNull()
    expect(onEditAttachment).not.toHaveBeenCalled()
    expect(onRemoveAttachment).not.toHaveBeenCalled()
    expect(chipPictures(screenNow)).toEqual(['file:///a.jpg'])
    expect(pressables(screenNow, 'Remove image')).toHaveLength(1)
  })

  it.each(SCHEMES)('opens the photo that was tapped, and marks up that one, among several (%s)', (scheme) => {
    const onEditAttachment = vi.fn()
    const screenNow = draw(scheme, { attachments: [PHOTO, SECOND, THIRD], onEditAttachment })
    expect(chipPictures(screenNow)).toEqual(['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg'])

    tap(thumbnails(screenNow)[1])
    expect(pictureInViewer(screenNow)).toBe('file:///b.jpg')
    tap(pressables(screenNow, 'Edit image')[0])

    expect(onEditAttachment).toHaveBeenCalledExactlyOnceWith('img-2', 'file:///b.jpg')
  })

  it.each(SCHEMES)('keeps every chip free of a pencil, one photo or several (%s)', (scheme) => {
    const screenNow = draw(scheme, { attachments: [PHOTO], onEditAttachment: vi.fn(), onRemoveAttachment: vi.fn() })
    expect(pressables(screenNow, 'Edit image')).toHaveLength(0)
    act(() => {
      screenNow.update(
        screen(scheme, { attachments: [PHOTO, SECOND, THIRD], onEditAttachment: vi.fn(), onRemoveAttachment: vi.fn() })
      )
    })
    expect(pressables(screenNow, 'Edit image')).toHaveLength(0)
    expect(thumbnails(screenNow).map((node) => node.props.accessibilityLabel)).toEqual([
      'Preview image',
      'Preview image',
      'Preview image'
    ])
  })

  it.each(SCHEMES)('shows the marked-up picture on the chip, and in the preview, once markup is back (%s)', (scheme) => {
    const screenNow = draw(scheme, { attachments: [PHOTO, SECOND], onEditAttachment: vi.fn() })
    const marked = { ...PHOTO, path: '/tmp/a-marked.png', previewUri: 'data:image/png;base64,ZZZZ' }
    act(() => {
      screenNow.update(screen(scheme, { attachments: [marked, SECOND], onEditAttachment: vi.fn() }))
    })

    expect(chipPictures(screenNow)).toEqual(['data:image/png;base64,ZZZZ', 'file:///b.jpg'])
    tap(thumbnails(screenNow)[0])
    expect(pictureInViewer(screenNow)).toBe('data:image/png;base64,ZZZZ')
  })

  it('offers no pencil in the preview of a photo still uploading', () => {
    const onEditAttachment = vi.fn()
    const screenNow = draw('light', { attachments: [{ ...PHOTO, path: '', uploading: true }], onEditAttachment })
    tap(thumbnails(screenNow)[0])
    expect(pictureInViewer(screenNow)).toBe('file:///a.jpg')
    expect(pressables(screenNow, 'Edit image')).toHaveLength(0)
    expect(onEditAttachment).not.toHaveBeenCalled()
  })

  it('offers no pencil in the preview when the caller has nowhere to send markup', () => {
    const screenNow = draw('dark', { attachments: [PHOTO] })
    tap(thumbnails(screenNow)[0])
    expect(pictureInViewer(screenNow)).toBe('file:///a.jpg')
    expect(pressables(screenNow, 'Edit image')).toHaveLength(0)
  })

  // 2026-09-27 review: a video frame's preview is a small copy kept only for
  // the chip strip — the pencil's re-upload (replaceAttachment) would
  // silently replace the real, full-size frame already on the desktop with
  // that small copy. No pencil at all on a frame chip, uploaded or not.
  it('offers no pencil on a video-frame chip, even with an editor to hand', () => {
    const onEditAttachment = vi.fn()
    const frame: PendingNativeChatImage = {
      id: 'frame-1',
      path: '/tmp/frame-1.png',
      previewUri: 'data:image/jpeg;base64,f1',
      videoFrame: {
        groupId: 'g1',
        index: 1,
        total: 3,
        sourceName: 'clip.mp4',
        durationLabel: '10 s',
        intervalLabel: 'every 3.3 s',
        intervalMs: 3300,
        sourceSizeLabel: '30 MB',
        stoppedEarly: false
      }
    }
    const screenNow = draw('light', { attachments: [frame], onEditAttachment })
    tap(thumbnails(screenNow)[0])
    expect(pictureInViewer(screenNow)).toBe('data:image/jpeg;base64,f1')
    expect(pressables(screenNow, 'Edit image')).toHaveLength(0)
    expect(onEditAttachment).not.toHaveBeenCalled()
  })

  it('gives a document chip nothing to open and nothing to draw on', () => {
    const screenNow = draw('light', {
      attachments: [{ id: 'doc-1', path: '/tmp/a.pdf', previewUri: 'file:///a.pdf', kind: 'file', name: 'a.pdf' }],
      onEditAttachment: vi.fn()
    })
    expect(thumbnails(screenNow)).toHaveLength(0)
    expect(pressables(screenNow, 'Edit image')).toHaveLength(0)
  })

  it('draws no strip at all with no attachments', () => {
    const screenNow = draw('light', { attachments: [], onEditAttachment: vi.fn() })
    expect(screenNow.root.findAll((node) => String(node.type) === 'ScrollView')).toHaveLength(0)
    expect(viewer(screenNow)).toBeNull()
  })

  // From the pencil onward: the same arrow the overlay hands the composer
  // (the overlay's own copy is pinned in MobileNativeChatOverlay.test.ts), the
  // real markup hook, which 72f03556 and 4b70940f taught to say when Done
  // could not save, and the real chip store it writes. Opening the preview
  // first must not lose that on the way.
  function markupComposer(scheme: Scheme, client: RpcClient, showToast: (message: string, ms?: number) => void) {
    function Composer(): React.JSX.Element {
      const attachments = useNativeChatImageAttachmentsStore(
        (state) => state.byScope[MARKUP_SCOPE] ?? NO_NATIVE_CHAT_IMAGE_ATTACHMENTS
      )
      const { markAttachmentReuploading, replaceAttachmentImage } = useNativeChatAttachmentScopeWriters()
      const replace = useMobileNativeChatImageMarkup({
        client,
        getActiveWorktreeConnectionId: async () => null,
        scopeKey: MARKUP_SCOPE,
        markAttachmentReuploading,
        replaceAttachmentImage,
        showToast
      })
      return (
        <MobileNativeChatAttachmentChips
          attachments={attachments}
          onRemoveAttachment={() => {}}
          onEditAttachment={(id, uri) => openImageMarkup(uri, { onDone: (result) => void replace(id, result.base64) })}
        />
      )
    }
    useNativeChatImageAttachmentsStore.getState().update(() => ({ [MARKUP_SCOPE]: [PHOTO] }))
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Composer />
          <ImagePreviewModal />
        </ThemeProvider>
      )
    })
    const screenNow = renderer!
    tap(thumbnails(screenNow)[0])
    tap(pressables(screenNow, 'Edit image')[0])
    const editor = peekImageMarkup()
    expect(editor?.uri).toBe('file:///a.jpg')
    return { screenNow, done: (base64: string) => act(() => editor!.onDone({ base64 })) }
  }

  function uploadRings(renderer: ReactTestRenderer): ReactTestInstance[] {
    return renderer.root.findAll((node) => String(node.type) === 'View' && node.props.testID === 'attachment-uploading')
  }

  it.each(SCHEMES)('still says markup was not saved when Done cannot upload, via the preview\'s pencil (%s)', async (scheme) => {
    const showToast = vi.fn()
    const refused = {
      sendRequest: vi.fn(async () => ({
        id: 'save',
        ok: false,
        error: { code: 'failed', message: 'disk full' },
        _meta: { runtimeId: 'r' }
      }))
    } as unknown as RpcClient
    const { screenNow, done } = markupComposer(scheme, refused, showToast)

    done('ZZZZ')
    await act(async () => {
      await vi.waitFor(() => expect(showToast).toHaveBeenCalled())
    })

    expect(showToast).toHaveBeenCalledExactlyOnceWith('Markup not saved — the photo is still attached without it', 1500)
    // The photo is back as it was, settled, so what the chip shows is what a send takes.
    expect(chipPictures(screenNow)).toEqual(['file:///a.jpg'])
    expect(uploadRings(screenNow)).toHaveLength(0)
    expect(useNativeChatImageAttachmentsStore.getState().byScope[MARKUP_SCOPE]).toEqual([PHOTO])
  })

  // 2026-09-26: a send tapped just after Done pasted the photo without its
  // marks, because the chip looked settled while the marks were still on
  // their way to the host. The chip now shows the marks under the loading
  // ring until they land, in the reader's own theme.
  it.each(SCHEMES)('draws the marks under the loading ring until the host has them (%s)', async (scheme) => {
    const save = Promise.withResolvers<RpcResponse>()
    const client = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'clipboard.startImageUpload' ? methodNotFound('start') : save.promise
      )
    } as unknown as RpcClient
    const { screenNow, done } = markupComposer(scheme, client, vi.fn())

    done('ZZZZ')

    expect(chipPictures(screenNow)).toEqual(['data:image/png;base64,ZZZZ'])
    const ring = uploadRings(screenNow)
    expect(ring).toHaveLength(1)
    expect(ring[0]!.props.style).toMatchObject({ backgroundColor: PALETTE[scheme].bgOverlay })
    const spinner = ring[0]!.findAll((node) => String(node.type) === 'ActivityIndicator')[0]
    expect(spinner?.props.color).toBe(PALETTE[scheme].text)
    // Nothing to take out or mark up again while the marks upload.
    expect(pressables(screenNow, 'Remove image')).toHaveLength(0)
    tap(thumbnails(screenNow)[0])
    expect(pictureInViewer(screenNow)).toBe('data:image/png;base64,ZZZZ')
    expect(pressables(screenNow, 'Edit image')).toHaveLength(0)
    tap(pressables(screenNow, 'Close')[0])

    await act(async () => {
      save.resolve(ok('save', '/tmp/a-marked.png'))
      await vi.waitFor(() => expect(uploadRings(screenNow)).toHaveLength(0))
    })
    expect(chipPictures(screenNow)).toEqual(['data:image/png;base64,ZZZZ'])
    expect(pressables(screenNow, 'Remove image')).toHaveLength(1)
    expect(useNativeChatImageAttachmentsStore.getState().byScope[MARKUP_SCOPE]).toEqual([
      expect.objectContaining({ id: 'img-1', path: '/tmp/a-marked.png', previewUri: 'data:image/png;base64,ZZZZ' })
    ])
  })
})

// 2026-09-27: an over-the-cap video's frames take a while to read. The strip
// shows one progress chip while that runs — "Reading frames 5/20…" — ahead
// of any finished frame chips, with a cancel affordance of its own.
describe('the video-frame extraction progress chip', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function draw(scheme: Scheme, props: ChipProps): ReactTestRenderer {
    act(() => {
      renderer = create(screen(scheme, props))
    })
    return renderer!
  }

  it.each(SCHEMES)('shows how many frames are in, in the reader\'s own theme (%s)', (scheme) => {
    const screenNow = draw(scheme, {
      attachments: [],
      videoFrameExtraction: { batch: 'batch-1', done: 5, total: 20 }
    })
    const text = screenNow.root.findAll(
      (node) => String(node.type) === 'Txt' || String(node.type) === 'Text'
    )
    expect(text.some((node) => JSON.stringify(node.props.children).includes('Reading frames 5/20'))).toBe(true)
    const chip = screenNow.root.find(
      (node) => String(node.type) === 'View' && node.props.style?.height === 60 && node.props.style?.maxWidth === 210
    )
    expect(chip.props.style).toMatchObject({
      borderColor: PALETTE[scheme].border,
      backgroundColor: PALETTE[scheme].bgRaised
    })
  })

  it('draws the strip for the progress chip alone, with no other attachments yet', () => {
    const screenNow = draw('light', {
      attachments: [],
      videoFrameExtraction: { batch: 'batch-1', done: 0, total: 20 }
    })
    expect(screenNow.root.findAll((node) => String(node.type) === 'ScrollView')).toHaveLength(1)
  })

  it('draws no strip at all with neither attachments nor an extraction running', () => {
    const screenNow = draw('light', { attachments: [] })
    expect(screenNow.root.findAll((node) => String(node.type) === 'ScrollView')).toHaveLength(0)
  })

  // 2026-09-27 review: the slot is now set the moment a video is recognized,
  // well before its duration (let alone a frame count) is known — a send
  // tapped during that stretch used to see no sign a video was even being
  // read. `total: null` is that stretch; the chip has something to say
  // regardless.
  it.each(SCHEMES)('says a video is being read, with no count yet, before the first frame\'s own metadata arrives (%s)', (scheme) => {
    const screenNow = draw(scheme, {
      attachments: [],
      videoFrameExtraction: { batch: 'batch-1', done: 0, total: null }
    })
    const text = screenNow.root.findAll(
      (node) => String(node.type) === 'Txt' || String(node.type) === 'Text'
    )
    expect(text.some((node) => JSON.stringify(node.props.children).includes('Reading a video…'))).toBe(true)
    expect(text.some((node) => JSON.stringify(node.props.children).includes('Reading frames'))).toBe(false)
  })

  it('puts the progress chip ahead of any already-finished frame chips', () => {
    const screenNow = draw('light', {
      attachments: [PHOTO],
      videoFrameExtraction: { batch: 'batch-1', done: 1, total: 20 }
    })
    // Both chip shapes are a 60-tall View; the progress chip is the wide one
    // (maxWidth 210, like a file chip), the photo the square one (width 60).
    // findAll walks the tree in render order, so their relative order here is
    // the strip's own left-to-right order.
    const chips = screenNow.root.findAll(
      (node) => String(node.type) === 'View' && node.props.style?.height === 60
    )
    expect(chips).toHaveLength(2)
    expect(chips[0]!.props.style).toMatchObject({ maxWidth: 210 })
    expect(chips[1]!.props.style).toMatchObject({ width: 60 })
  })

  it('cancels through the same remove badge the strip already draws', () => {
    const onCancelVideoFrameExtraction = vi.fn()
    const screenNow = draw('light', {
      attachments: [],
      videoFrameExtraction: { batch: 'batch-1', done: 3, total: 20 },
      onCancelVideoFrameExtraction
    })
    tap(pressables(screenNow, 'Cancel reading frames')[0])
    expect(onCancelVideoFrameExtraction).toHaveBeenCalledOnce()
  })

  it('offers no cancel button when the caller gave it nothing to call', () => {
    const screenNow = draw('light', {
      attachments: [],
      videoFrameExtraction: { batch: 'batch-1', done: 3, total: 20 }
    })
    expect(pressables(screenNow, 'Cancel reading frames')).toHaveLength(0)
  })
})
