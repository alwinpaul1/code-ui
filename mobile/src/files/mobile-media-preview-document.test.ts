import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { mobileMediaPreviewDocument } from './mobile-media-preview-document'

describe('the media player page', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'paints the %s theme page and text colours, not the dark palette',
    (_scheme, palette) => {
      const html = mobileMediaPreviewDocument('file:///cache/a.mp4', 'video/mp4', 'Clip', palette)
      expect(html).toContain(`background:${palette.bg}`)
      expect(html).toContain(`color:${palette.textSecondary}`)
      expect(html).not.toContain('undefined')
    }
  )

  it('uses an audio element for music and a video element for everything else', () => {
    expect(mobileMediaPreviewDocument('file:///a.mp3', 'audio/mpeg', 'Song', lightColors)).toContain(
      '<audio '
    )
    expect(mobileMediaPreviewDocument('file:///a.webm', 'video/webm', 'Clip', lightColors)).toContain(
      '<video '
    )
  })

  it('escapes the title and the address it puts in attributes', () => {
    const html = mobileMediaPreviewDocument(
      'file:///a"b.mp4',
      'video/mp4',
      '"><b id=injected>',
      darkColors
    )
    expect(html).not.toContain('<b id=injected>')
    expect(html).not.toContain('a"b.mp4')
  })

  it('allows media from files and blobs only, and no network', () => {
    const html = mobileMediaPreviewDocument('file:///a.mp4', 'video/mp4', 'Clip', lightColors)
    expect(html).toContain("default-src 'none'; media-src file: blob:")
  })
})
