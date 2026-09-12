import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INLINE_CODE_CHIP_MAX_CHARS, MobileMarkdown, isInlineCodeChip } from './MobileMarkdown'

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
// bordered "squircle" chip. Android cannot round a nested Text's background,
// so a short span is a real inline View; a long one must still wrap, so it
// stays a nested Text.
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

  it('keeps a long span as wrapping text, not a chip', () => {
    const long = 'x'.repeat(INLINE_CODE_CHIP_MAX_CHARS + 1)
    const root = render(`See \`${long}\` here.`)
    expect(root.findAll((node) => node.type === 'View' && node.props.style?.borderRadius === 7)).toHaveLength(0)
    expect(root.findAll((node) => node.type === 'Text' && node.children.join('') === long)).toHaveLength(1)
  })

  it('draws the line between chip and text at the cap, and never chips a multi-line span', () => {
    expect(isInlineCodeChip('a'.repeat(INLINE_CODE_CHIP_MAX_CHARS))).toBe(true)
    expect(isInlineCodeChip('a'.repeat(INLINE_CODE_CHIP_MAX_CHARS + 1))).toBe(false)
    expect(isInlineCodeChip('a\nb')).toBe(false)
    expect(isInlineCodeChip('')).toBe(false)
  })
})
