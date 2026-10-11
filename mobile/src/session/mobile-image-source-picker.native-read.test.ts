import { describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn()
}))
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }))
vi.mock('expo-file-system', () => ({ File: vi.fn() }))

import { pickMobileImages, type PickedMobileImage } from './mobile-image-source-picker'

// 2026-10-11: a photo's chip sat on its loading ring while the phone read the
// photo into base64 256 KiB at a time with `readBytes`, each chunk encoded by
// a JS accumulator: synchronous work on the JS thread, so the composer itself
// stalled for the length of the read. expo-file-system reads and encodes a
// file natively with `File.base64()`, off the JS thread, and the picker's
// photos are plain cache files it can read that way.

async function firstPhoto(file: object, asset: object): Promise<PickedMobileImage> {
  const launchLibrary = vi.fn().mockResolvedValue({ canceled: false, assets: [asset] })
  const createFile = vi.fn(() => file) as never
  for await (const image of pickMobileImages('library', {
    requestLibraryPermission: null,
    launchLibrary,
    createFile
  })) {
    return image
  }
  throw new Error('no photo')
}

describe('a photo picked from the library', () => {
  it('is read and encoded natively, off the JS thread, not chunk by chunk in JS', async () => {
    const open = vi.fn(() => {
      throw new Error('read on the JS thread')
    })
    const base64 = vi.fn(async () => 'AQIDBA==')
    const photo = await firstPhoto(
      { size: 4, open, delete: vi.fn(), base64 },
      { uri: 'file:///cache/p.jpg', fileSize: 4, width: 800, height: 600 }
    )
    expect(await photo.load?.()).toBe('AQIDBA==')
    expect(base64).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
  })

  it('reads again on a retry after its first read failed', async () => {
    const base64 = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('EIO'))
      .mockResolvedValueOnce('AQIDBA==')
    const photo = await firstPhoto(
      { size: 4, open: vi.fn(), delete: vi.fn(), base64 },
      { uri: 'file:///cache/p.jpg', fileSize: 4, width: 800, height: 600 }
    )
    await expect(photo.load?.()).rejects.toThrow('EIO')
    expect(await photo.load?.()).toBe('AQIDBA==')
  })

  it('still refuses a photo over the upload cap before reading a byte', async () => {
    const base64 = vi.fn(async () => 'AQIDBA==')
    const photo = await firstPhoto(
      { size: CLIPBOARD_IMAGE_MAX_SOURCE_BYTES + 1, open: vi.fn(), delete: vi.fn(), base64 },
      { uri: 'file:///cache/p.jpg', width: 800, height: 600 }
    )
    await expect(photo.load?.()).rejects.toThrow()
    expect(base64).not.toHaveBeenCalled()
  })
})
