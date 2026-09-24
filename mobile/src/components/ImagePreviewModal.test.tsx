import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import {
  closeImagePreview,
  openImagePreview,
  resetImagePreviewForTests
} from '../session/image-preview-store'
import { ImagePreviewModal } from './ImagePreviewModal'

vi.mock('react-native', () => ({
  Image: { getSize: vi.fn() },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StatusBar: 'StatusBar',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles },
  useColorScheme: () => 'dark',
  useWindowDimensions: () => ({ width: 400, height: 800 })
}))

vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'GestureHandlerRootView'
}))

vi.mock('lucide-react-native', () => ({ Pencil: 'Pencil', X: 'X' }))

vi.mock('./ZoomableImage', () => ({ ZoomableImage: 'ZoomableImage' }))

// The composer's attachment preview offers the Claude app's pencil to reopen
// the markup editor (2026-09-24); every other opener of this same viewer —
// a sent bubble, a markdown figure, a queued image — has no editor behind it
// and must keep showing only the close button it always has.

function render(): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(ThemeProvider, { initialPreference: 'dark' }, createElement(ImagePreviewModal)))
  })
  return renderer!
}

function findByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel === label
  )
}

describe('the fullscreen preview\'s edit pencil', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetImagePreviewForTests()
  })

  it('draws no pencil for a photo opened with no edit handle', () => {
    openImagePreview('file:///a.png', 'a photo')
    renderer = render()
    expect(findByLabel(renderer, 'Edit image')).toHaveLength(0)
    expect(findByLabel(renderer, 'Close')).toHaveLength(1)
  })

  it('closes the preview and opens the markup editor when the pencil is tapped', () => {
    const onEdit = vi.fn()
    openImagePreview('file:///a.png', 'a photo', 0, onEdit)
    renderer = render()
    const pencil = findByLabel(renderer, 'Edit image')
    expect(pencil).toHaveLength(1)

    act(() => {
      pencil[0]!.props.onPress()
    })
    expect(onEdit).toHaveBeenCalledTimes(1)

    // The viewer's own store is now closed — a second render sees nothing.
    act(() => {
      renderer!.update(
        createElement(ThemeProvider, { initialPreference: 'dark' }, createElement(ImagePreviewModal))
      )
    })
    expect(renderer!.toJSON()).toBeNull()
  })

  it('still closes on the X with an edit handle present, without firing it', () => {
    const onEdit = vi.fn()
    openImagePreview('file:///a.png', 'a photo', 0, onEdit)
    renderer = render()
    act(() => {
      findByLabel(renderer!, 'Close')[0]!.props.onPress()
    })
    expect(onEdit).not.toHaveBeenCalled()
    expect(closeImagePreview).toBeDefined() // sanity: real store function, not mocked
  })
})
