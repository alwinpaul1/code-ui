import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s }
}))

import { PRESS_DIM_STYLE, PressFeedback, type PressFeedbackProps } from './PressFeedback'

type StyleFn = (state: { pressed: boolean }) => unknown[]

function render(props: PressFeedbackProps): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(PressFeedback, props))
  })
  return renderer!
}

/** The style Pressable would resolve for a given press state. */
function styleAt(renderer: ReactTestRenderer, pressed: boolean): Record<string, unknown> {
  const pressable = renderer.root.findByType('Pressable' as never)
  const style = pressable.props.style as StyleFn
  // RN hands the style function the interaction state; a static object here
  // would be the whole bug, so the test insists on the function.
  expect(typeof style).toBe('function')
  return Object.assign({}, ...style({ pressed }).flat().filter(Boolean))
}

describe('PressFeedback', () => {
  it('shows nothing extra while the finger is up', () => {
    const renderer = render({ style: { padding: 4 } })
    expect(styleAt(renderer, false)).toEqual({ padding: 4 })
  })

  it('dims on the way down when the caller names no pressed style', () => {
    const renderer = render({ style: { padding: 4 } })
    expect(styleAt(renderer, true)).toEqual({ padding: 4, ...PRESS_DIM_STYLE })
    expect(PRESS_DIM_STYLE.opacity).toBeLessThan(1)
  })

  it('applies the caller’s pressed style over the resting one', () => {
    const renderer = render({
      style: { backgroundColor: 'transparent', padding: 4 },
      pressedStyle: { backgroundColor: '#2B2925' }
    })
    expect(styleAt(renderer, true)).toEqual({ backgroundColor: '#2B2925', padding: 4 })
    expect(styleAt(renderer, false)).toEqual({ backgroundColor: 'transparent', padding: 4 })
  })

  it('forwards the rest of the Pressable contract untouched', () => {
    const onPress = vi.fn()
    const renderer = render({ onPress, disabled: true, hitSlop: 8, accessibilityLabel: 'Open' })
    const pressable = renderer.root.findByType('Pressable' as never)
    expect(pressable.props.onPress).toBe(onPress)
    expect(pressable.props.disabled).toBe(true)
    expect(pressable.props.hitSlop).toBe(8)
    expect(pressable.props.accessibilityLabel).toBe('Open')
  })
})
