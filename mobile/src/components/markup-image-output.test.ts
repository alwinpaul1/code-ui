import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The device half of the markup editor's output: reading the source's first
// bytes and writing the flattened PNG as a JPEG for an opaque source. Both are
// fail-open: whatever goes wrong, the marks still go out, as a PNG.

const opened = vi.hoisted(() => ({ modes: [] as unknown[], bytes: new Uint8Array() as Uint8Array, closed: 0 }))

vi.mock('expo-file-system', () => {
  class File {
    uri: string
    constructor(...parts: string[]) {
      this.uri = parts.join('')
    }
    open(mode?: unknown) {
      opened.modes.push(mode)
      return {
        readBytes: (length: number) => opened.bytes.slice(0, length),
        close: () => {
          opened.closed += 1
        }
      }
    }
  }
  return { File, Paths: { cache: 'file:///cache/' }, FileMode: { ReadOnly: 'r', ReadWrite: 'rw' } }
})

import { encodeMarkupOutput, loadMarkupSourceTraits } from './markup-image-output'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, '../session/fixtures/markup', name)))

const JPEG_OUT = { format: 'jpeg', quality: 85, mimeType: 'image/jpeg' } as const

afterEach(() => {
  vi.restoreAllMocks()
  opened.modes = []
  opened.closed = 0
})

describe('reading the picture being marked up', () => {
  it("reads a local photo's first bytes, opening it read-only and closing it", () => {
    opened.bytes = fixture('opaque-photo.jpg')
    expect(loadMarkupSourceTraits('file:///data/user/0/cache/photo.jpg')).toEqual({ mimeType: 'image/jpeg', hasAlpha: false })
    // A mode-less open of a file:// path is read-write in expo-file-system
    // 57: it creates a missing file and fails on one the app cannot write.
    expect(opened.modes).toEqual(['r'])
    expect(opened.closed).toBe(1)
  })

  it('reads a content:// pick through the same reader', () => {
    const readHead = vi.fn(() => fixture('screenshot-with-alpha.png'))
    expect(loadMarkupSourceTraits('content://media/external/images/1', readHead)).toEqual({ mimeType: 'image/png', hasAlpha: true })
    expect(readHead).toHaveBeenCalledWith('content://media/external/images/1', 96 * 1024)
  })

  it('says it could not read a file it cannot open, and leaves the format to PNG', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const traits = loadMarkupSourceTraits('file:///gone.png', () => {
      throw new Error('ENOENT: no such file')
    })
    expect(traits).toEqual({ mimeType: null, hasAlpha: null })
    expect(warn.mock.calls.some((call) => String(call[0]).includes('ENOENT'))).toBe(true)
  })

  it('reads nothing for a remote picture', () => {
    const readHead = vi.fn(() => new Uint8Array())
    expect(loadMarkupSourceTraits('https://example.com/a.jpg', readHead)).toEqual({ mimeType: null, hasAlpha: null })
    expect(readHead).not.toHaveBeenCalled()
  })
})

describe('writing the marked-up picture', () => {
  it('writes an opaque source as the JPEG the encoder made, at quality 0.85', async () => {
    const toJpeg = vi.fn(async () => '/9j/JPEG')
    expect(await encodeMarkupOutput('PNG', JPEG_OUT, toJpeg)).toEqual({ base64: '/9j/JPEG', mimeType: 'image/jpeg' })
    expect(toJpeg).toHaveBeenCalledWith('PNG', 0.85)
  })

  it('sends the PNG and says why when the JPEG write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await encodeMarkupOutput('PNG', JPEG_OUT, async () => {
      throw new Error('decoder refused the file')
    })
    expect(result).toEqual({ base64: 'PNG', mimeType: 'image/png' })
    expect(warn.mock.calls.some((call) => String(call[0]).includes('decoder refused the file'))).toBe(true)
  })

  it('sends the PNG and says why when the JPEG write comes back empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await encodeMarkupOutput('PNG', JPEG_OUT, async () => '')).toEqual({ base64: 'PNG', mimeType: 'image/png' })
    expect(warn.mock.calls.some((call) => String(call[0]).includes('no bytes'))).toBe(true)
  })

  it('never re-encodes a PNG output', async () => {
    const toJpeg = vi.fn(async () => 'x')
    expect(await encodeMarkupOutput('PNG', { format: 'png', quality: 100, mimeType: 'image/png' }, toJpeg)).toEqual({
      base64: 'PNG',
      mimeType: 'image/png'
    })
    expect(toJpeg).not.toHaveBeenCalled()
  })
})
