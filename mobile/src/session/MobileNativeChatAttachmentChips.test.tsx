import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatAttachmentChips } from './MobileNativeChatAttachmentChips'
import { openImagePreview } from './image-preview-store'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles },
  useColorScheme: () => 'light'
}))

vi.mock('lucide-react-native', () => ({
  FileText: 'FileText',
  Pencil: 'Pencil',
  X: 'X'
}))

vi.mock('./image-preview-store', () => ({ openImagePreview: vi.fn() }))

// 2026-09-24, the user: no pencil over the photo (a white circle at its
// bottom-right, beside the X, covering the picture). A tap on the photo opens
// the markup editor itself; the X still removes it. Only a drawable photo
// opens markup: a document chip has nothing to draw on, and an upload still in
// flight has no settled bytes yet, so those taps keep opening the preview.

function render(props: Parameters<typeof MobileNativeChatAttachmentChips>[0]): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(ThemeProvider, { initialPreference: 'light' }, createElement(
      MobileNativeChatAttachmentChips,
      props
    )))
  })
  return renderer!
}

function pencilButtons(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Edit image'
  )
}

function thumbnail(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) => node.type === 'Pressable' && node.props.accessibilityRole === 'imagebutton'
  )
}

const PHOTO: PendingNativeChatImage = {
  id: 'img-1',
  path: '/tmp/a.png',
  previewUri: 'file:///a.jpg'
}

describe('marking up a photo in the attachment strip', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.mocked(openImagePreview).mockClear()
  })

  it('draws no pencil over the photo; a tap on it opens markup, by id and preview uri', () => {
    const onEditAttachment = vi.fn()
    renderer = render({ attachments: [PHOTO], onEditAttachment, onRemoveAttachment: vi.fn() })
    expect(pencilButtons(renderer)).toHaveLength(0)
    act(() => {
      thumbnail(renderer!).props.onPress()
    })
    expect(onEditAttachment).toHaveBeenCalledWith('img-1', 'file:///a.jpg')
    expect(openImagePreview).not.toHaveBeenCalled()
    // The X stays, and still removes.
    expect(
      renderer.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Remove image')
    ).toHaveLength(1)
  })

  it('opens the preview, not markup, on a photo still uploading', () => {
    const onEditAttachment = vi.fn()
    renderer = render({ attachments: [{ ...PHOTO, path: '', uploading: true }], onEditAttachment })
    act(() => {
      thumbnail(renderer!).props.onPress()
    })
    expect(onEditAttachment).not.toHaveBeenCalled()
    expect(openImagePreview).toHaveBeenCalledOnce()
  })

  it('opens the preview when the caller has nowhere to send markup', () => {
    renderer = render({ attachments: [PHOTO] })
    act(() => {
      thumbnail(renderer!).props.onPress()
    })
    expect(openImagePreview).toHaveBeenCalledOnce()
  })

  it('gives a document chip nothing to draw on and no pencil', () => {
    renderer = render({
      attachments: [{ id: 'doc-1', path: '/tmp/a.pdf', previewUri: 'file:///a.pdf', kind: 'file', name: 'a.pdf' }],
      onEditAttachment: vi.fn()
    })
    expect(pencilButtons(renderer)).toHaveLength(0)
    expect(
      renderer.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'imagebutton')
    ).toHaveLength(0)
  })
})
