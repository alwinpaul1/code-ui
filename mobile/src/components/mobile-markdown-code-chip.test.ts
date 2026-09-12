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
