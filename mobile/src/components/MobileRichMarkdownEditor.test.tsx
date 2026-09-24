import { createElement, createRef, forwardRef, useImperativeHandle } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme, type Theme } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import {
  MobileRichMarkdownEditor,
  type MobileRichMarkdownEditorHandle
} from './MobileRichMarkdownEditor'

const mocks = vi.hoisted(() => ({
  dismissKeyboard: vi.fn(),
  injectJavaScript: vi.fn()
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    Keyboard: { dismiss: mocks.dismissKeyboard },
    Linking: { openURL: vi.fn() },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: unknown }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))

vi.mock('react-native-webview', () => {
  const WebView = forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({ injectJavaScript: mocks.injectJavaScript }))
    return createElement('WebView', props)
  })
  return { WebView, default: WebView }
})

vi.mock('lucide-react-native', () => ({
  Bold: 'Bold',
  ChevronDown: 'ChevronDown',
  Code2: 'Code2',
  FileCode2: 'FileCode2',
  Heading1: 'Heading1',
  Heading2: 'Heading2',
  Heading3: 'Heading3',
  ImageIcon: 'ImageIcon',
  Italic: 'Italic',
  Keyboard: 'Keyboard',
  Link: 'Link',
  List: 'List',
  ListOrdered: 'ListOrdered',
  ListTodo: 'ListTodo',
  Pilcrow: 'Pilcrow',
  Quote: 'Quote',
  Strikethrough: 'Strikethrough'
}))

describe('MobileRichMarkdownEditor', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.clearAllMocks()
  })

  // 2026-09-24: the editor read the static dark palette, so a phone set to
  // Light opened a dark editor in a light app. It opens in the theme in use,
  // and a switch while it is open reaches the document without rebuilding it,
  // which would throw away the caret.
  it('opens in the theme in use and follows a switch without reloading the document', () => {
    let theme: Theme | null = null
    function Grab(): null {
      theme = useTheme()
      return null
    }
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(Grab),
          createElement(MobileRichMarkdownEditor, { content: '', editable: true, onChange: vi.fn() })
        )
      )
    })
    const webView = () => renderer!.root.findByType('WebView' as never)
    const surfaces = () =>
      renderer!.root
        .findAllByType('View' as never)
        .map((node) => ([node.props.style].flat(Infinity) as { backgroundColor?: string }[]).find((entry) => entry?.backgroundColor)?.backgroundColor)
        .filter(Boolean)
    const html = String(webView().props.source.html)
    expect(html).toContain(`--background: ${lightColors.bg};`)
    expect(html).toContain('color-scheme: light;')
    expect(surfaces()).toContain(lightColors.bg)
    expect(surfaces()).not.toContain(darkColors.bg)

    mocks.injectJavaScript.mockClear()
    act(() => theme!.setPreference('dark'))

    expect(String(webView().props.source.html)).toBe(html)
    const injected = mocks.injectJavaScript.mock.calls.map((call) => String(call[0])).join('\n')
    expect(injected).toContain(darkColors.bg)
    expect(injected).toContain('color-scheme')
    expect(surfaces()).toContain(darkColors.bg)
    expect(surfaces()).not.toContain(lightColors.bg)
  })

  it('exposes WebView keyboard dismissal to its native parent', () => {
    const editorRef = createRef<MobileRichMarkdownEditorHandle>()
    act(() => {
      renderer = create(
        createElement(MobileRichMarkdownEditor, {
          ref: editorRef,
          content: '',
          editable: true,
          onChange: vi.fn()
        })
      )
    })

    act(() => editorRef.current?.dismissKeyboard())

    expect(mocks.injectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('window.__orcaRichMarkdown.dismissKeyboard()')
    )
    expect(mocks.dismissKeyboard).toHaveBeenCalledOnce()
  })
})
