import { describe, expect, it, vi } from 'vitest'
import { imageSizeFromDataUri, loadMarkupImageSize } from './markup-image-size'

vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }))

// The user, 2026-09-26 (build 4cab9d86): a photo marked up in the composer,
// then opened again from the preview with the pencil, drew "Couldn't load
// image" in the editor. A marked-up photo's preview is a `data:` URL
// (markedUpNativeChatImagePreviewUri), and so is a pasted screenshot's; the
// editor sized it with Image.getSize, which on Android fetches the encoded
// image through Fresco, and Fresco refuses a `data:` source there
// ("Unsupported uri scheme for encoded image fetch").

/** A PNG's signature and IHDR chunk for these dimensions, base64. */
function pngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return btoa(String.fromCharCode(...bytes))
}

/** A JPEG with an APP0 segment, then a baseline SOF0 for these dimensions. */
function jpegBase64(width: number, height: number): string {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array.from({ length: 14 }, () => 0)]
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]
  const bytes = [0xff, 0xd8, ...app0, ...sof, ...Array.from({ length: 12 }, () => 0)]
  return btoa(String.fromCharCode(...bytes))
}

describe('the size of a photo held as a data: URL', () => {
  it('reads a PNG’s size from its header', () => {
    expect(imageSizeFromDataUri(`data:image/png;base64,${pngBase64(1080, 2340)}`)).toEqual({ width: 1080, height: 2340 })
  })

  it('reads a JPEG’s size from its frame header', () => {
    expect(imageSizeFromDataUri(`data:image/jpeg;base64,${jpegBase64(4000, 3000)}`)).toEqual({ width: 4000, height: 3000 })
  })

  // react-native-svg's toDataURL on Android breaks base64 into lines.
  it('reads it through line breaks in the base64', () => {
    const wrapped = pngBase64(640, 480).replace(/(.{12})/g, '$1\n')
    expect(imageSizeFromDataUri(`data:image/png;base64,${wrapped}`)).toEqual({ width: 640, height: 480 })
  })

  it.each([
    ['a file URL', 'file:///phone/a.jpg'],
    ['an empty data URL', 'data:image/png;base64,'],
    ['base64 that is no image', `data:image/png;base64,${btoa('not an image at all, just words')}`],
    ['a PNG of no size', `data:image/png;base64,${pngBase64(0, 0)}`],
    ['text that is not base64', 'data:image/png;base64,%%%']
  ])('reads no size from %s', (_, uri) => {
    expect(imageSizeFromDataUri(uri)).toBeNull()
  })
})

describe('the markup editor’s photo size', () => {
  it('sizes a data: URL from its header, without asking Image.getSize, which Android refuses for one', () => {
    const getSize = vi.fn((_uri: string, _ok: (w: number, h: number) => void, fail: () => void) => fail())
    const onSize = vi.fn()
    const onFail = vi.fn()
    loadMarkupImageSize(`data:image/png;base64,${pngBase64(1080, 2340)}`, onSize, onFail, getSize)
    expect({ getSize: getSize.mock.calls.length, onSize: onSize.mock.calls, onFail: onFail.mock.calls.length }).toEqual({
      getSize: 0,
      onSize: [[1080, 2340]],
      onFail: 0
    })
  })

  it('asks Image.getSize for any other photo, and says so when it fails', () => {
    const getSize = vi.fn((_uri: string, ok: (w: number, h: number) => void) => ok(800, 600))
    const onSize = vi.fn()
    loadMarkupImageSize('file:///phone/a.jpg', onSize, vi.fn(), getSize)
    expect(onSize).toHaveBeenCalledWith(800, 600)
    const onFail = vi.fn()
    loadMarkupImageSize('file:///phone/gone.jpg', vi.fn(), onFail, (_uri, _ok, fail) => fail())
    expect(onFail).toHaveBeenCalledTimes(1)
  })

  it('says it failed for a data: URL whose header gives no size', () => {
    const onFail = vi.fn()
    loadMarkupImageSize('data:image/png;base64,', vi.fn(), onFail, vi.fn())
    expect(onFail).toHaveBeenCalledTimes(1)
  })
})

// The defect's shape is which of two sizers the editor calls: pinned on its
// code, comments taken out first.
it('is how the markup editor sizes its photo, never Image.getSize itself', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('./MobileImageMarkupEditor.tsx', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  expect({ loads: code.includes('loadMarkupImageSize('), getSize: code.includes('Image.getSize(') }).toEqual({ loads: true, getSize: false })
})
