import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { MobileMarkdown } from './MobileMarkdown'
import { createPhone, flatStyle, flattenForPhone, layOut } from './mobile-markdown-code-pill-phone.test-support'
import { pillRows } from './mobile-markdown-pill-rows.test-support'
import { makeMarkdownStyles } from './mobile-markdown-styles'
import { resetRememberedPillCutsForTests } from './use-markdown-code-pill-runs'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { get: () => 2.8125, getFontScale: () => 1 },
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: scheme === 'dark' ? darkColors : lightColors,
    syntax: syntaxPaletteForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

let renderer: ReactTestRenderer | null = null
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetRememberedPillCutsForTests()
})

/** A chat reply's width on a Galaxy S23 Ultra: 384 dp less the row's 16 dp
 *  each side (mobile-native-chat-message-styles.ts). */
const CHAT_WIDTH = 352
/** The Claude Android app, 2026-09-28, the same reply as Code UI drew it
 *  (screenshots of 1015 px scaled from the phone's 1080: 2.643 px per dp):
 *  a line every 57.5 px, 17.5 px more between paragraphs, 8.5 px more
 *  between list items, a bullet 21 px in from the words' edge and its text
 *  41 px in. Code UI drew 67 px lines with a whole blank line between
 *  paragraphs, and wrapped each line a word or so sooner. */
const CLAUDE = {
  line: 57.5 / 2.643,
  paragraphGap: 17.5 / 2.643,
  itemGap: 8.5 / 2.643,
  bullet: 21 / 2.643,
  itemText: 41 / 2.643
}

/** The prose Text of what is rendered: the Text the document's View holds. */
function proseText(): ReactTestInstance {
  const root = renderer!.root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
  return root.children.find((child): child is ReactTestInstance => typeof child !== 'string' && child.type === ('Text' as never))!
}

function render(content: string, width = CHAT_WIDTH) {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content }))
  })
  act(() => device.layOutDocument(width))
}

describe.each(['light', 'dark'] as const)('Markdown body type beside the Claude app in %s', (scheme) => {
  const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Record<string, { fontSize: number; lineHeight: number }>

  it('sets a line of prose at the Claude app pitch', () => {
    for (const key of ['paragraph', 'listText', 'quoteText', 'tableCell']) {
      expect(styles[key]!.lineHeight, key).toBeCloseTo(CLAUDE.line, 0)
    }
    // As a share of what it was: 0.87 of 25 dp.
    expect(styles.paragraph!.lineHeight / 25).toBeCloseTo(0.87, 3)
  })

  it('sets the words smaller, 0.925 of what they were, headings and cells alike', () => {
    expect(styles.paragraph!.fontSize / 15).toBeCloseTo(0.925, 3)
    expect(styles.headingLevel1!.fontSize / 22).toBeCloseTo(0.925, 3)
    expect(styles.headingLevel2!.fontSize / 19).toBeCloseTo(0.925, 3)
    expect(styles.headingLevel3!.fontSize / 17).toBeCloseTo(0.925, 3)
    expect(styles.heading!.fontSize / 16).toBeCloseTo(0.925, 3)
    expect(styles.tableCell!.fontSize / 13).toBeCloseTo(0.925, 3)
  })
})

// The reply both apps drew (2026-09-28), verbatim.
const LIKELY_CAUSE =
  "**Likely cause:** each pill is nudged down by a fixed amount tuned for paragraph text. That amount ignores the height of the line it sits in, so it's wrong in headings and on these wrapped list lines."
const TARGET =
  '**Target:** pills sit on the same row as their words in paragraphs, headings, lists and tables, with no overlap. The earlier pill fixes stay intact: no clipping, wrapping, system font size and zoom. It has to be tested fail-first, reviewed, and then pass the full gate.'

function lines(content: string): string[] {
  render(content)
  const text = proseText()
  return layOut(flattenForPhone(text, Number(flatStyle(text.props.style).fontSize), {}, []), CHAT_WIDTH).map((line) =>
    line.text.trimEnd()
  )
}

