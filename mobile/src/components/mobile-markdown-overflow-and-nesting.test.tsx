import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  Linking: { openURL: () => Promise.resolve() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

import { MobileMarkdown } from './MobileMarkdown'
import { ThemeProvider } from '../theme/theme-context'

function render(content: string): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: 'dark' },
        createElement(MobileMarkdown, { content })
      )
    )
  })
  return renderer
}

function scrollers(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (node) => node.type === 'ScrollView' && node.props?.horizontal === true
  )
}

// Reported 2026-09-15 against this repository's own CLAUDE.md, read in the .md
// tab's preview: the gate command ran off the right edge and ended at "npx", so
// it read as truncated. It HAD been scrollable the whole time — a swipe brought
// "oxlint" into view — but the indicator was switched off, so nothing said so.
describe('a line too wide for the phone', () => {
  it('tells the reader the code block scrolls', () => {
    const renderer = render(
      ['```', 'cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint', '```'].join('\n')
    )
    const [scroller] = scrollers(renderer)
    expect(scroller).toBeTruthy()
    expect(scroller!.props.showsHorizontalScrollIndicator).not.toBe(false)
    // Android fades the bar out; a fence is read at rest, not while dragging.
    expect(scroller!.props.persistentScrollbar).toBe(true)
    act(() => renderer.unmount())
  })

  it('tells the reader a wide table scrolls too', () => {
    const renderer = render(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'))
    const [scroller] = scrollers(renderer)
    expect(scroller).toBeTruthy()
    expect(scroller!.props.persistentScrollbar).toBe(true)
    act(() => renderer.unmount())
  })

  it('keeps the whole command, uncut, for the scroller to reveal', () => {
    const command = 'cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint'
    const renderer = render(['```', command, '```'].join('\n'))
    expect(JSON.stringify(renderer.toJSON())).toContain('npx oxlint')
    act(() => renderer.unmount())
  })
})

// Also visible in that screenshot: "Releases falling behind `main` is a bug"
// drew its backticks literally. The bold branch rendered its contents as PLAIN
// TEXT, so a code span, a link or emphasis nested inside bold came out as
// source. Bold is the commonest place to put a code span in this repo's docs.
describe('an inline span nested inside another', () => {
  it('renders a code span inside bold as code, not as backticks', () => {
    const renderer = render('**Releases falling behind `main` is a bug.**')
    const json = JSON.stringify(renderer.toJSON())
    expect(json).not.toContain('`main`')
    expect(json).toContain('main')
    act(() => renderer.unmount())
  })

  it('renders a code span inside italics too', () => {
    const renderer = render('*see `mobile/app.json` for it*')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('`mobile/app.json`')
    act(() => renderer.unmount())
  })

  it('leaves bold with no nesting exactly as it was', () => {
    const renderer = render('**just bold words**')
    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('just bold words')
    act(() => renderer.unmount())
  })

  it('keeps a backtick that is genuinely alone', () => {
    const renderer = render('**a lone ` backtick**')
    expect(JSON.stringify(renderer.toJSON())).toContain('backtick')
    act(() => renderer.unmount())
  })
})
