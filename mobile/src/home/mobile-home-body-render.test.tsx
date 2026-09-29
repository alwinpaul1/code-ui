import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Reported 2026-09-29: a paired phone drew "Connect your desktop" on launch until the host list
 * arrived. This RENDERS the home body (with the real pairing screen inside it) for each state the
 * screen can be in, in both themes, so drawing the pairing screen while the catalog is pending
 * turns it red, not just a branch table.
 */
vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ QrCode: 'QrCode' }))
vi.mock('../components/AppLogo', () => ({ AppLogo: 'AppLogo' }))
vi.mock('../ui/Button', () => ({ Button: 'Button' }))
vi.mock('../ui/SectionLabel', () => ({ SectionLabel: 'SectionLabel' }))
vi.mock('../ui/Surface', () => ({ Surface: 'Surface' }))

import { ThemeProvider } from '../theme/theme-context'
import { homeBodyKind } from './home-body-kind'
import { MobileHomeBody } from './MobileHomeBody'

const PAIR_HEADING = 'Connect your desktop'
const pair = {
  bottomInset: 0,
  contentMaxWidth: 600,
  isWideLayout: false,
  onPairDesktop: () => {}
}

describe('home body rendered for a phone that already has a desktop', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(scheme: 'light' | 'dark', loaded: boolean, hostCount: number) {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileHomeBody, {
            kind: homeBodyKind(loaded, hostCount),
            pair,
            hostList: createElement('HostList')
          })
        )
      )
    })
    const text = JSON.stringify(renderer!.toJSON())
    return { text, hasList: renderer!.root.findAllByType('HostList' as never).length > 0 }
  }

  it.each(['light', 'dark'] as const)(
    'does not draw "Connect your desktop" while the catalog is pending (%s)',
    async (scheme) => {
      const pending = await render(scheme, false, 0)
      expect(pending.text).not.toContain(PAIR_HEADING)
      expect(pending.hasList).toBe(false)
    }
  )

  it.each(['light', 'dark'] as const)(
    'draws the host list, not the pairing screen, for one or several desktops (%s)',
    async (scheme) => {
      for (const count of [1, 4]) {
        const shown = await render(scheme, true, count)
        expect(shown.text).not.toContain(PAIR_HEADING)
        expect(shown.hasList).toBe(true)
        act(() => renderer?.unmount())
      }
    }
  )

  it.each(['light', 'dark'] as const)(
    'draws "Connect your desktop" once the finished read found none (%s)',
    async (scheme) => {
      const shown = await render(scheme, true, 0)
      expect(shown.text).toContain(PAIR_HEADING)
      expect(shown.hasList).toBe(false)
    }
  )
})
