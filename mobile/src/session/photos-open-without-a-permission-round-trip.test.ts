import { afterEach, describe, expect, it, vi } from 'vitest'

// The Photos card asked expo-image-picker for a media-library permission and
// waited for the answer before it asked for the picker. On Android that
// answer is fixed. expo-image-picker 57.0.16 (ImagePickerModule.kt,
// getMediaLibraryPermissions) requests NO permission at all from API 33 up
// and resolves `granted`, so the wait was a JS -> native -> JS round trip
// whose reply queues behind whatever the JS thread is doing (a busy chat's
// renders) before the launch can even be sent. Below API 33 it asks for
// READ/WRITE_EXTERNAL_STORAGE, which app.json's blockedPermissions strips
// from the manifest, so there the request can only be refused. The picker it
// opens (PickVisualMedia: the system photo picker, or ACTION_OPEN_DOCUMENT
// where there is none) needs no permission on any version: it grants read
// access to exactly what the user picks.
//
// Metro resolves `./photo-library-permission` to
// photo-library-permission.android.ts on Android; this file stands in the
// value that file holds (the pairing is pinned in
// mobile-image-source-picker.test.ts).

vi.mock('./photo-library-permission', () => ({ requestPhotoLibraryPermission: null }))
vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn()
}))
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }))
vi.mock('expo-file-system', () => ({ File: vi.fn() }))

import * as ImagePicker from 'expo-image-picker'
import { pickMobileImage, pickMobileImages, type PickedMobileImage } from './mobile-image-source-picker'

const requestPermission = vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync)
const launchLibrary = vi.mocked(ImagePicker.launchImageLibraryAsync)

type LaunchResult = Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>
const cancelled = { canceled: true, assets: null } as LaunchResult

afterEach(() => {
  requestPermission.mockReset()
  launchLibrary.mockReset()
})

async function collect(images: AsyncIterable<PickedMobileImage>): Promise<PickedMobileImage[]> {
  const taken: PickedMobileImage[] = []
  for await (const image of images) {
    taken.push(image)
  }
  return taken
}

describe('Photos on Android', () => {
  it('asks for the picker in the same turn as the tap, with no permission round trip first', async () => {
    launchLibrary.mockResolvedValue(cancelled)

    // The chat's Photos: a multi-pick. Its first step runs synchronously up
    // to the first thing it waits on; that must be the picker itself.
    const images = pickMobileImages('library')[Symbol.asyncIterator]()
    const first = images.next()

    expect(requestPermission, 'a permission request was sent and awaited before the picker').not.toHaveBeenCalled()
    expect(launchLibrary, 'the picker launch waited on a round trip').toHaveBeenCalledTimes(1)
    await expect(first).resolves.toEqual({ done: true, value: undefined })
  })

  it('opens the system photo picker for images, not the legacy document chooser', async () => {
    launchLibrary.mockResolvedValue(cancelled)
    await collect(pickMobileImages('library'))

    const options = launchLibrary.mock.calls[0]![0]!
    expect(options.mediaTypes).toEqual(['images'])
    // `legacy: true` is expo's ACTION_GET_CONTENT path (DocumentsUI), a
    // heavier window than the photo picker.
    expect(options.legacy).toBeUndefined()
    expect(options.allowsMultipleSelection).toBe(true)
  })

  it('opens the picker without asking for the terminal’s single pick too', async () => {
    launchLibrary.mockResolvedValue(cancelled)

    await expect(pickMobileImage('library')).resolves.toBeNull()

    expect(requestPermission).not.toHaveBeenCalled()
    expect(launchLibrary).toHaveBeenCalledTimes(1)
  })

  it('still hands back every photo picked, each read only when asked for', async () => {
    launchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'content://media/picker/0/1', width: 1000, height: 800 },
        { uri: 'content://media/picker/0/2', width: 1000, height: 800 }
      ]
    } as LaunchResult)

    const taken = await collect(pickMobileImages('library'))

    expect(taken.map((image) => image.uri)).toEqual(['content://media/picker/0/1', 'content://media/picker/0/2'])
    expect(taken.every((image) => image.base64 === '' && typeof image.load === 'function')).toBe(true)
  })

  it('lets a picker failure through as itself, not as a permission refusal', async () => {
    launchLibrary.mockRejectedValue(new Error('Failed to pick media'))

    await expect(collect(pickMobileImages('library'))).rejects.toThrow('Failed to pick media')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('picks nothing when the picker is dismissed', async () => {
    launchLibrary.mockResolvedValue(cancelled)

    await expect(collect(pickMobileImages('library'))).resolves.toEqual([])
  })
})
