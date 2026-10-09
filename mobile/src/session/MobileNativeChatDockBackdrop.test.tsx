import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// Device, 2026-10-09 (ours-transcript.png against the Claude app's): while the
// agent works and the reader is up in history, the row above the composer
// ("Working · 3 running tasks · Tools · Stop") is painted straight over the
// transcript, and the two sets of words collide. The dock had no ground on
// purpose (a hard edge read as a line, 2026-09-13/19/20), so the ground is a
// short fade from nothing to the page colour above the row, then the page
// colour itself. Both come from the theme: a literal passes in one scheme and
// ships the wrong tone in the other.
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View',
  useColorScheme: () => 'light'
}))

import { MobileNativeChatDockBackdrop, DOCK_BACKDROP_FADE } from './MobileNativeChatDockBackdrop'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat))
  }
  return (style ?? {}) as Record<string, unknown>
}

function render(scheme: 'light' | 'dark'): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatDockBackdrop />
      </ThemeProvider>
    )
  })
  return renderer!.root.findByProps({ testID: 'native-chat-dock-backdrop' })
}

describe('the ground behind the status row and the composer', () => {
  it.each(['light', 'dark'] as const)('is solid page colour under the row, from the theme, in %s', (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    const root = render(scheme)
    const solid = root.findByProps({ testID: 'native-chat-dock-backdrop-solid' })
    expect(flat(solid.props.style).backgroundColor).toBe(colors.bg)
    // Under the whole dock, row and gap included.
    expect(flat(solid.props.style)).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 })
  })

  it.each(['light', 'dark'] as const)('fades in from nothing to the page colour above the row in %s', (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    const root = render(scheme)
    const stops = root.findAll((node) => (node.type as unknown) === 'Stop')
    expect(stops).toHaveLength(2)
    expect(stops.map((stop) => stop.props.stopColor)).toEqual([colors.bg, colors.bg])
    expect(stops.map((stop) => Number(stop.props.stopOpacity))).toEqual([0, 1])
    const fade = root.findByProps({ testID: 'native-chat-dock-backdrop-fade' })
    expect(flat(fade.props.style)).toMatchObject({ position: 'absolute', top: -DOCK_BACKDROP_FADE, height: DOCK_BACKDROP_FADE })
  })

  it('lets touches through to the list beneath', () => {
    const root = render('dark')
    expect(root.props.pointerEvents).toBe('none')
  })
})
