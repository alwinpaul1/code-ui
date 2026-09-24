import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatAttachmentChips } from './MobileNativeChatAttachmentChips'
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

// The Claude app's attachment preview reopens the markup editor from a
// pencil on the chip (2026-09-24). It sits opposite the existing remove X so
// the two never overlap, and only a drawable photo chip gets one — a
// document chip has nothing to draw on, and an upload still in flight has no
// settled bytes to edit yet.

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

const PHOTO: PendingNativeChatImage = {
  id: 'img-1',
  path: '/tmp/a.png',
  previewUri: 'file:///a.jpg'
}

describe('the attachment strip\'s edit pencil', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('opens the markup editor on the tapped photo, by id and its preview uri', () => {
    const onEditAttachment = vi.fn()
    renderer = render({ attachments: [PHOTO], onEditAttachment })
    const buttons = pencilButtons(renderer)
    expect(buttons).toHaveLength(1)
    act(() => {
      buttons[0]!.props.onPress()
    })
    expect(onEditAttachment).toHaveBeenCalledWith('img-1', 'file:///a.jpg')
  })

  it('gives a document chip no pencil — there is nothing on it to draw on', () => {
    renderer = render({
      attachments: [{ id: 'doc-1', path: '/tmp/a.pdf', previewUri: 'file:///a.pdf', kind: 'file', name: 'a.pdf' }],
      onEditAttachment: vi.fn()
    })
    expect(pencilButtons(renderer)).toHaveLength(0)
  })

  it('gives a still-uploading photo no pencil until its bytes have settled', () => {
    renderer = render({
      attachments: [{ ...PHOTO, path: '', uploading: true }],
      onEditAttachment: vi.fn()
    })
    expect(pencilButtons(renderer)).toHaveLength(0)
  })

  it('draws no pencil at all when the caller has nowhere to send it', () => {
    renderer = render({ attachments: [PHOTO] })
    expect(pencilButtons(renderer)).toHaveLength(0)
  })
})
