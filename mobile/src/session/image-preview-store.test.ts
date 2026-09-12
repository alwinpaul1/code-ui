import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeImagePreview,
  openImagePreview,
  peekImagePreview,
  resetImagePreviewForTests,
  setImagePreviewIndex
} from './image-preview-store'

describe('image preview store', () => {
  beforeEach(() => resetImagePreviewForTests())

  it('opens with a uri and label, then closes to null', () => {
    openImagePreview('file:///a.png', 'a photo')
    expect(peekImagePreview()).toEqual({ uri: 'file:///a.png', uris: ['file:///a.png'], index: 0, label: 'a photo' })
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
})
