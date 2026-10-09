import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatTextSelectableContext } from './chat-text-selectable-context'
import { MobileMarkdown } from './MobileMarkdown'
import {
  TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY,
  TRANSCRIPT_MARKDOWN_TYPOGRAPHY
} from './mobile-markdown-prose-scale'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// 2026-10-09: on Android the chat transcript draws each prose run of a reply
// as ONE native TextView (modules/orca-native-prose) so its bullets can hang
// and sit apart as in the Claude app while a hold's selection still crosses
// the whole run. This is the wiring, with Android's module as Metro resolves
// it and a stand-in for its measure: the height the view gets is the one the
// measure gave, in the same render; the scroll gate still switches selection;
// a link tap still opens; and everything the native view cannot draw stays a
// Text.

const measure = vi.fn((_spec: string, _width: number) => 630)
// Stands in for processColor: one number per colour, so a test can tell
// which scheme a spec was drawn in.
const colorId = vi.hoisted(() => {
  const ids = new Map<string, number>()
  return (color: string): number => {
    if (!ids.has(color)) {
      ids.set(color, ids.size + 1)
    }
    return ids.get(color)!
  }
})
const openExternalLink = vi.fn()

vi.mock('react-native', () => ({
  Image: Object.assign(() => null, { getSize: () => undefined }),
  Linking: { openURL: () => Promise.resolve() },
  PixelRatio: { get: () => 3 },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  processColor: (color: string) => colorId(color)
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('../platform/external-link', () => ({ openExternalLink: (url: string) => openExternalLink(url) }))
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    name === 'OrcaNativeProse' ? { measure: (spec: string, width: number) => measure(spec, width) } : null,
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('./native-prose-text', () => import('./native-prose-text.android'))

const NATIVE = 'ViewManagerAdapter_OrcaNativeProse'

const REPLY = [
  'Two cases:',
  '',
  '- **Wide pane:** every tab gets the ring, see [docs](https://example.com/ring).',
  '- **Narrow pane:** no ring.'
].join('\n')

function nativeViews(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => String(node.type) === NATIVE)
}

function texts(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => String(node.type) === 'Text' && node.props.selectable !== undefined)
}

describe('a transcript reply on Android, drawn by the native prose view', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    measure.mockClear()
    measure.mockImplementation(() => 630)
    openExternalLink.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(element: ReactElement): ReactTestInstance {
    act(() => {
      renderer = create(element)
    })
    return renderer!.root
  }

  function layOut(root: ReactTestInstance, width: number): void {
    const document = root.find((node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function')
    act(() => {
      document.props.onLayout({ nativeEvent: { layout: { width, height: 0, x: 0, y: 0 } } })
    })
  }

  it('is one native view as tall as the measure says, laid out at the width it was measured at', () => {
    const root = render(createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }))
    layOut(root, 380.4)
    const views = nativeViews(root)
    expect(views).toHaveLength(1)
    const view = views[0]!
    expect(view.props.layoutWidth).toBe(1141)
    expect(measure).toHaveBeenLastCalledWith(view.props.spec, 1141)
    expect(view.props.style).toEqual({ height: 631 / 3 })
    const spec = JSON.parse(view.props.spec as string)
    expect(spec.model.text).toBe(
      'Two cases:\n\n• Wide pane: every tab gets the ring, see docs.\n• Narrow pane: no ring.'
    )
    expect(texts(root)).toHaveLength(0)
  })

  it('mounts a later reply at its height at once, from the width replies last had', () => {
    const reply = (content: string) =>
      createElement(MobileMarkdown, { content, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, widthKey: 'reply' })
    const first = render(reply(REPLY))
    layOut(first, 360)
    act(() => renderer?.unmount())
    // A plan card in the same type, narrower inside its card padding.
    const card = render(
      createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, widthKey: 'plan' })
    )
    layOut(card, 320)
    act(() => renderer?.unmount())
    measure.mockClear()
    const later = render(reply('Another reply.'))
    // No layout yet for this one.
    const views = nativeViews(later)
    expect(views).toHaveLength(1)
    expect(views[0]!.props.layoutWidth).toBe(1080)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure).toHaveBeenCalledWith(expect.any(String), 1080)
  })

  it('waits for its own layout where the surface has no width key', () => {
    const first = render(
      createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 1.3 })
    )
    layOut(first, 360)
    act(() => renderer?.unmount())
    const later = render(
      createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY, textScale: 1.3 })
    )
    expect(nativeViews(later)).toHaveLength(0)
    layOut(later, 360)
    expect(nativeViews(later)).toHaveLength(1)
  })

  it('draws as a Text until the surface has ever had a width', () => {
    const root = render(
      createElement(MobileMarkdown, {
        content: REPLY,
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
        textScale: 1.7,
        widthKey: 'reply'
      })
    )
    expect(nativeViews(root)).toHaveLength(0)
    expect(texts(root)).toHaveLength(1)
    layOut(root, 300)
    expect(nativeViews(root)).toHaveLength(1)
  })

  it('switches selection with the scroll gate, off while the list moves', () => {
    const tree = (selectable: boolean) =>
      createElement(
        ChatTextSelectableContext.Provider,
        { value: selectable },
        createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
      )
    const root = render(tree(true))
    layOut(root, 380.4)
    expect(nativeViews(root)[0]!.props.selectable).toBe(true)
    act(() => renderer!.update(tree(false)))
    expect(nativeViews(root)[0]!.props.selectable).toBe(false)
  })

  it('opens a tapped link', () => {
    const root = render(createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }))
    layOut(root, 380.4)
    act(() => nativeViews(root)[0]!.props.onLinkPress({ nativeEvent: { link: 0 } }))
    expect(openExternalLink).toHaveBeenCalledWith('https://example.com/ring')
  })

  it('opens a tapped file path in the file viewer', () => {
    const onOpenFile = vi.fn()
    const root = render(
      createElement(MobileMarkdown, {
        content: 'Changed `mobile/src/app.ts`.',
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
        onOpenFile
      })
    )
    layOut(root, 380.4)
    act(() => nativeViews(root)[0]!.props.onLinkPress({ nativeEvent: { link: 0 } }))
    expect(onOpenFile).toHaveBeenCalledWith('mobile/src/app.ts')
    // A link index the model does not have opens nothing.
    act(() => nativeViews(root)[0]!.props.onLinkPress({ nativeEvent: { link: 5 } }))
    expect(onOpenFile).toHaveBeenCalledTimes(1)
  })

  for (const [scheme, colors] of [
    ['light', lightColors],
    ['dark', darkColors]
  ] as const) {
    it(`draws in the ${scheme} theme the reader chose`, () => {
      const root = render(
        <ThemeProvider initialPreference={scheme}>
          <MobileMarkdown content={REPLY} typography={TRANSCRIPT_MARKDOWN_TYPOGRAPHY} />
        </ThemeProvider>
      )
      layOut(root, 380.4)
      const spec = JSON.parse(nativeViews(root)[0]!.props.spec as string)
      expect(spec.colors.text).toBe(colorId(colors.text))
      expect(spec.colors.codeBackground).toBe(colorId(colors.codeSpanBg))
      expect(spec.colors.link).toBe(colorId(colors.accentText))
      expect(colors.text).not.toBe((scheme === 'light' ? darkColors : lightColors).text)
    })
  }

  it('keeps a lead prompt in a bubble as the Text it always was', () => {
    const root = render(
      createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY })
    )
    layOut(root, 380.4)
    expect(nativeViews(root)).toHaveLength(0)
    expect(texts(root)).toHaveLength(1)
  })

  it('keeps a run with an image in it a Text, and the rest of the reply native', () => {
    const root = render(
      createElement(MobileMarkdown, {
        content: '![plot](fig/plot.svg)\n\n```\ncode\n```\n\nAfter the fence.',
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY
      })
    )
    layOut(root, 380.4)
    expect(nativeViews(root)).toHaveLength(1)
    expect(JSON.parse(nativeViews(root)[0]!.props.spec as string).model.text).toBe('After the fence.')
  })

  it('falls back to Text for the whole reply when the native side refuses to measure it', () => {
    measure.mockImplementation(() => -1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const root = render(createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }))
    layOut(root, 380.4)
    expect(nativeViews(root)).toHaveLength(0)
    expect(texts(root)).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not measure'))
    warn.mockRestore()
  })

  it('tries native again when a recycled row shows another message after a refusal', () => {
    measure.mockImplementation(() => -1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const root = render(createElement(MobileMarkdown, { content: REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }))
    layOut(root, 380.4)
    expect(nativeViews(root)).toHaveLength(0)
    measure.mockImplementation(() => 630)
    act(() =>
      renderer!.update(
        createElement(MobileMarkdown, { content: 'The next message.', typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY })
      )
    )
    expect(nativeViews(root)).toHaveLength(1)
    warn.mockRestore()
  })
})
