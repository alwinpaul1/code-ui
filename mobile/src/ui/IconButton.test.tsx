import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))

import { Settings } from 'lucide-react-native'
import { IconButton } from './IconButton'

vi.mock('lucide-react-native', () => ({ Settings: 'Settings' }))

function render(disabled: boolean): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(IconButton, { icon: Settings, accessibilityLabel: 'Settings', disabled }))
  })
  return renderer!
}

function painted(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(painted)) : ((style ?? {}) as Record<string, unknown>)
}

/** The strength the icon is drawn at: every opacity from the pressable down to
 *  the glyph, each style flattened later-wins as React Native paints it. */
function iconStrength(renderer: ReactTestRenderer): number {
  const icon = renderer.root.findAll((node) => (node.type as unknown) === 'Settings')[0]!
  let strength = 1
  for (let node: ReactTestInstance | null = icon.parent; node; node = node.parent) {
    // Only host views paint; a component's own style prop is not what lands.
    const opacity = typeof node.type === 'string' ? painted(node.props.style).opacity : undefined
    if (typeof opacity === 'number') {
      strength *= opacity
    }
  }
  return strength
}

// IconButton dims on press (pressedOpacity 0.85), so PressScale's press style
// keeps an `opacity` key, 1 at rest, after the button's own style. The
// button's `opacity: disabled ? 0.5 : 1` never painted: an offline header's
// buttons looked as live as ever (found in review, 2026-09-28).
describe('a disabled IconButton', () => {
  it('draws its icon at half strength', () => {
    expect(iconStrength(render(true))).toBe(0.5)
  })

  it('and an enabled one at full strength', () => {
    expect(iconStrength(render(false))).toBe(1)
  })
})
