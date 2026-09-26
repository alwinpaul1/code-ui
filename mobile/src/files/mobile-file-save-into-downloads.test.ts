import { beforeEach, describe, expect, it, vi } from 'vitest'

// The DEVICE half of Save to phone and of the PDF viewer's Download, against fakes of the two
// expo-file-system modules that apply the permission rules of the real native code
// (node_modules/expo-file-system/android/..., 57.0.6):
//
// Legacy module (FileSystemLegacyModule.kt):
//   writeAsStringAsync: ensurePermission(uri, WRITE)                                (line 195)
//   deleteAsync:        ensurePermission(uri + "/..", WRITE, "... isn't deletable.")  (line 211)
//   permissionsForUri:  isSAFUri -> ask DocumentFile; other content:// -> READ only (765-767)
//   isSAFUri:           scheme == "content" && host startsWith "com.android.externalstorage" (1084)
//
// The File class (FileSystemPath.kt, FileSystemFile.kt, unifiedfile/SAFDocumentFile.kt):
//   checkPermission:    any content:// URI passes (FileSystemPath.kt, "not in legacy FS")
//   isSAFUri:           DocumentsContract.isDocumentUri || isTreeUri, so ANY documents provider,
//                       the Downloads one included, gets a SAFDocumentFile
//   write:              an existing document is written through contentResolver.openOutputStream
//   delete:             DocumentFile.delete(), "failed to delete" when the provider says no
//
// What this cannot check without a phone: the URI Android's CREATE_DOCUMENT picker hands back. In
// its default Downloads root the authority is com.android.providers.downloads.documents, which is
// not "externalstorage", so the legacy module could never write there.

const DOWNLOADS_URI =
  'content://com.android.providers.downloads.documents/document/msf%3A1000001234'
const EXTERNAL_STORAGE_URI =
  'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fhello.txt'

const device = vi.hoisted(() => ({
  /** The documents that exist on the phone, by URI. */
  documents: new Map<string, Buffer>(),
  pickedUri: '',
  /** The provider's own write failure (a full disk), after it has made the document. */
  writeFailure: null as string | null,
  /** Documents whose provider refuses a delete. */
  undeletable: new Set<string>()
}))

function isLegacySafUri(uri: string): boolean {
  const match = /^content:\/\/([^/]+)/.exec(uri)
  return !!match && match[1]!.startsWith('com.android.externalstorage')
}

function isDocumentUri(uri: string): boolean {
  return /^content:\/\/[^/]+\/(document\/[^/]+|tree\/[^/]+\/document\/[^/]+)$/.test(uri)
}

function providerWrite(uri: string, bytes: Buffer): void {
  if (device.writeFailure) {
    throw new Error(device.writeFailure)
  }
  device.documents.set(uri, bytes)
}

vi.mock('react-native', () => ({ Platform: { OS: 'android' }, Share: { share: vi.fn() } }))
vi.mock('expo-haptics', () => ({
  AndroidHaptics: {},
  NotificationFeedbackType: {},
  ImpactFeedbackStyle: {},
  performAndroidHapticsAsync: async () => {},
  notificationAsync: async () => {}
}))
vi.mock('expo-intent-launcher', () => ({
  ResultCode: { Success: -1, Canceled: 0 },
  startActivityAsync: async () => {
    // The provider creates the (empty) document the moment the user confirms the picker.
    device.documents.set(device.pickedUri, Buffer.alloc(0))
    return { resultCode: -1, data: device.pickedUri }
  }
}))
vi.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: async (uri: string, contents: string) => {
    if (!isLegacySafUri(uri)) {
      throw new Error(`Location '${uri}' isn't writable.`)
    }
    providerWrite(uri, Buffer.from(contents, 'base64'))
  },
  deleteAsync: async (uri: string) => {
    if (!isLegacySafUri(`${uri}/..`)) {
      throw new Error(`Location '${uri}' isn't deletable.`)
    }
    device.documents.delete(uri)
  },
  readAsStringAsync: async () => {
    throw new Error('no cache file in this test')
  }
}))
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(readonly uri: string) {}
    write(content: string, options?: { encoding?: string }) {
      if (!isDocumentUri(this.uri) || !device.documents.has(this.uri)) {
        throw new Error(
          'File.create function does not work with SAF content:// uris, use `Directory.createFile` instead'
        )
      }
      providerWrite(
        this.uri,
        Buffer.from(content, options?.encoding === 'base64' ? 'base64' : 'utf8')
      )
    }
    delete() {
      if (!device.documents.has(this.uri)) {
        throw new Error(`uri '${this.uri}' does not exist`)
      }
      if (device.undeletable.has(this.uri)) {
        throw new Error(`failed to delete '${this.uri}'`)
      }
      device.documents.delete(this.uri)
    }
  }
}))

