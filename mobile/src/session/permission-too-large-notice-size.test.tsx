import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'
import type { MobileChatPermission } from './mobile-native-chat-permission'

// A proposed change too large to preview named its size as
// `${Math.round(totalBytes / 1024)} KB` whatever the size, so a Codex
// approval to delete a 5 MB file read "(5120 KB)". The size can pass a MB:
// Codex's file-change approval carries a deleted file's whole content (its
// `delete` change's diff is the raw file), and Orca's 16 KiB head bound
// counts every byte of it in its "N bytes total" marker (review, 2026-09-30).
// The notice now uses the file preview's byte formatter.

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('lucide-react-native', () => ({ ShieldQuestion: 'ShieldQuestion', X: 'X' }))
vi.mock('../components/TextInputModal', () => ({ TextInputModal: 'TextInputModal' }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

/** A Codex file-change approval as Orca 1.4.205 sends it: the changes as
 *  JSON, cut at its 16 KiB head bound with the host's own marker. */
function clippedDeletion(totalBytes: number): MobileChatPermission {
  const head = `[{"path":"assets/big.bin","kind":{"type":"delete"},"diff":"${'x'.repeat(200)}`
  return {
    title: 'Apply file changes?',
    detail: `${head}\n[Orca: output truncated — ${totalBytes} bytes total, digest 0a1b2c3d]`,
    options: [
      { label: 'Yes', send: 'y' },
      { label: 'No', send: 'n' }
    ]
  }
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function notice(permission: MobileChatPermission, scheme: 'light' | 'dark'): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatPermission permission={permission} onRespond={vi.fn(async () => true)} />
      </ThemeProvider>
    )
  })
  return renderer!.root.find(
    (node) => String(node.type) === 'Text' && /too large to preview/.test(String(node.props.children))
  )
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the too-large notice on a proposed change, %s', (scheme, palette) => {
  it('names a 5 MB change "5.0 MB", not "5120 KB"', () => {
    const line = notice(clippedDeletion(5 * 1024 * 1024), scheme)
    expect(line.props.children).toBe(
      'The change to big.bin is too large to preview here (5.0 MB); showing the request as sent.'
    )
    expect(flat(line.props.style).color).toBe(palette.textSecondary)
  })

  it('names a change just under a MB in MB, and a small one in KB as before', () => {
    expect(String(notice(clippedDeletion(1_048_064), scheme).props.children)).toContain('(1.0 MB)')
    expect(String(notice(clippedDeletion(20_000), scheme).props.children)).toContain('(20 KB)')
  })
})
