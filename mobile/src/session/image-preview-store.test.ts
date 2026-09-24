import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeImagePreview,
  openImagePreview,
  openImagePreviewSources,
  peekImagePreview,
  resetImagePreviewForTests,
  setImagePreviewIndex
} from './image-preview-store'

describe('image preview store', () => {
  beforeEach(() => resetImagePreviewForTests())

  it('opens with a uri and label, then closes to null', () => {
    openImagePreview('file:///a.png', 'a photo')
    expect(peekImagePreview()).toMatchObject({ uri: 'file:///a.png', uris: ['file:///a.png'], index: 0, label: 'a photo' })
    closeImagePreview()
    expect(peekImagePreview()).toBeNull()
  })

  it('defaults the label', () => {
    openImagePreview('data:image/png;base64,x')
    expect(peekImagePreview()?.label).toBe('Image')
  })

  // The Claude app's viewer, 2026-09-12: a message's images page sideways
  // and the caption counts them, "5 of 6".
  it('opens a set at an index and pages within it', () => {
    openImagePreview(['a', 'b', 'c'], 'Attached image', 1)
    expect(peekImagePreview()).toMatchObject({ uri: 'b', index: 1, uris: ['a', 'b', 'c'] })
    setImagePreviewIndex(2)
    expect(peekImagePreview()).toMatchObject({ uri: 'c', index: 2 })
    setImagePreviewIndex(9)
    expect(peekImagePreview()?.index).toBe(2)
    setImagePreviewIndex(-1)
    expect(peekImagePreview()?.index).toBe(0)
  })

  // The composer's attachment chip opens the fullscreen preview with an edit
  // handle so the viewer can offer the Claude app's pencil (2026-09-24); a
  // sent bubble or a markdown figure opens the same viewer with none, and
  // must not gain a pencil it has no editor behind.
  it('carries an optional onEdit for a photo that can be marked up', () => {
    openImagePreview('file:///a.png', 'a photo')
    expect(peekImagePreview()?.onEdit).toBeUndefined()

    const onEdit = vi.fn()
    openImagePreviewSources([{ kind: 'bitmap', uri: 'file:///b.png' }], 'a photo', 0, onEdit)
    expect(peekImagePreview()?.onEdit).toBe(onEdit)
  })

  it('carries the same optional onEdit through the plain openImagePreview call', () => {
    const onEdit = vi.fn()
    openImagePreview('file:///a.png', 'a photo', 0, onEdit)
    expect(peekImagePreview()?.onEdit).toBe(onEdit)
  })
})
