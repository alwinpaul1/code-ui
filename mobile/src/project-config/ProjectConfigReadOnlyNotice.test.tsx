import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))

import { ProjectConfigReadOnlyNotice, PROJECT_CONFIG_READ_ONLY_NOTICE } from './ProjectConfigReadOnlyNotice'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

function render(preference: 'light' | 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(ThemeProvider, { initialPreference: preference }, createElement(ProjectConfigReadOnlyNotice))
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

// Both are required states: a literal colour here would pass every automated
// check and still ship the wrong theme, so each scheme is asserted against
// its own tokens, not against the other's.
describe('the read-only line, in light and in dark', () => {
  for (const [scheme, colors] of SCHEMES) {
    it(`paints its text and rule from the ${scheme} theme`, () => {
      const renderer = render(scheme)
      const text = renderer.root.findByType('Text' as never)
      expect(text.props.children).toBe(PROJECT_CONFIG_READ_ONLY_NOTICE)
      expect(flatten(text.props.style).color).toBe(colors.textSecondary)
      const footer = renderer.root.findByType('View' as never)
      expect(flatten(footer.props.style).borderTopColor).toBe(colors.border)
      act(() => renderer.unmount())
    })
  }

  it('says which side refused, in one plain sentence', () => {
    expect(PROJECT_CONFIG_READ_ONLY_NOTICE).toBe('Read-only from the phone on this Orca version.')
  })
})
