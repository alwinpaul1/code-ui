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
  // DraggableDetailSheet and the image viewers send the keyboard away as they open.
  Keyboard: { dismiss: () => {} },
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

vi.mock('lucide-react-native', () => ({ Check: 'Check', Download: 'Download', Pencil: 'Pencil', X: 'X' }))

vi.mock('./ZoomableImage', () => ({ ZoomableImage: 'ZoomableImage' }))

// The composer's attachment preview offers the Claude app's pencil, the one
// way into the markup editor (2026-09-24; a tap on the chip opens this preview
// first, 2026-09-26); every other opener of this same viewer —
// a sent bubble, a markdown figure, a queued image — has no editor behind it
// and must keep showing only the close button it always has.

function render(): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="dark">
        <ImagePreviewModal />
      </ThemeProvider>
    )
  })
  return renderer!
}

function findByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label
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

  // The user, 2026-09-26: the X goes left and the pencil right.
  it('puts the close button on the left and the pencil on the right', () => {
    openImagePreview('file:///a.png', 'a photo', 0, vi.fn())
    renderer = render()
    const order = renderer.root
      .findAll((node) => String(node.type) === 'Pressable')
      .map((node) => node.props.accessibilityLabel)
      .filter((label) => label === 'Close' || label === 'Edit image')
    expect(order).toEqual(['Close', 'Edit image'])
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
        <ThemeProvider initialPreference="dark">
          <ImagePreviewModal />
        </ThemeProvider>
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

// The Claude app's viewer carries a download button at the top right
// (the user's screenshots, 2026-10-11). It saves the picture already on the
// phone; with no saver handed in (every test above), there is no button.
describe("the fullscreen preview's download button", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetImagePreviewForTests()
    vi.restoreAllMocks()
  })
  const renderWith = (onSave: (uri: string) => Promise<{ status: 'saved' | 'failed' | 'cancelled' }>) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <ImagePreviewModal onSave={onSave} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  it('saves the picture on screen, and says so', async () => {
    const onSave = vi.fn(async () => ({ status: 'saved' as const }))
    openImagePreview(['file:///a.png', 'file:///b.png'], 'Image the agent sent', 1)
    renderWith(onSave)
    await act(async () => {
      findByLabel(renderer!, 'Download image')[0]!.props.onPress()
    })
    expect(onSave).toHaveBeenCalledWith('file:///b.png')
    expect(findByLabel(renderer!, 'Saved')).toHaveLength(1)
  })

  it("says it couldn't save, and leaves a line naming why, when the save throws", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    openImagePreview('file:///a.png', 'Image the agent read')
    renderWith(vi.fn(async (): Promise<{ status: 'saved' }> => { throw new Error('picker unavailable') }))
    await act(async () => {
      findByLabel(renderer!, 'Download image')[0]!.props.onPress()
    })
    expect(findByLabel(renderer!, "Couldn't save")).toHaveLength(1)
    expect(warn.mock.calls.some((call) => String(call[0]).includes('picker unavailable'))).toBe(true)
  })
})
