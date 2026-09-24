import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))

import { AuthFailedBanner } from './AuthFailedBanner'
import { ThemeProvider } from '../theme/theme-context'

type Presses = { retry: number; repair: number; remove: number }

function render(props: {
  canRetry: boolean
  onRetry: () => void
  onRepair: () => void
  onRemove: () => void
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(ThemeProvider, { initialPreference: 'dark' }, createElement(AuthFailedBanner, props))
    )
  })
  return renderer
}

function pressables(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll((node: ReactTestInstance) => String(node.type) === 'Pressable')
}

function labelsOf(tree: ReactTestRenderer): (string | undefined)[] {
  return pressables(tree).map((node) => node.props.accessibilityLabel as string | undefined)
}

/** The app owns the connection, the keychain and the host list, so all three do something here. */
describe('the auth-failed banner in the app', () => {
  it('offers Retry, Re-pair and Remove', () => {
    const tree = render({
      canRetry: true,
      onRetry: () => {},
      onRepair: () => {},
      onRemove: () => {}
    })
    expect(labelsOf(tree)).toEqual(['Retry', 'Re-pair', 'Remove'])
    act(() => tree.unmount())
  })

  it('routes each press to the action the screen gave it', () => {
    const presses: Presses = { retry: 0, repair: 0, remove: 0 }
    const tree = render({
      canRetry: true,
      onRetry: () => (presses.retry += 1),
      onRepair: () => (presses.repair += 1),
      onRemove: () => (presses.remove += 1)
    })
    act(() => {
      for (const node of pressables(tree)) {
        node.props.onPress()
      }
    })
    expect(presses).toEqual({ retry: 1, repair: 1, remove: 1 })
    act(() => tree.unmount())
  })

  it('drops Retry alone when there is no host to retry against', () => {
    const tree = render({
      canRetry: false,
      onRetry: () => {},
      onRepair: () => {},
      onRemove: () => {}
    })
    expect(labelsOf(tree)).toEqual(['Re-pair', 'Remove'])
    act(() => tree.unmount())
  })
})
