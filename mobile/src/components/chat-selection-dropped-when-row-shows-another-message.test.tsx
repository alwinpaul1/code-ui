import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MarkdownSelectionRoot } from './markdown-selection-copy.android'

// The user, 2026-10-15 (0.9.150): a selection held in a reply did not stay on its words while
// the chat scrolled. FlashList hands a row's native views to another message as it scrolls. The
// native root used to tell one message from the next only by the words: a Text given new text put
// its selection back wherever the same words stood at the same place, so a message that repeats
// the selected words at that offset (two replies opening "session:ok", a table cell's "used")
// took the selection over. The root now hears which message it draws (`documentKey`) and drops
// any selection held in it the moment that changes (SelectionCopyRootView.setDocumentKey); the
// chat's held selection, kept outside the rows, comes back only on the row whose key matches.

vi.mock('react-native', () => ({
  PixelRatio: { getFontScale: () => 1 },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  processColor: () => -1,
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function draw(document: string | undefined, scheme: 'light' | 'dark') {
  const tree = (
    <ThemeProvider initialPreference={scheme}>
      <MarkdownSelectionRoot document={document}>reply</MarkdownSelectionRoot>
    </ThemeProvider>
  )
  act(() => {
    if (renderer) {
      renderer.update(tree)
    } else {
      renderer = create(tree)
    }
  })
}

function nativeRoot() {
  return renderer!.root.findByType(NATIVE_ROOT as never)
}

describe('a recycled reply row never carries a selection to another message', () => {
  it.each(['light', 'dark'] as const)('tells the native root which message it draws (%s)', (scheme) => {
    draw('m1:0:0', scheme)
    expect(nativeRoot().props.documentKey).toBe('m1:0:0')
  })

  it.each(['light', 'dark'] as const)(
    'tells it again when the list hands the row to another message, so the root drops what it held (%s)',
    (scheme) => {
      draw('m1:0:0', scheme)
      act(() => {
        nativeRoot().props.onSelectionChange?.({
          nativeEvent: { active: true, run: 0, start: 4, end: 8, words: 'used' }
        })
      })
      draw('m2:0:0', scheme)
      expect(nativeRoot().props.documentKey).toBe('m2:0:0')
    }
  )

  it('names no message outside the chat, where no list recycles the document', () => {
    draw(undefined, 'light')
    expect(nativeRoot().props.documentKey).toBeUndefined()
  })
})
