import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileSyntaxLine } from './MobileSyntaxSegments'

vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s }
}))

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(props: Partial<Parameters<typeof MobileSyntaxLine>[0]> = {}) {
  act(() => {
    renderer = create(
      createElement(MobileSyntaxLine, {
        number: 7,
        segments: [
          { text: 'import ', kind: 'keyword' },
          { text: '{ createElement } from ', kind: 'plain' },
          { text: "'react'", kind: 'string' }
        ],
        gutterWidth: 28,
        gutterDigits: 2,
        lineStyle: { fontSize: 14 },
        gutterStyle: { color: '#999' },
        ...props
      })
    )
  })
  return renderer!
}

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(3) : [style]).filter(Boolean))
}

describe('a numbered source line', () => {
  it('keeps the number in its own column, beside the code, so a wrapped line continues under the code', () => {
    // Why: reported 2026-09-19 with a screenshot — a long import wrapped to
    // column zero under its line number, and the file read as prose. The
    // number was a span INSIDE the line's Text, so the wrap had no column to
    // return to. A row with a fixed gutter beside the code gives it one.
    const r = render()
    const texts = r.root.findAllByType('Text' as never)
    const gutter = texts.find((node) =>
      node.children.some((child) => typeof child === 'string' && child.includes('7'))
    )
    expect(gutter).toBeDefined()
    const code = texts.find((node) => node.findAllByType('Text' as never).length > 1 && node !== gutter)
    expect(code).toBeDefined()
    // Siblings under a row, not nested.
    expect(gutter!.parent).toBe(code!.parent)
    expect(gutter!.parent!.type).toBe('View')
    expect(flatStyle(gutter!.parent!)).toMatchObject({ flexDirection: 'row' })
    // The gutter holds its width and right-aligns, the code takes the rest.
    expect(flatStyle(gutter!)).toMatchObject({ width: 28, textAlign: 'right' })
    expect(flatStyle(code!)).toMatchObject({ flexShrink: 1 })
    expect(flatStyle(code!).flexGrow ?? flatStyle(code!).flex).toBeTruthy()
  })

  it('pads the number to the file\'s widest one', () => {
    const r = render({ number: 7, gutterDigits: 3 })
    const gutter = r.root
      .findAllByType('Text' as never)
      .find((node) => node.children.some((child) => typeof child === 'string' && child.includes('7')))
    expect(gutter!.children[0]).toBe('  7')
  })

  it('paints a selected line across the whole row', () => {
    const r = render({ highlighted: true, highlightStyle: { backgroundColor: '#123' } })
    const row = r.root.findAllByType('View' as never)[0]!
    expect(flatStyle(row)).toMatchObject({ backgroundColor: '#123' })
  })
})
