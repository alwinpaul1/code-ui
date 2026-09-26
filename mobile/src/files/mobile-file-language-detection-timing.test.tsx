import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Copy: 'Copy',
  MessageSquare: 'MessageSquare',
  Send: 'Send',
  WrapText: 'WrapText',
  X: 'X'
}))
// The code viewer's Copy button writes through this; expo-clipboard cannot load here.
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))
vi.mock('../components/MobileHtmlPreview', () => ({ MobileHtmlPreview: 'MobileHtmlPreview' }))
vi.mock('./MobileFilePdfPreview', () => ({ MobileFilePdfPreview: 'MobileFilePdfPreview' }))
vi.mock('./MobileFileMarkdownPreview', () => ({ MobileFileMarkdownPreview: 'MobileFileMarkdownPreview' }))
vi.mock('../session/MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('../session/mobile-session-styles', () => ({ styles: {} }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('./mobile-file-preview-request', () => ({
  formatPreviewByteLength: (n: number) => `${n} B`
}))
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  return {
    useTheme: () => ({
      colors: tokens.colorsForScheme('dark'),
      syntax: palettes.syntaxPaletteForScheme('dark'),
      fonts: tokens.fontFamily,
      space: tokens.space,
      radius: { ...tokens.radius, xl: 24 },
      type: { ...tokens.type, label: { size: 13 } },
      isDark: true
    })
  }
})

/** Every read of a file's text for its language, whichever entry point. */
const reads = vi.hoisted(() => ({ count: 0 }))
vi.mock('../session/mobile-file-syntax', async () => {
  const actual = await vi.importActual<typeof import('../session/mobile-file-syntax')>('../session/mobile-file-syntax')
  return {
    ...actual,
    detectMobileSyntaxLanguage: (...args: Parameters<typeof actual.detectMobileSyntaxLanguage>) => {
      reads.count += 1
      return actual.detectMobileSyntaxLanguage(...args)
    },
    resolveMobileSyntaxLanguageForContent: (...args: Parameters<typeof actual.resolveMobileSyntaxLanguageForContent>) => {
      if (actual.resolveMobileSyntaxLanguage(args[0], args[2]) === 'plaintext') {
        reads.count += 1
      }
      return actual.resolveMobileSyntaxLanguageForContent(...args)
    }
  }
})

import { MobileFilePreviewSourceText } from './MobileFilePreviewSourceText'
import { FileReader } from '../session/MobileSessionFileReader'

// bin/deploy, over 4 KB: a script with no extension.
const SCRIPT = ['#!/usr/bin/env bash', 'set -euo pipefail', ...Array.from({ length: 200 }, (_, i) => `echo "step ${i}" # build`)].join('\n')

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  reads.count = 0
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function explorer(content: string, relativePath = 'bin/deploy') {
  return createElement(MobileFilePreviewSourceText, { relativePath, content })
}

function fileTab(content: string, relativePath = 'bin/deploy') {
  return createElement(FileReader, {
    doc: { status: 'ready', kind: 'file', content, truncated: false, byteLength: content.length },
    title: relativePath.split('/').at(-1),
    relativePath
  } as never)
}

describe.each([
  ['the explorer', explorer],
  ['a file tab', fileTab]
] as const)('finding the language of a file with no telling name, in %s', (_where, view) => {
  it('draws the file first, and reads it for its language a tick later', () => {
    act(() => {
      renderer = create(view(SCRIPT))
    })
    expect(reads.count).toBe(0)
    act(() => {
      vi.runAllTimers()
    })
    expect(reads.count).toBe(1)
  })

  it('does not read it again when the text changes past its first 4 KB', () => {
    act(() => {
      renderer = create(view(SCRIPT))
    })
    act(() => {
      vi.runAllTimers()
    })
    act(() => {
      renderer!.update(view(`${SCRIPT}\necho "one more line"`))
    })
    act(() => {
      vi.runAllTimers()
    })
    expect(reads.count).toBe(1)
  })

  it('never reads a file whose name places it', () => {
    act(() => {
      renderer = create(view('print("hi")\n', 'scripts/tool.py'))
    })
    act(() => {
      vi.runAllTimers()
    })
    expect(reads.count).toBe(0)
  })
})