import { saveDesktopFileToPhoneOnDevice } from './mobile-file-save-device'
import { savePreviewedPdf } from './mobile-pdf-download-device'

function desktopWith(bytes: Buffer) {
  return {
    sendRequest: async (_method: string, params: Record<string, unknown>) => {
      const offset = params.offset as number
      const slice = bytes.subarray(offset, offset + (params.length as number))
      return {
        id: '1',
        ok: true,
        result: {
          contentBase64: slice.toString('base64'),
          bytesRead: slice.length,
          eof: offset + slice.length >= bytes.length
        },
        _meta: { runtimeId: 'runtime-1' }
      }
    }
  } as never
}

async function saveHello(pickedUri: string) {
  device.pickedUri = pickedUri
  const notices: string[] = []
  const outcome = await saveDesktopFileToPhoneOnDevice({
    client: desktopWith(Buffer.from('hello from the desktop\n')),
    source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'notes/hello.txt' },
    notify: (message) => notices.push(message)
  })
  return { outcome, notices }
}

beforeEach(() => {
  device.documents.clear()
  device.writeFailure = null
  device.undeletable.clear()
})

describe("saving into the picker's default Downloads root", () => {
  it('writes the file there, which the legacy file system refused', async () => {
    const { outcome, notices } = await saveHello(DOWNLOADS_URI)

    expect(outcome).toEqual({ status: 'saved', fileName: 'hello.txt', byteLength: 23 })
    expect(device.documents.get(DOWNLOADS_URI)?.toString()).toBe('hello from the desktop\n')
    expect(notices.at(-1)).toBe('Saved hello.txt (23 B)')
  })

  it('still writes into a folder picked under the phone storage root', async () => {
    const { outcome } = await saveHello(EXTERNAL_STORAGE_URI)

    expect(outcome).toMatchObject({ status: 'saved' })
    expect(device.documents.get(EXTERNAL_STORAGE_URI)?.toString()).toBe('hello from the desktop\n')
  })

  it('removes the document it made when the write fails, and says nothing was saved', async () => {
    device.writeFailure = 'ENOSPC (No space left on device)'

    const { outcome } = await saveHello(DOWNLOADS_URI)

    expect(outcome).toEqual({
      status: 'failed',
      fileName: 'hello.txt',
      message:
        "Couldn't save hello.txt: the phone could not write it (ENOSPC (No space left on device))"
    })
    expect(device.documents.has(DOWNLOADS_URI)).toBe(false)
  })

  it('says an incomplete copy is left, and where, when the failed document cannot be removed', async () => {
    device.writeFailure = 'ENOSPC (No space left on device)'
    device.undeletable.add(DOWNLOADS_URI)

    const { outcome, notices } = await saveHello(DOWNLOADS_URI)

    const message =
      "Couldn't save hello.txt: the phone could not write it (ENOSPC (No space left on device)). " +
      'An incomplete hello.txt is left where you chose to save it; delete it there'
    expect(outcome).toEqual({ status: 'failed', fileName: 'hello.txt', message })
    expect(notices.at(-1)).toBe(message)
  })
})

describe("the PDF viewer's Download into the same root", () => {
  it('writes the PDF there, which the legacy file system refused', async () => {
    device.pickedUri = DOWNLOADS_URI

    const outcome = await savePreviewedPdf({
      uri: 'data:application/pdf;base64,JVBERi0xLjQK',
      fileName: 'papers/thesis.pdf'
    })

    expect(outcome).toBe('saved')
    expect(device.documents.get(DOWNLOADS_URI)?.toString()).toBe('%PDF-1.4\n')
  })

  it('removes the document it made when the write fails', async () => {
    device.pickedUri = DOWNLOADS_URI
    device.writeFailure = 'EIO'

    const outcome = await savePreviewedPdf({
      uri: 'data:application/pdf;base64,JVBERi0xLjQK',
      fileName: 'thesis.pdf'
    })

    expect(outcome).toBe('failed')
    expect(device.documents.has(DOWNLOADS_URI)).toBe(false)
  })
})
