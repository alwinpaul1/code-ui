import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileSyntaxLine } from './MobileSyntaxSegments'
import { instrumentSansTextStyle } from '../theme/instrument-sans-text'
import { fontFamily } from '../theme/tokens'
import { lightSyntaxPalette } from '../theme/syntax-palette'

vi.mock('react-native', () => {
  // A real flatten: the Instrument Sans hook reads the flattened style to
  // decide whether a Text already names its face.
  function flatten(style: unknown): Record<string, unknown> | undefined {
    if (style == null || style === false) {
      return undefined
    }
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map((item) => flatten(item) ?? {}))
    }
    return typeof style === 'object' ? { ...(style as Record<string, unknown>) } : undefined
  }
  return {
    Text: 'Text',
    View: 'View',
    StyleSheet: { create: (s: unknown) => s, flatten }
  }
})

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
        palette: lightSyntaxPalette,
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

  it('draws every coloured span in the code face, so the app-wide UI face cannot replace it', () => {
    // Why: reported 2026-09-26 with a screenshot of lever_energy.py — the
    // line numbers were monospace and the code beside them was not. The line
    // Text named JetBrains Mono, but each coloured span is a nested Text with
    // only a colour, and the React Native patch gives every Text that names no
    // face Instrument Sans (instrumentSansTextStyle). A nested span does not
    // inherit around that: it names the UI face itself. So each span must name
    // the code face, and this runs the real hook over each one to prove it.
    const r = render()
    const texts = r.root.findAllByType('Text' as never)
    const code = texts.find((node) => node.findAllByType('Text' as never).length > 1)!
    const spans = code.findAllByType('Text' as never).filter((node) => node !== code)
    expect(spans.map((node) => node.children.join(''))).toEqual([
      'import ',
      '{ createElement } from ',
      "'react'"
    ])
    for (const span of spans) {
      const drawn = instrumentSansTextStyle(span.props.style)
      expect(flatStyle({ props: { style: drawn } } as never).fontFamily).toBe(fontFamily.mono)
    }
  })

  it('paints a selected line across the whole row', () => {
    const r = render({ highlighted: true, highlightStyle: { backgroundColor: '#123' } })
    const row = r.root.findAllByType('View' as never)[0]!
    expect(flatStyle(row)).toMatchObject({ backgroundColor: '#123' })
  })
})
