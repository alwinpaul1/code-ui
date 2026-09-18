import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({ Plus: 'Plus', Trash2: 'Trash2' }))

import { PermissionRuleSection } from './PermissionRuleSection'
import { ThemeProvider } from '../../theme/theme-context'
import { darkColors, lightColors } from '../../theme/tokens'

function render(preference: 'light' | 'dark'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: preference },
        createElement(PermissionRuleSection, {
          category: 'allow',
          rules: ['Read'],
          onAdd: vi.fn(),
          onRemove: vi.fn()
        })
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

describe('PermissionRuleSection, in light and in dark', () => {
  for (const [scheme, colors] of SCHEMES) {
    it(`paints its card and border from the ${scheme} theme, not a fixed palette`, () => {
      const renderer = render(scheme)
      const card = renderer.root.findAllByType('View' as never)[0]!
      const style = flatten(card.props.style)
      expect(style.backgroundColor).toBe(colors.bgPanel)
      expect(style.borderColor).toBe(colors.border)
      act(() => renderer.unmount())
    })
  }
})
