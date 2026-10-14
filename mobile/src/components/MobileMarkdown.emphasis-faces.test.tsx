import { describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => {
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
    Linking: { openURL: () => Promise.resolve() },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light',
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    StyleSheet: { create: (s: unknown) => s, flatten, hairlineWidth: 1 }
  }
})
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

import { MobileMarkdown } from './MobileMarkdown'
import { instrumentSansTextStyle } from '../theme/instrument-sans-text'
import { ThemeProvider } from '../theme/theme-context'

// 2026-10-14: Markdown italics drew upright on the phone (no italic face was
// loaded), and the fix gives a Text that asks for italic its italic file. A
// nested span is a Text of its own, and the app's Text hook gives each one a
// face of its own: an italic inside a bold span (`***x***`, `**a *b* c**`) or a
// bold inside an italic (`*a **b** c*`) would draw the face of ITS style alone,
// losing the other's weight or slant. So each span names both. The face a span
// draws is the innermost family the hook gives it.
function drawn(renderer: ReactTestRenderer, text: string): string {
  const span = renderer.root.findAllByType('Text' as never).find((node) => node.children.some((child) => child === text))
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  for (let node: ReactTestInstance | null = span!; node; node = node.parent) {
    if (node.type === ('Text' as never)) {
      const style = instrumentSansTextStyle(node.props.style)
      const flat = Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as { fontFamily?: string }
      if (flat.fontFamily) {
        return flat.fontFamily
      }
    }
  }
  return ''
}

function render(content: string): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <MobileMarkdown content={content} />
      </ThemeProvider>
    )
  })
  return renderer
}

describe('the face each span of emphasis draws', () => {
  it('draws an italic in the italic face, and a bold in the semibold one', () => {
    const renderer = render('plain *slanted* and **strong**')
    expect(drawn(renderer, 'slanted')).toBe('InstrumentSans_400Regular_Italic')
    expect(drawn(renderer, 'strong')).toBe('InstrumentSans_600SemiBold')
    act(() => renderer.unmount())
  })

  it('draws ***x*** and an italic inside a bold span in the semibold italic face', () => {
    const renderer = render('This is ***really important*** and **bold with *em* inside**')
    expect(drawn(renderer, 'really important')).toBe('InstrumentSans_600SemiBold_Italic')
    expect(drawn(renderer, 'em')).toBe('InstrumentSans_600SemiBold_Italic')
    expect(drawn(renderer, 'bold with ')).toBe('InstrumentSans_600SemiBold')
    expect(drawn(renderer, ' inside')).toBe('InstrumentSans_600SemiBold')
    act(() => renderer.unmount())
  })

  it('draws a bold inside an italic span in the semibold italic face, the italic around it as italic', () => {
    const renderer = render('*a **b** c* and _x __y__ z_')
    expect(drawn(renderer, 'b')).toBe('InstrumentSans_600SemiBold_Italic')
    expect(drawn(renderer, 'a ')).toBe('InstrumentSans_400Regular_Italic')
    expect(drawn(renderer, ' c')).toBe('InstrumentSans_400Regular_Italic')
    expect(drawn(renderer, 'y')).toBe('InstrumentSans_600SemiBold_Italic')
    act(() => renderer.unmount())
  })

  it('draws one word of each emphasis, and none, without a face of another', () => {
    const renderer = render('*i*')
    expect(drawn(renderer, 'i')).toBe('InstrumentSans_400Regular_Italic')
    act(() => renderer.unmount())
    const bare = render('**b**')
    expect(drawn(bare, 'b')).toBe('InstrumentSans_600SemiBold')
    act(() => bare.unmount())
  })
})
