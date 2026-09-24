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
vi.mock('lucide-react-native', () => ({ X: 'X' }))

import { HostRouteNoticeBanner } from './HostRouteNoticeBanner'
import { ThemeProvider } from '../theme/theme-context'

/**
 * The banner appears in a screen that is already on screen, so a reader who has moved past the top
 * of the list never arrives at it. A live region is the only thing that carries it to them.
 *
 * The urgency follows the tone rather than being assertive for everything: the two callers are an
 * action that did not happen, which interrupts, and a bounced route, which is context for a list
 * already being read. Interrupting for the second one would train people to ignore the first.
 */
describe('the host route notice banner announces itself', () => {
  function banner(tone?: 'notice' | 'failure'): ReactTestRenderer {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'dark' },
          createElement(HostRouteNoticeBanner, {
            message: 'Nothing happened',
            tone,
            onDismiss: () => {}
          })
        )
      )
    })
    return renderer
  }

  function root(renderer: ReactTestRenderer) {
    // Matched by name rather than through `findAllByType`: React's `ElementType` does not admit an
    // arbitrary React Native host name, so the typed form needs a cast and this does not. The first
    // is the banner's own root, which is the element the props under test are on.
    return renderer.root.findAll((node) => String(node.type) === 'View')[0]
  }

  it('interrupts for a failure, which is an action that did not happen', () => {
    const renderer = banner('failure')
    const node = root(renderer)
    expect(node.props.accessibilityRole).toBe('alert')
    expect(node.props.accessibilityLiveRegion).toBe('assertive')
    act(() => renderer.unmount())
  })

  it('waits its turn for a notice, which is context rather than a refusal', () => {
    const renderer = banner('notice')
    const node = root(renderer)
    expect(node.props.accessibilityLiveRegion).toBe('polite')
    // No alert role: nothing here failed, and an alert is what the tone above is for.
    expect(node.props.accessibilityRole).toBeUndefined()
    act(() => renderer.unmount())
  })

  it('treats the default tone as the notice one, which is what the route caller passes', () => {
    const renderer = banner(undefined)
    const node = root(renderer)
    expect(node.props.accessibilityLiveRegion).toBe('polite')
    expect(node.props.accessibilityRole).toBeUndefined()
    act(() => renderer.unmount())
  })
})
