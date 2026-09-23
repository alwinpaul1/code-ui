/**
 * The native form of the media seam: the device's own pickers, reached exactly as before.
 *
 * This half has no behaviour to test beyond that, and that is the point of the file — the screen's
 * picking moved behind a seam and the phone must run the same two calls it ran before, with the
 * same argument. The picking itself is `mobile-image-source-picker.test.ts`'s, and the pasteboard
 * is the clipboard seam's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []

// CODE UI: the two dependencies the chat's attach binds, stood in by markers so a case can say
// which member passes which. Both modules reach expo natives this runner cannot load.
const readSystemClipboardImage = vi.hoisted(() => () => Promise.resolve(null))
const resizeMobilePhoto = vi.hoisted(() => () => Promise.resolve({ uri: '', width: 0, height: 0 }))
vi.mock('../session/mobile-clipboard-image-reader', () => ({ readSystemClipboardImage }))
vi.mock('../session/mobile-photo-resize', () => ({ resizeMobilePhoto }))

const deps: unknown[] = []

vi.mock('../session/mobile-image-source-picker', () => ({
  pickMobileImage: (source: string, passed?: unknown) => {
    calls.push(`pickMobileImage ${source}`)
    deps.push(passed)
    return Promise.resolve({ base64: 'BBB=', uri: 'file:///cache/one.png' })
  },
  pickMobileImages: (source: string, passed?: unknown) => {
    calls.push(`pickMobileImages ${source}`)
    deps.push(passed)
    return (async function* () {
      yield { base64: 'CCC=' }
    })()
  }
}))

import { useMediaPicker } from './media-picker'

beforeEach(() => {
  calls.length = 0
  deps.length = 0
})

describe('picking media on a phone', () => {
  it('opens the library picker the screen already opened, source and all', async () => {
    expect(await useMediaPicker().pickImage('library')).toEqual({
      base64: 'BBB=',
      uri: 'file:///cache/one.png'
    })
    expect(calls).toEqual(['pickMobileImage library'])
  })

  it('streams a multi-select from the Files picker', async () => {
    const taken: string[] = []
    for await (const image of useMediaPicker().pickImages('files')) {
      taken.push(image.base64)
    }
    expect(taken).toEqual(['CCC='])
    expect(calls).toEqual(['pickMobileImages files'])
  })

  it('keeps the dependencies each caller passed before the seam (CODE UI)', async () => {
    // The terminal's attach sent the library's original bytes and read no pasteboard; the chat's
    // reads the pasteboard for its Paste image source and sends a photo at 2048 px.
    await useMediaPicker().pickImage('library')
    for await (const _image of useMediaPicker().pickImages('clipboard')) {
      // drained
    }
    expect(deps).toEqual([
      undefined,
      { readClipboardImage: readSystemClipboardImage, resizeImage: resizeMobilePhoto }
    ])
  })

  it('answers one object across renders, so a caller may hold it in a dependency list', () => {
    expect(useMediaPicker()).toBe(useMediaPicker())
  })
})
