import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown, isInlineCodeChip } from './MobileMarkdown'
import { INLINE_CODE_CHIP_MAX_CHARS } from './mobile-markdown-code-chip-split'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// 2026-09-12: the user wants inline code as in the Claude app — a rounded,
// bordered "squircle" chip, every time. Android cannot round a nested Text's
// background, so a span is a real inline View; a long one becomes several
// pills that wrap, cut after a slash or space like the Claude app does.
describe('inline code chips', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(content: string): ReactTestInstance {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content }))
    })
    return renderer!.root
  }

  it('renders a short span as a rounded View chip with the code inside', () => {
    const root = render('Run `pnpm install` first.')
    const chip = root.findAll((node) => node.type === 'View' && node.props.style?.borderRadius === 7)
    expect(chip).toHaveLength(1)
    const text = chip[0]!.findByType('Text' as never)
    expect(text.children.join('')).toBe('pnpm install')
  })

  it('splits a long path into pills that wrap, cut after the slash like the Claude app', () => {
    const root = render('APK at `~/Desktop/code-ui-android-v0.5.17-139.apk` for you.')
    const chips = root.findAll((node) => node.type === 'View' && node.props.style?.borderRadius === 7)
    expect(chips.map((chip) => chip.findByType('Text' as never).children.join(''))).toEqual([
      '~/Desktop/',
      'code-ui-android-v0.5.17-139.apk'
    ])
  })

  it('chips a span longer than the cap too, and never chips a multi-line span', () => {
    expect(isInlineCodeChip('a'.repeat(INLINE_CODE_CHIP_MAX_CHARS + 1))).toBe(true)
    expect(isInlineCodeChip('a\nb')).toBe(false)
    expect(isInlineCodeChip('')).toBe(false)
  })
})

// 2026-09-19, from a phone screenshot beside the Claude app: an answer that
// wrote "`` `user` `` becomes `user`, blank lines vanish, rows hard-wrap…"
// drew an empty chip, "user", another empty chip, "becomes" as a chip, and
// then the REST OF THE PARAGRAPH as chips, one per line. The Claude app drew
// `user` (backticks and all) as one chip and `user` as another. The inline
// rule was "a backtick, then anything up to the next backtick": it knew
// nothing of CommonMark's backtick runs, where a span opened by N backticks
// closes only at a run of exactly N, and a run with no match is literal.
describe('backtick runs (CommonMark code spans)', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  function chips(content: string): string[] {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content }))
    })
    return renderer!.root
      .findAll((node) => node.type === 'View' && node.props.style?.borderRadius === 7)
      .map((chip) => chip.findByType('Text' as never).children.join(''))
  }

  it('closes a double-backtick span only at the next double run, so a backtick can sit inside a chip', () => {
    expect(
      chips(
        'Claude Code 2.1.278 paints a queued prompt as rendered markdown: `` `user` `` becomes `user`, blank lines vanish, rows hard-wrap at the phone\'s PTY width.'
      )
    ).toEqual(['`user`', 'user'])
  })

  it('keeps a run with no partner literal instead of chipping the rest of the paragraph', () => {
    // A lone backtick with nothing to close it, and a double run whose only
    // later run is a single: both literal (CommonMark). The single after the
    // double is literal too, since nothing follows it.
    expect(chips('a stray ` here and nothing after')).toEqual([])
    expect(chips('a ``double with no partner, then `real` here')).toEqual(['real'])
  })

  it('strips one space of padding, not more, and keeps a span of triple backticks inside single ones', () => {
    expect(chips('see `  two  ` and ` ``` ` here')).toEqual([' two ', '```'])
  })
})

// Jev's likeliest remaining gap after the run fix (2026-09-19): an emphasis
// token that opens before a code span and closes INSIDE it won by earliest
// index and swallowed the span's opener. CommonMark binds code spans tighter
// than emphasis, so the chip wins and the lone `*` stays literal.
describe('a code span inside an emphasis candidate', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  it('keeps the chip when a star pair would cut through it', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: 'see *a `b*` c and `d`' }))
    })
    const chips = renderer!.root
      .findAll((node) => node.type === 'View' && node.props.style?.borderRadius === 7)
      .map((chip) => chip.findByType('Text' as never).children.join(''))
    expect(chips).toEqual(['b*', 'd'])
  })
})

// 2026-09-20, phone: "**Alphabetical `/` menu.** Commands…" drew the chip
// with the `**` left literal on either side. The rule that lets a code span
// win over an emphasis token that ends INSIDE it was written as "ends after
// the span starts", which also threw away a bold that simply contains one.
describe('bold around a code span', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  it('stays bold, with the chip inside it and no literal stars', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: '**Alphabetical `/` menu.** Commands and skills' }))
    })
    const root = renderer!.root
    const strings = root
      .findAll((node) => node.type === 'Text')
      .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    expect(strings.join('')).not.toContain('**')
    const chips = root.findAll((node) => node.type === 'View' && node.props.style?.borderRadius === 7)
    expect(chips.map((chip) => chip.findByType('Text' as never).children.join(''))).toEqual(['/'])
    // A bold Text holds the chip.
    const boldWithChip = root.findAll(
      (node) =>
        node.type === 'Text' &&
        [node.props.style].flat(3).some((style) => style && typeof style === 'object' && 'fontFamily' in style && String(style.fontFamily).toLowerCase().includes('semibold')) &&
        node.findAll((inner) => inner.type === 'View' && inner.props.style?.borderRadius === 7).length === 1
    )
    expect(boldWithChip.length).toBeGreaterThan(0)
  })
})
