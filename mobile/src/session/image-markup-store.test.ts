import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeImageMarkup, openImageMarkup, peekImageMarkup, resetImageMarkupForTests } from './image-markup-store'

// A single full-screen markup editor, opened from wherever a photo can be
// edited (the composer's attachment chip, its fullscreen preview). Mirrors
// `image-preview-store`'s single-viewer pattern so only one editor is ever
// mounted, in the root layout.

describe('image markup store', () => {
  beforeEach(() => resetImageMarkupForTests())

  it('opens with a uri and closes to null', () => {
    const onDone = vi.fn()
    openImageMarkup('file:///a.png', { onDone })
    expect(peekImageMarkup()).toMatchObject({ uri: 'file:///a.png', onDone })
    closeImageMarkup()
    expect(peekImageMarkup()).toBeNull()
  })

  it('closing with nothing open is a no-op', () => {
    expect(() => closeImageMarkup()).not.toThrow()
    expect(peekImageMarkup()).toBeNull()
  })

  // Reopening on the same uri (picking the same photo twice) must still be
  // treated as a fresh session — a stale effect keyed only on the uri would
  // silently keep the previous session's strokes on screen.
  it('gives every open a new token, even for the same uri twice in a row', () => {
    openImageMarkup('file:///a.png', { onDone: vi.fn() })
    const first = peekImageMarkup()?.token
    closeImageMarkup()
    openImageMarkup('file:///a.png', { onDone: vi.fn() })
    const second = peekImageMarkup()?.token
    expect(second).not.toBe(first)
  })

  it('carries an optional onDiscard alongside onDone', () => {
    const onDone = vi.fn()
    const onDiscard = vi.fn()
    openImageMarkup('file:///a.png', { onDone, onDiscard })
    expect(peekImageMarkup()?.onDiscard).toBe(onDiscard)
  })
})
