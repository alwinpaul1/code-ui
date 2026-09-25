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
// The substitution the page bundler makes for itself, made here by name: this suite runs under the
// native resolution, so the sibling has to be named to be the one the banner renders.
vi.mock('./AuthFailedBannerActions', async () => await import('./AuthFailedBannerActions.web'))

import { AuthFailedBanner } from './AuthFailedBanner'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme, type ThemeScheme } from '../theme/tokens'

const NOTE = 'Reconnect or remove this host from the Orca app.'

type Presses = { retry: number; repair: number; remove: number }

function render(
  scheme: ThemeScheme,
  presses: Presses = { retry: 0, repair: 0, remove: 0 }
): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: scheme },
        createElement(AuthFailedBanner, {
          canRetry: true,
          onRetry: () => (presses.retry += 1),
          onRepair: () => (presses.repair += 1),
          onRemove: () => (presses.remove += 1)
        })
      )
    )
  })
  return renderer
}

function pressables(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll((node: ReactTestInstance) => String(node.type) === 'Pressable')
}

function texts(node: ReactTestInstance): ReactTestInstance[] {
  return node.findAll((child: ReactTestInstance) => String(child.type) === 'Text')
}

function labels(node: ReactTestInstance): string[] {
  return texts(node).map((child) => String(child.props.children))
}

/** The last colour a Txt's style array settles on, which is the one the text is drawn in. */
function colorOf(node: ReactTestInstance): string | undefined {
  let color: string | undefined
  for (const style of [node.props.style].flat(3)) {
    if (style && typeof style === 'object' && typeof style.color === 'string') {
      color = style.color
    }
  }
  return color
}

/**
 * Re-pair works from the page: its push of `/pair-scan` is handed to the shell, which opens the
 * native scan screen. Retry and Remove do not (`forceReconnect` is null, removal refuses), so the
 * banner names the app for those two rather than painting controls that do nothing.
 */
describe.each<ThemeScheme>(['light', 'dark'])('the auth-failed banner on the page (%s)', (scheme) => {
  it('offers Re-pair alone, and its press reaches the screen', () => {
    const presses: Presses = { retry: 0, repair: 0, remove: 0 }
    const tree = render(scheme, presses)
    const controls = pressables(tree)
    expect(controls.map((node) => labels(node)[0])).toEqual(['Re-pair'])
    act(() => {
      for (const node of controls) {
        node.props.onPress()
      }
    })
    expect(presses).toEqual({ retry: 0, repair: 1, remove: 0 })
    act(() => tree.unmount())
  })

  it('names the app for reconnect and removal, not for re-pair', () => {
    const tree = render(scheme)
    expect(labels(tree.root)).toContain(NOTE)
    act(() => tree.unmount())
  })

  it("draws the app's name in this theme's secondary text, not a fixed colour", () => {
    const tree = render(scheme)
    const note = texts(tree.root).find((node) => node.props.children === NOTE)
    expect(note && colorOf(note)).toBe(colorsForScheme(scheme).textSecondary)
    act(() => tree.unmount())
  })

  it('keeps the sentence that says what happened', () => {
    const tree = render(scheme)
    expect(labels(tree.root)).toContain(
      'Authentication failed. Try reconnecting first; if it keeps failing, re-pair from the desktop.'
    )
    act(() => tree.unmount())
  })
})
