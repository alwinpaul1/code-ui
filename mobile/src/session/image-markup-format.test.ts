import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { markupOutputFormat, markupSourceTraits, markupSourceTraitsFromDataUri } from './image-markup-format'

// The Claude app's markup Done (com.anthropic.claude 1.261009.20, decompiled
// 2026-10-11): `q130.r(mimeType, bitmap.hasAlpha())` picks PNG at quality 100
// only when the source bitmap has alpha AND is not a JPEG; anything else is
// written as JPEG at quality 85 (`fl.z`, "ImageMarkupCompositor"). So a photo
// goes back as a JPEG the size of a photo, not as a lossless PNG five times
// bigger, and a screenshot with transparency keeps it.
//
// The fixtures are real encoder output, made with macOS `sips` from the app's
// own icons: a JPEG at quality 85, an RGB PNG (colour type 2, no tRNS) and an
// RGBA PNG (colour type 6).

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, 'fixtures/markup', name)))

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

describe('the format a marked-up picture is saved in', () => {
  it('saves a JPEG photo as a JPEG at quality 85', () => {
    const traits = markupSourceTraits(fixture('opaque-photo.jpg'))
    expect(traits).toEqual({ mimeType: 'image/jpeg', hasAlpha: false })
    expect(markupOutputFormat(traits)).toEqual({ format: 'jpeg', quality: 85, mimeType: 'image/jpeg' })
  })

  it('saves a PNG with an alpha channel as a PNG at quality 100', () => {
    const traits = markupSourceTraits(fixture('screenshot-with-alpha.png'))
    expect(traits).toEqual({ mimeType: 'image/png', hasAlpha: true })
    expect(markupOutputFormat(traits)).toEqual({ format: 'png', quality: 100, mimeType: 'image/png' })
  })

  // Android decodes an RGB PNG with no tRNS chunk to a bitmap whose
  // hasAlpha() is false, so the Claude app writes it as a JPEG too.
  it('saves an opaque PNG (no alpha channel, no tRNS) as a JPEG, as the Claude app does', () => {
    const traits = markupSourceTraits(fixture('opaque-screenshot.png'))
    expect(traits).toEqual({ mimeType: 'image/png', hasAlpha: false })
    expect(markupOutputFormat(traits).format).toBe('jpeg')
  })

  it('keeps a palette PNG whose tRNS chunk makes it transparent as a PNG', () => {
    // The RGB fixture with its colour type set to palette (3) and a tRNS
    // chunk where its eXIf chunk was, after its sRGB: the chunk walk is what
    // is under test.
    const bytes = fixture('opaque-screenshot.png').slice()
    bytes[25] = 3
    const walked = markupSourceTraits(bytes)
    expect(walked.hasAlpha).toBe(false)
    const at = Buffer.from(bytes).indexOf('eXIf')
    expect(at).toBeGreaterThan(0)
    bytes.set([0x74, 0x52, 0x4e, 0x53], at)
    expect(markupSourceTraits(bytes)).toEqual({ mimeType: 'image/png', hasAlpha: true })
    expect(markupOutputFormat(markupSourceTraits(bytes)).format).toBe('png')
  })

  it('reads an opaque WebP (VP8X with no alpha flag) as opaque', () => {
    const traits = markupSourceTraits(new Uint8Array(readFileSync(join(__dirname, '../../assets/brand/mark-source.webp'))))
    expect(traits).toEqual({ mimeType: 'image/webp', hasAlpha: false })
  })

  it('reads the picture behind a data: URL, the way a pasted or marked-up photo arrives', () => {
    const jpeg = markupSourceTraitsFromDataUri(`data:image/jpeg;base64,${base64(fixture('opaque-photo.jpg'))}`)
    expect(markupOutputFormat(jpeg).format).toBe('jpeg')
    // The bytes decide, not the label: Code UI writes every pasted picture as
    // `data:image/png`, whatever it holds.
    const mislabelled = markupSourceTraitsFromDataUri(`data:image/png;base64,${base64(fixture('opaque-photo.jpg'))}`)
    expect(mislabelled).toEqual({ mimeType: 'image/jpeg', hasAlpha: false })
    const alpha = markupSourceTraitsFromDataUri(`data:image/png;base64,${base64(fixture('screenshot-with-alpha.png'))}`)
    expect(markupOutputFormat(alpha).format).toBe('png')
  })

  // Prefer the lossless choice when the source cannot be read: a PNG keeps
  // every pixel and any transparency, a wrong JPEG would lose both.
  it('stays with PNG when the source cannot be read or is cut before its pixels', () => {
    expect(markupOutputFormat({ mimeType: null, hasAlpha: null }).format).toBe('png')
    expect(markupSourceTraits(new Uint8Array())).toEqual({ mimeType: null, hasAlpha: null })
    expect(markupSourceTraits(new Uint8Array([1, 2, 3, 4]))).toEqual({ mimeType: null, hasAlpha: null })
    const cut = fixture('opaque-screenshot.png').slice(0, 40)
    expect(markupSourceTraits(cut)).toEqual({ mimeType: 'image/png', hasAlpha: null })
    expect(markupOutputFormat(markupSourceTraits(cut)).format).toBe('png')
    expect(markupSourceTraitsFromDataUri('file:///not/a/data/url.png')).toEqual({ mimeType: null, hasAlpha: null })
    expect(markupSourceTraitsFromDataUri('data:image/png;base64,@@@@')).toEqual({ mimeType: null, hasAlpha: null })
  })

  it('treats a JPEG as opaque even when nothing else is known, since a JPEG has no alpha', () => {
    expect(markupOutputFormat({ mimeType: 'image/jpeg', hasAlpha: null }).format).toBe('jpeg')
  })
})
