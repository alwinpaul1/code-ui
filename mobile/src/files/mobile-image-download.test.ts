import { describe, expect, it, vi } from 'vitest'
import { downloadMobileImage, imageMimeType, suggestedImageFileName, type MobileImageDownloadDeps } from './mobile-image-download'

function deps(overrides: Partial<MobileImageDownloadDeps> = {}): MobileImageDownloadDeps {
  return {
    createDocument: vi.fn(async () => 'content://downloads/image.png'),
    readBase64: vi.fn(async () => 'iVBORw0K'),
    writeBase64: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    ...overrides
  }
}

describe('saving the picture the viewer shows', () => {
  it('offers a name and type from the picture itself', () => {
    expect(imageMimeType('data:image/jpeg;base64,/9j/')).toBe('image/jpeg')
    expect(imageMimeType('file:///cache/codeui-host-image-ab-12.webp')).toBe('image/webp')
    expect(imageMimeType('file:///cache/no-extension')).toBe('image/png')
    expect(suggestedImageFileName('image/jpeg')).toBe('image.jpg')
    expect(suggestedImageFileName('image/svg+xml')).toBe('image.svgxml')
  })

  it('writes a data: picture from its own bytes, without reading a file', async () => {
    const d = deps()
    expect(await downloadMobileImage({ uri: 'data:image/png;base64,QUJD' }, d)).toEqual({ status: 'saved' })
    expect(d.createDocument).toHaveBeenCalledWith('image.png', 'image/png')
    expect(d.readBase64).not.toHaveBeenCalled()
    expect(d.writeBase64).toHaveBeenCalledWith('content://downloads/image.png', 'QUJD')
  })

  it('reads a cached picture file and writes it where the user chose', async () => {
    const d = deps()
    expect(await downloadMobileImage({ uri: 'file:///cache/a.png' }, d)).toEqual({ status: 'saved' })
    expect(d.readBase64).toHaveBeenCalledWith('file:///cache/a.png')
    expect(d.writeBase64).toHaveBeenCalledWith('content://downloads/image.png', 'iVBORw0K')
  })

  it('writes nothing when the user backs out of the picker', async () => {
    const d = deps({ createDocument: vi.fn(async () => null) })
    expect(await downloadMobileImage({ uri: 'file:///cache/a.png' }, d)).toEqual({ status: 'cancelled' })
    expect(d.writeBase64).not.toHaveBeenCalled()
  })

  it('removes the empty document when the cached file is gone, and says it failed', async () => {
    const d = deps({ readBase64: vi.fn(async (): Promise<string> => { throw new Error('ENOENT') }) })
    expect(await downloadMobileImage({ uri: 'file:///cache/gone.png' }, d)).toEqual({ status: 'failed' })
    expect(d.remove).toHaveBeenCalledWith('content://downloads/image.png')
  })

  it('names the file left behind when the failed write cannot be undone', async () => {
    const d = deps({
      writeBase64: vi.fn(async (): Promise<void> => { throw new Error('disk full') }),
      remove: vi.fn(async (): Promise<void> => { throw new Error('gone') })
    })
    const outcome = await downloadMobileImage({ uri: 'data:image/png;base64,QUJD' }, d)
    expect(outcome.status).toBe('failed-left-incomplete')
  })
})
