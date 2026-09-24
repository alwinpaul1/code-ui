import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
// The substitution the page bundler makes for itself, made here by name: this suite runs under the
// native resolution, so the sibling has to be named to be the one the banner renders.
vi.mock('./AuthFailedBannerActions', async () => await import('./AuthFailedBannerActions.web'))

import { AuthFailedBanner } from './AuthFailedBanner'
import { ThemeProvider } from '../theme/theme-context'

function render(): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: 'dark' },
        createElement(AuthFailedBanner, {
          canRetry: true,
          onRetry: () => {},
          onRepair: () => {},
          onRemove: () => {}
        })
      )
    )
  })
  return renderer
}

function labels(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((node: ReactTestInstance) => String(node.type) === 'Text')
    .map((node) => String(node.props.children))
}

/**
 * The page can honour none of the three: `forceReconnect` is inert there, `/pair-scan` is outside
 * its route root, and removal refuses. So the banner reports the state and names where the
 * controls are, rather than painting three that do nothing.
 */
describe('the auth-failed banner on the page', () => {
  it('renders no control at all, not a disabled one', () => {
    const tree = render()
    expect(tree.root.findAll((node: ReactTestInstance) => String(node.type) === 'Pressable')).toEqual(
      []
    )
    act(() => tree.unmount())
  })

  it('names the app instead', () => {
    const tree = render()
    expect(labels(tree)).toContain('Reconnect or re-pair from the Orca app.')
    act(() => tree.unmount())
  })

  it('keeps the sentence that says what happened', () => {
    const tree = render()
    expect(labels(tree)).toContain(
      'Authentication failed. Try reconnecting first; if it keeps failing, re-pair from the desktop.'
    )
    act(() => tree.unmount())
  })
})
