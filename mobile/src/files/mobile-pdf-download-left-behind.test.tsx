import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The PDF viewer's Download through the real device half (mobile-pdf-download-device.ts ->
// android-create-document.ts -> expo-file-system File), against a documents provider that refuses
// the write. The picker has already made the (empty) document by then. When the provider refuses
// the clean-up delete too, the empty PDF stays under the name the user chose, and the viewer used
// to say only "Couldn't save". The file save says so for the same case (574b1ad2).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  Share: { share: async () => {} },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ Check: 'Icon', Download: 'Icon' }))
const PICKED = 'content://com.android.providers.downloads.documents/document/9'
const disk = vi.hoisted(() => ({
  documents: new Map<string, string>(),
  refuseDelete: true,
  picked: ''
}))
vi.mock('expo-intent-launcher', () => ({
  ResultCode: { Success: -1 },
  startActivityAsync: async () => {
    // The picker makes the (empty) document the moment the user confirms it.
    disk.documents.set(disk.picked, '')
    return { resultCode: -1, data: disk.picked }
  }
}))
vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    write() {
      throw new Error('Unable to write: provider refused')
    }
    delete() {
      if (disk.refuseDelete) {
        throw new Error('Unable to delete: provider refused')
      }
      disk.documents.delete(this.uri)
    }
  },
  Paths: {}
}))
vi.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: async () => 'JVBERi0xLjcK'
}))

import { contrastRatio } from '../test/contrast'
import { ThemeProvider } from '../theme/theme-context'
import { MobileFilePdfPreview } from './MobileFilePdfPreview'

const LEFT_BEHIND = 'An incomplete paper.pdf is left where you chose to save it; delete it there'

let tree: ReactTestRenderer | null = null
beforeEach(() => {
  disk.documents.clear()
  disk.refuseDelete = true
  disk.picked = PICKED
})
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

async function tapDownload(scheme: 'light' | 'dark'): Promise<void> {
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileFilePdfPreview uri="file:///cache/orca-pdf-1.pdf" fileName="docs/paper.pdf" />
      </ThemeProvider>
    )
  })
  // The viewer mounts the document once its stored page is known.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const download = tree!.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Download PDF'
  )[0]!
  await act(async () => {
    download.props.onPress()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style as unknown
  const list = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
  return Object.assign({}, ...list)
}

function textNodes(): ReactTestInstance[] {
  return tree!.root.findAll((node) => String(node.type) === 'Text')
}

function textOf(node: ReactTestInstance): string {
  const children = node.props.children as unknown
  return (Array.isArray(children) ? children : [children])
    .filter((child) => typeof child === 'string')
    .join('')
}

function shown(): string[] {
  return textNodes().map(textOf)
}

/** The nearest ancestor that paints a surface. */
function surfaceUnder(node: ReactTestInstance): string {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    const background = typeof at.type === 'string' ? styleOf(at).backgroundColor : undefined
    if (typeof background === 'string') {
      return background
    }
  }
  throw new Error('no surface under the node')
}

describe('the PDF viewer Download when the provider will not take the file', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`tells the user an empty PDF is left where they chose to save it (${scheme})`, async () => {
      await tapDownload(scheme)

      expect([...disk.documents.keys()]).toEqual([PICKED])
      expect(shown()).toContain("Couldn't save")
      const notice = textNodes().find((node) => textOf(node) === LEFT_BEHIND)
      expect(notice, `viewer says ${JSON.stringify(shown())}`).toBeDefined()
      const ink = styleOf(notice!).color as string
      const surface = surfaceUnder(notice!)
      expect(contrastRatio(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    })
  }

  for (const scheme of ['light', 'dark'] as const) {
    it(`names the empty PDF by the name it was saved under, not the one offered (${scheme})`, async () => {
      // Renamed in the picker, or by the provider because a paper.pdf was already there. The
      // phone-storage provider's document ID carries the path.
      disk.picked =
        'content://com.android.externalstorage.documents/document/primary%3ADocuments%2Fpaper%20(1).pdf'
      await tapDownload(scheme)

      expect(shown()).toContain(
        'An incomplete paper (1).pdf is left where you chose to save it; delete it there'
      )
      expect(shown()).not.toContain(LEFT_BEHIND)
    })
  }

  it('says only that it could not save when the empty PDF was removed', async () => {
    disk.refuseDelete = false
    await tapDownload('light')

    expect(disk.documents.size).toBe(0)
    expect(shown()).toContain("Couldn't save")
    expect(shown().join('\n')).not.toMatch(/incomplete|delete it/i)
  })
})
