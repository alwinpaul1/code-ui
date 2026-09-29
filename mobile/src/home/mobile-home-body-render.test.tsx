import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
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
vi.mock('lucide-react-native', () => ({ QrCode: 'QrCode', RefreshCw: 'RefreshCw' }))
vi.mock('../components/AppLogo', () => ({ AppLogo: 'AppLogo' }))
vi.mock('../ui/Button', () => ({ Button: 'Button' }))
vi.mock('../ui/SectionLabel', () => ({ SectionLabel: 'SectionLabel' }))
vi.mock('../ui/Surface', () => ({ Surface: 'Surface' }))

import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import { homeBodyKind } from './home-body-kind'
import { MobileHomeBody } from './MobileHomeBody'

const PAIR_HEADING = 'Connect your desktop'
const FAILED_HEADING = "Couldn't read your paired desktops"
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

  async function render(
    scheme: 'light' | 'dark',
    loaded: boolean,
    hostCount: number,
    failed = false,
    onRetryRead: () => Promise<void> = async () => {}
  ) {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileHomeBody
            kind={homeBodyKind(loaded, hostCount, failed)}
            pair={pair}
            onRetryRead={onRetryRead}
            hostList={createElement('HostList')}
          />
        </ThemeProvider>
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

  it.each(['light', 'dark'] as const)(
    'tells a paired phone its desktops could not be read, not to pair, when the read failed (%s)',
    async (scheme) => {
      const shown = await render(scheme, true, 0, true)
      expect(shown.text).toContain(FAILED_HEADING)
      expect(shown.text).not.toContain(PAIR_HEADING)
      expect(shown.hasList).toBe(false)
    }
  )

  it.each(['light', 'dark'] as const)(
    'keeps the host list, not the failed body, when a re-read fails with desktops on screen (%s)',
    async (scheme) => {
      const shown = await render(scheme, true, 2, true)
      expect(shown.hasList).toBe(true)
      expect(shown.text).not.toContain(FAILED_HEADING)
      expect(shown.text).not.toContain(PAIR_HEADING)
    }
  )

  it.each(['light', 'dark'] as const)(
    "draws the failed body in this theme's own text colours, not fixed ones (%s)",
    async (scheme) => {
      await render(scheme, true, 0, true)
      const palette = colorsForScheme(scheme)
      const texts = renderer!.root.findAll((node) => String(node.type) === 'Text')
      const heading = texts.find((node) => node.props.children === FAILED_HEADING)
      expect(heading && colorOf(heading)).toBe(palette.text)
      expect(texts.length).toBeGreaterThan(1)
      for (const node of texts) {
        expect(Object.values(palette)).toContain(colorOf(node))
      }
    }
  )

  it('retries the read from the failed body, and holds the button busy until it settles', async () => {
    let settle: () => void = () => {}
    const onRetryRead = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)))
    await render('light', true, 0, true, onRetryRead)
    expect(retryButton().props.loading).toBe(false)
    await act(async () => retryButton().props.onPress())
    expect(onRetryRead).toHaveBeenCalledTimes(1)
    expect(retryButton().props.loading).toBe(true)
    await act(async () => settle())
    expect(retryButton().props.loading).toBe(false)
  })

  it('frees the Retry button again when the retry itself rejects', async () => {
    let fail: (error: Error) => void = () => {}
    const onRetryRead = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)))
    await render('dark', true, 0, true, onRetryRead)
    await act(async () => retryButton().props.onPress())
    expect(retryButton().props.loading).toBe(true)
    await act(async () => fail(new Error('keychain locked')))
    expect(retryButton().props.loading).toBe(false)
  })

  function retryButton(): ReactTestInstance {
    const found = renderer!.root.findAll(
      (node) => String(node.type) === 'Button' && node.props.label === 'Retry'
    )
    expect(found).toHaveLength(1)
    return found[0]!
  }
})

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
