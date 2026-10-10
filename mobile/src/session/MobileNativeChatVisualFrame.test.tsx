import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeScheme } from '../theme/tokens'

// Orca #26071 pinned a visual to the phone's one dark palette. This app has light and dark, so a
// visual takes the reader's scheme: the page it runs in gets that scheme's colours, and a switch
// rebuilds it.

const openExternalLink = vi.fn()

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length).fill(171) }))
vi.mock('../platform/external-link', () => ({ openExternalLink: (url: string) => openExternalLink(url) }))

import { MobileNativeChatVisualFrame } from './MobileNativeChatVisualFrame'

describe('MobileNativeChatVisualFrame', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    openExternalLink.mockClear()
  })

  function webView(scheme: ThemeScheme, onFailed = vi.fn()): ReactTestInstance {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatVisualFrame html="<p>chart</p>" title="Usage" mode="inline" onFailed={onFailed} />
        </ThemeProvider>
      )
    })
    return renderer!.root.find((node) => String(node.type) === 'WebView')
  }

  /** The visual's own document, as the host page hands it to its sandboxed frame. */
  function visualDocument(view: ReactTestInstance): string {
    const host = String((view.props.source as { html: string }).html)
    const literal = /frame\.srcdoc = (".*")\n/.exec(host)?.[1]
    expect(literal).toBeDefined()
    return JSON.parse(literal!) as string
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('styles the visual in the %s scheme the reader is in', (scheme, colors) => {
    const document = visualDocument(webView(scheme))
    expect(document).toContain(`<html class="${scheme}">`)
    expect(document).toContain(`color-scheme:${scheme}`)
    expect(document).toContain(`--background:${colors.bg}`)
    expect(document).toContain(`--foreground:${colors.text}`)
    expect(document).toContain(`--border:${colors.border}`)
  })

  it('loads only its own documents and in-page anchors, never another page', () => {
    const allows = webView('light').props.onShouldStartLoadWithRequest as (request: { url: string }) => boolean
    expect(allows({ url: 'about:blank' })).toBe(true)
    expect(allows({ url: 'about:srcdoc' })).toBe(true)
    expect(allows({ url: 'about:srcdoc#section' })).toBe(true)
    expect(allows({ url: 'https://example.com/' })).toBe(false)
    expect(allows({ url: 'javascript:alert(1)' })).toBe(false)
    expect(allows({ url: 'file:///etc/passwd' })).toBe(false)
  })

  it('drops a message without the host page token, and fails on an escaped frame that carries it', () => {
    const onFailed = vi.fn()
    const view = webView('light', onFailed)
    const onMessage = view.props.onMessage as (event: { nativeEvent: { data: unknown } }) => void
    act(() => onMessage({ nativeEvent: { data: JSON.stringify({ kind: 'escaped' }) } }))
    expect(onFailed).not.toHaveBeenCalled()
    const token = /"token":"([0-9a-f]+)"/.exec(String((view.props.source as { html: string }).html))?.[1]
    act(() => onMessage({ nativeEvent: { data: JSON.stringify({ token, kind: 'escaped' }) } }))
    expect(onFailed).toHaveBeenCalledTimes(1)
  })
})
