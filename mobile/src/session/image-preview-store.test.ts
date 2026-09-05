import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeImagePreview,
  openImagePreview,
  peekImagePreview,
  resetImagePreviewForTests
} from './image-preview-store'

describe('image preview store', () => {
  beforeEach(() => resetImagePreviewForTests())

  it('opens with a uri and label, then closes to null', () => {
    openImagePreview('file:///a.png', 'a photo')
    expect(peekImagePreview()).toEqual({ uri: 'file:///a.png', label: 'a photo' })
    closeImagePreview()
    expect(peekImagePreview()).toBeNull()
  })

  it('defaults the label', () => {
    openImagePreview('data:image/png;base64,x')
    expect(peekImagePreview()?.label).toBe('Image')
  })
})
