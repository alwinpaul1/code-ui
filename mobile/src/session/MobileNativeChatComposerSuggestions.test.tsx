import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import {
  MobileNativeChatComposerSuggestions,
  suggestionArgumentHint,
  type ComposerSuggestion
} from './MobileNativeChatComposerSuggestions'

vi.mock('react-native', () => ({
  FlatList: ({
    data,
    renderItem
  }: {
    data: ComposerSuggestion[]
    renderItem: (info: { item: ComposerSuggestion; index: number }) => ReactElement
  }) =>
    createElement(
      'FlatList',
      null,
      data.map((item, index) =>
        createElement('Row', { key: `${item.kind}-${index}` }, renderItem({ item, index }))
      )
    ),
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))

function readTexts(renderer: ReactTestRenderer): { texts: string[]; colors: string[] } {
  const texts: string[] = []
  const colors: string[] = []
  for (const node of renderer.root.findAllByType('Text')) {
    if (typeof node.props.children === 'string') {
      texts.push(node.props.children)
    }
    const style = node.props.style
    for (const entry of Array.isArray(style) ? style : [style]) {
      if (entry && typeof entry === 'object' && typeof entry.color === 'string') {
        colors.push(entry.color)
      }
    }
  }
  return { texts, colors }
}

const GOAL: ComposerSuggestion = {
  kind: 'command',
  command: { name: 'goal', description: 'Set or view the goal', argumentHint: '<objective>' }
}
const CLEAR: ComposerSuggestion = {
  kind: 'command',
  command: { name: 'clear', description: 'Start a new session with empty context' }
}

describe('a `/` row with the argument hint the provider reported (Orca #19928)', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  // 2026-09-20: the rows show the token and nothing else, the Claude app's
  // menu, which the user asked for over the hint and description rows. The
  // hint is still computed (`suggestionArgumentHint`) for anything that wants
  // it; the row does not draw it. Both themes: the accent tone is the theme's.
  it('shows the token alone, in the accent tone of whichever theme is on', () => {
    for (const [scheme, palette] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      act(() => {
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: scheme },
            createElement(MobileNativeChatComposerSuggestions, {
              suggestions: [GOAL, CLEAR],
              onPick: () => {}
            })
          )
        )
      })
      const { texts, colors } = readTexts(renderer!)
      expect(texts).toEqual(['/goal', '/clear'])
      expect(colors).toContain(palette.accentText)
      expect(colors).not.toContain(palette.textMuted)
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('caps a hint at 80 characters and collapses its whitespace, so a provider cannot swamp the row', () => {
    const long = `<${'x'.repeat(200)}>`
    expect(suggestionArgumentHint({ kind: 'command', command: { name: 'a', argumentHint: long } }))
      .toHaveLength(80)
    expect(
      suggestionArgumentHint({
        kind: 'command',
        command: { name: 'a', argumentHint: '  <issue\n  url>  ' }
      })
    ).toBe('<issue url>')
    expect(
      suggestionArgumentHint({ kind: 'command', command: { name: 'a', argumentHint: '   ' } })
    ).toBeNull()
    expect(suggestionArgumentHint(CLEAR)).toBeNull()
  })
})
