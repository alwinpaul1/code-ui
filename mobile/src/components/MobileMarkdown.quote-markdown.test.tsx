import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'
import {
  QUOTED_EMAIL_DETAILS,
  QUOTED_EMAIL_REPLY,
  QUOTED_EMAIL_SIGN_OFF
} from './mobile-markdown-quote-email.test-support'
import { NATIVE_PROSE_LIST_INDENT } from './native-prose-model'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, space } from '../theme/tokens'

// The email draft quoted in a reply (mobile-markdown-quote-email.test-support.ts),
// as the transcript draws it on Android: the quote's bar is a View, and its
// insides are the native prose view every other run of the reply is, so its
// bullets hang and its details break line by line as the Claude app draws them.

const measure = vi.fn((_spec: string, _width: number) => 630)
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
const BAR = 3

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

function quoteViews(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) => String(node.type) === 'View' && JSON.stringify(node.props.style ?? '').includes('borderLeftWidth')
  )
}

describe('an email draft quoted in a reply, drawn in the transcript', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    measure.mockClear()
    openExternalLink.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(element: ReactElement, width: number | null): ReactTestInstance {
    act(() => {
      renderer = create(element)
    })
    const root = renderer!.root
    if (width !== null) {
      const document = root.find((node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function')
      act(() => {
        document.props.onLayout({ nativeEvent: { layout: { width, height: 0, x: 0, y: 0 } } })
      })
    }
    return root
  }

  it('draws the quote natively inside its bar, with hanging bullets and a line per detail', () => {
    const root = render(
      createElement(MobileMarkdown, { content: QUOTED_EMAIL_REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }),
      380
    )
    const quotes = quoteViews(root)
    expect(quotes).toHaveLength(1)
    const inside = quotes[0]!.findAll((node) => String(node.type) === NATIVE)
    expect(inside).toHaveLength(1)
    // Inset by the bar and the space beside it.
    expect(inside[0]!.props.layoutWidth).toBe(Math.floor((380 - BAR - space.md) * 3))
    const { model } = JSON.parse(inside[0]!.props.spec as string)
    const items = model.paragraphs.filter((paragraph: { kind: string }) => paragraph.kind === 'item')
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.indent).toBe(NATIVE_PROSE_LIST_INDENT)
      expect(item.hang).toBe(2)
    }
    expect(model.text).toContain('• Radiation Safety training\n• IV Skills')
    expect(model.text).toContain(QUOTED_EMAIL_DETAILS)
    expect(model.text).toContain(QUOTED_EMAIL_SIGN_OFF)
    expect(model.text).not.toContain('- Radiation Safety')
  })

  it('opens the address as a mail link', () => {
    const root = render(
      createElement(MobileMarkdown, { content: QUOTED_EMAIL_REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }),
      380
    )
    const view = quoteViews(root)[0]!.find((node) => String(node.type) === NATIVE)
    act(() => view.props.onLinkPress({ nativeEvent: { link: 0 } }))
    expect(openExternalLink).toHaveBeenCalledWith('mailto:alex.morgan42@example.com')
  })

  it('draws the same Markdown as a Text where the native view is not used', () => {
    // Before the surface has a width, the run is a React Native Text.
    const root = render(
      createElement(MobileMarkdown, { content: QUOTED_EMAIL_REPLY, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }),
      null
    )
    const quote = quoteViews(root)[0]!
    expect(quote.findAll((node) => String(node.type) === NATIVE)).toHaveLength(0)
    const drawn = textOf(quote)
    expect(drawn).toMatch(/•\s+Radiation Safety training\n•\s+IV Skills/)
    expect(drawn).toContain(QUOTED_EMAIL_DETAILS)
    expect(drawn).toContain(QUOTED_EMAIL_SIGN_OFF)
    expect(drawn).not.toContain('- Radiation Safety')
    // A blank line between paragraphs is one newline pair, never two.
    expect(drawn).not.toContain('\n\n\n')
    const link = quote.find(
      (node) => String(node.type) === 'Text' && typeof node.props.onPress === 'function' && textOf(node) === 'alex.morgan42@example.com'
    )
    act(() => link.props.onPress())
    expect(openExternalLink).toHaveBeenCalledWith('mailto:alex.morgan42@example.com')
  })

  it('draws a quote inside the quote as a bar of its own, inset by the outer one', () => {
    const root = render(
      createElement(MobileMarkdown, {
        content: '> outer\n>\n> > - inner item\n>\n> after',
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY
      }),
      380
    )
    const [outer, inner] = quoteViews(root)
    expect(quoteViews(root)).toHaveLength(2)
    expect(outer!.findAll((node) => node === inner)).toHaveLength(1)
    const innerProse = inner!.find((node) => String(node.type) === NATIVE)
    expect(innerProse.props.layoutWidth).toBe(Math.floor((380 - 2 * (BAR + space.md)) * 3))
    expect(JSON.parse(innerProse.props.spec as string).model.text).toBe('• inner item')
    const outerTexts = outer!.findAll((node) => String(node.type) === NATIVE).map(
      (node) => JSON.parse(node.props.spec as string).model.text as string
    )
    expect(outerTexts).toEqual(['outer', '• inner item', 'after'])
  })

  describe('at the degenerate sizes', () => {
    it('draws an empty quote as its bar beside one empty line, so the bar has a height', () => {
      // Review, 2026-10-10: a members-less quote drew a bar with nothing in it,
      // no line height at all; it held an empty Text before.
      for (const content of ['>', '> - ']) {
        const root = render(createElement(MobileMarkdown, { content, typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }), 380)
        const quotes = quoteViews(root)
        expect(quotes, content).toHaveLength(1)
        const inside = quotes[0]!.findAll((node) => String(node.type) === NATIVE)
        expect(inside.map((node) => JSON.parse(node.props.spec as string).model.text), content).toEqual([''])
        act(() => renderer?.unmount())
        renderer = null
      }
    })

    it('draws a one-line quote as one native run in its bar', () => {
      const root = render(createElement(MobileMarkdown, { content: '> a', typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }), 380)
      const inside = quoteViews(root)[0]!.findAll((node) => String(node.type) === NATIVE)
      expect(inside.map((node) => JSON.parse(node.props.spec as string).model.text)).toEqual(['a'])
    })

    it('draws a one-item list in a quote as one hanging bullet', () => {
      const root = render(createElement(MobileMarkdown, { content: '> - a', typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY }), 380)
      const { model } = JSON.parse(quoteViews(root)[0]!.find((node) => String(node.type) === NATIVE).props.spec as string)
      expect(model.text).toBe('• a')
      expect(model.paragraphs).toMatchObject([{ kind: 'item', indent: NATIVE_PROSE_LIST_INDENT, hang: 2, spaceAfter: 0 }])
    })
  })

  for (const [scheme, colors] of [
    ['light', lightColors],
    ['dark', darkColors]
  ] as const) {
    it(`draws the bar and the link in the ${scheme} theme's own colours`, () => {
      const root = render(
        <ThemeProvider initialPreference={scheme}>
          <MobileMarkdown content={QUOTED_EMAIL_REPLY} typography={TRANSCRIPT_MARKDOWN_TYPOGRAPHY} />
        </ThemeProvider>,
        380
      )
      const quote = quoteViews(root)[0]!
      expect(JSON.stringify(quote.props.style)).toContain(colors.borderStrong)
      const spec = JSON.parse(quote.find((node) => String(node.type) === NATIVE).props.spec as string)
      expect(spec.colors.link).toBe(colorId(colors.accentText))
      expect(spec.colors.text).toBe(colorId(colors.text))
      expect(colors.accentText).not.toBe((scheme === 'light' ? darkColors : lightColors).accentText)
    })
  }
})
