import { describe, expect, it } from 'vitest'
import { pickedDocumentName } from './android-picked-document-name'

// The name an incomplete saved file is left under, for the "delete it there" line: read from the
// URI Android's create-document picker returns, since the user can rename the file there and the
// provider renames it when the folder already holds one. Shapes from AOSP's ExternalStorageProvider
// (`<root>:<path>`) and DownloadsProvider (`raw:<path>`, `msf:<id>`, a bare id); not yet checked
// against a real picker on a phone.

describe('the name a picked document was saved under', () => {
  it('reads a renamed file in a phone-storage folder', () => {
    expect(
      pickedDocumentName(
        'content://com.android.externalstorage.documents/document/primary%3ADownload%2Freport%20(1).pdf'
      )
    ).toBe('report (1).pdf')
  })

  it('reads a file saved at the top of phone storage, with no folder', () => {
    expect(
      pickedDocumentName(
        'content://com.android.externalstorage.documents/document/primary%3Anotes.txt'
      )
    ).toBe('notes.txt')
  })

  it('reads a file on an SD card, whose root is a volume id', () => {
    expect(
      pickedDocumentName(
        'content://com.android.externalstorage.documents/document/1A2B-3C4D%3APapers%2Fthesis.pdf'
      )
    ).toBe('thesis.pdf')
  })

  it('reads a document picked through a folder the app was granted', () => {
    expect(
      pickedDocumentName(
        'content://com.android.externalstorage.documents/tree/primary%3ADownload/document/primary%3ADownload%2Fa.txt'
      )
    ).toBe('a.txt')
  })

  it('reads a Downloads document whose id is its path', () => {
    expect(
      pickedDocumentName(
        'content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2Fhello.txt'
      )
    ).toBe('hello.txt')
  })

  it('knows no name for a Downloads document whose id names a row', () => {
    expect(
      pickedDocumentName(
        'content://com.android.providers.downloads.documents/document/msf%3A1000001234'
      )
    ).toBeNull()
    expect(
      pickedDocumentName('content://com.android.providers.downloads.documents/document/9')
    ).toBeNull()
  })

  it('knows no name from a provider whose ids are its own', () => {
    expect(
      pickedDocumentName(
        'content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3Dencoded%3Dabc'
      )
    ).toBeNull()
  })

  it('knows no name for a path with nothing after its last slash, or no path at all', () => {
    expect(
      pickedDocumentName(
        'content://com.android.externalstorage.documents/document/primary%3ADownload%2F'
      )
    ).toBeNull()
    expect(
      pickedDocumentName('content://com.android.externalstorage.documents/document/primary%3A')
    ).toBeNull()
    expect(
      pickedDocumentName('content://com.android.externalstorage.documents/document/primary')
    ).toBeNull()
  })

  it('knows no name for a URI that is not a document, or does not decode', () => {
    expect(pickedDocumentName('')).toBeNull()
    expect(pickedDocumentName('file:///storage/emulated/0/Download/a.txt')).toBeNull()
    expect(
      pickedDocumentName('content://com.android.externalstorage.documents/tree/primary%3ADownload')
    ).toBeNull()
    expect(
      pickedDocumentName(
        'content://com.android.externalstorage.documents/document/primary%3ADownload%2F%E0%A4%A'
      )
    ).toBeNull()
  })
})
