import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'View' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), canGoBack: () => false, replace: vi.fn() }) }))

import { ProjectConfigScreenChrome } from './ProjectConfigScreenChrome'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { PROJECT_SCOPE_ONLY_NOTICE } from './project-config-paths'

function render(preference: 'light' | 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: preference },
        createElement(
          ProjectConfigScreenChrome,
          { title: 'MCP Servers' },
          createElement('Text' as never, null, 'body')
        )
      )
    )
  })
  return renderer
}

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean))
}

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

describe('ProjectConfigScreenChrome, in light and in dark', () => {
  for (const [scheme, colors] of SCHEMES) {
    it(`paints its body on the ${scheme} page background`, () => {
      const renderer = render(scheme)
      const body = renderer.root.findAllByType('View' as never).at(-1)!
      expect(flatten(body.props.style).backgroundColor).toBe(colors.bg)
      act(() => renderer.unmount())
    })
  }

  it('states the project-scope-only notice once, in plain words', () => {
    const renderer = render('light')
    const texts = renderer.root.findAllByType('Text' as never).map((node) => node.props.children)
    const matches = texts.filter((text) => text === PROJECT_SCOPE_ONLY_NOTICE)
    expect(matches).toHaveLength(1)
    act(() => renderer.unmount())
  })
})