// Instrument Sans is not the Claude app's face, and no size of it breaks
// every line of these two paragraphs where the Claude app does: "ignores"
// joins the second line of "Likely cause:" only at 14.0 sp or under, and
// "headings" leaves the third, as "fail-first," leaves the fourth of
// "Target:", only above 14.15. At 13.875 the first two and the first three
// break at the Claude app's words, and each paragraph's next line takes one
// word more than the Claude app's.
describe('a chat reply wraps where the Claude app wraps it', () => {
  it('breaks "Likely cause:" at the Claude app words', () => {
    expect(lines(LIKELY_CAUSE)).toEqual([
      'Likely cause: each pill is nudged down by a fixed',
      'amount tuned for paragraph text. That amount ignores',
      // The Claude app: "…so it's wrong in" / "headings and on these…".
      "the height of the line it sits in, so it's wrong in headings",
      'and on these wrapped list lines.'
    ])
  })

  it('breaks "Target:" at the Claude app words', () => {
    expect(lines(TARGET)).toEqual([
      'Target: pills sit on the same row as their words in',
      'paragraphs, headings, lists and tables, with no overlap.',
      'The earlier pill fixes stay intact: no clipping, wrapping,',
      // The Claude app: "…It has to be tested" / "fail-first, reviewed…".
      'system font size and zoom. It has to be tested fail-first,',
      'reviewed, and then pass the full gate.'
    ])
  })
})

/** The drawn lines of the prose Text, from the pill rows model. */
function drawn(content: string) {
  render(content)
  return pillRows(proseText(), CHAT_WIDTH, {}).drawn
}

describe('the space between blocks, as the Claude app leaves it', () => {
  it('leaves a paragraph gap, not a whole blank line, between paragraphs', () => {
    const stack = drawn('First paragraph here.\n\nSecond paragraph here.')
    // The words, the gap, the words.
    expect(stack.map((line) => line.text)).toEqual(['First paragraph here.\n', '\n', 'Second paragraph here.'])
    expect(stack[1]!.height).toBeCloseTo(CLAUDE.paragraphGap, 0)
  })

  it('leaves a list item gap between items, and the paragraph gap around the list', () => {
    const stack = drawn('Where it happens:\n\n- **Headings:** one\n- **Bold-label list lines:** two\n\nAfter.')
    const gaps = stack.filter((line) => line.text === '\n').map((line) => line.height)
    expect(gaps).toHaveLength(3)
    expect(gaps[0]).toBeCloseTo(CLAUDE.paragraphGap, 0)
    expect(gaps[1]).toBeCloseTo(CLAUDE.itemGap, 0)
    expect(gaps[2]).toBeCloseTo(CLAUDE.paragraphGap, 0)
  })

  it('keeps more room before a heading than between paragraphs, so a section still reads as one', () => {
    const stack = drawn('A paragraph.\n\n## A heading\n\nIts section.')
    const gaps = stack.filter((line) => line.text === '\n').map((line) => line.height)
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toBeGreaterThanOrEqual(2 * CLAUDE.paragraphGap)
    expect(gaps[1]).toBeCloseTo(CLAUDE.paragraphGap, 0)
  })
})

describe('a list item, as the Claude app sets it', () => {
  it('puts its bullet and its words where the Claude app does', () => {
    render('- **Headings:** has pills floating half a line above the words.')
    const text = proseText()
    const items = flattenForPhone(text, Number(flatStyle(text.props.style).fontSize), {}, [])
    const bullet = items.findIndex((item) => item.kind === 'char' && item.ch === '•')
    const words = items.findIndex((item) => item.kind === 'char' && item.ch === 'H')
    const at = (index: number) => items.slice(0, index).reduce((sum, item) => sum + item.width, 0)
    // Within a dp and a half of the bullet's middle, and a dp of the words.
    expect(Math.abs(at(bullet) + items[bullet]!.width / 2 - CLAUDE.bullet)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(at(words) - CLAUDE.itemText)).toBeLessThanOrEqual(1)
  })
})
