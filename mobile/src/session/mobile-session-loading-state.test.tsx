import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement(name, props, children)
  return {
    Platform: { OS: 'android', select: (options: { android?: unknown; default?: unknown }) => options.android ?? options.default },
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(true), addEventListener: () => ({ remove: () => undefined }) },
    ActivityIndicator: 'ActivityIndicator',
    Pressable: host('Pressable'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 })
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { LoadingConnectionTroubleState } from './loading-connection-trouble'
import { mobileSessionLoadingScreen } from './mobile-session-loading-screen'
import { MobileSessionLoadingState } from './MobileSessionLoadingState'
import { useSessionRouteAgentHint } from './use-session-route-agent-hint'
import type { SessionRouteAgentHint } from './session-route-agent-hint'

// 2026-10-16, from the user: opening a workspace the phone had never cached drew the session
// screen's bare "Loading tabs" spinner even for a Claude session (and, before the first connection,
// an empty frame). The tapped row's hint makes it Clawd and "Loading session…"; a host that never
// answers makes it say so, with a Retry, instead of loading forever.

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

const UNREACHABLE: LoadingConnectionTroubleState = {
  trouble: {
    label: "Can't reach desktop",
    detail: 'Your desktop isn’t reachable right now. Check it’s awake and Orca is running; this screen reconnects on its own.',
    retryable: true
  },
  onRetry: null
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(node.props.style).flat(Infinity).filter(Boolean))
}

async function draw(
  scheme: 'light' | 'dark',
  screen: 'claude' | 'plain',
  trouble: LoadingConnectionTroubleState | null
): Promise<void> {
  const element = (
    <ThemeProvider initialPreference={scheme}>
      <MobileSessionLoadingState screen={screen} trouble={trouble} />
    </ThemeProvider>
  )
  await act(async () => {
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

const clawd = () => renderer!.root.findAll((node) => node.props.testID === 'claude-transcript-loading-clawd' && typeof node.type === 'string')
const spinners = () => renderer!.root.findAll((node) => node.type === ('ActivityIndicator' as never))
const texts = () => renderer!.root.findAll((node) => node.type === ('Text' as never)).map((node) => node.props.children)
const surface = () => flatStyle(renderer!.root.find((node) => node.props.testID === 'session-loading' && typeof node.type === 'string'))

describe("the session screen's loading before its first tabs", () => {
  it.each(SCHEMES)('draws Clawd and "Loading session…" for a row that said Claude, in %s', async (scheme, colors) => {
    await draw(scheme, 'claude', null)
    expect(clawd()).toHaveLength(1)
    expect(texts()).toContain('Loading session…')
    expect(spinners()).toHaveLength(0)
    expect(surface().backgroundColor).toBe(colors.chatBg)
  })

  it.each(SCHEMES)('keeps the plain spinner, not Clawd, with no hint (a terminal or Codex workspace), in %s', async (scheme, colors) => {
    await draw(scheme, 'plain', null)
    expect(clawd()).toHaveLength(0)
    expect(spinners()).toHaveLength(1)
    expect(spinners()[0]!.props.color).toBe(colors.textSecondary)
    expect(surface().backgroundColor).toBe(colors.chatBg)
  })

  it.each(SCHEMES)('says the desktop cannot be reached under Clawd, then loads again by itself when it answers, in %s', async (scheme) => {
    await draw(scheme, 'claude', UNREACHABLE)
    expect(clawd()).toHaveLength(1)
    expect(texts()).toContain("Can't reach desktop")
    expect(texts()).toContain(UNREACHABLE.trouble.detail)
    expect(texts()).not.toContain('Loading session…')
    await draw(scheme, 'claude', null)
    expect(texts()).toContain('Loading session…')
    expect(texts()).not.toContain("Can't reach desktop")
  })

  it.each(SCHEMES)('says it in place of the spinner too, with a Retry that re-dials, in %s', async (scheme) => {
    const onRetry = vi.fn()
    await draw(scheme, 'plain', { ...UNREACHABLE, onRetry })
    expect(spinners()).toHaveLength(0)
    expect(texts()).toContain("Can't reach desktop")
    const retry = renderer!.root.findAll(
      (node) => node.props.accessibilityLabel === 'Reconnect to desktop' && typeof node.props.onPress === 'function'
    )
    act(() => retry[0]!.props.onPress())
    expect(onRetry).toHaveBeenCalledTimes(1)
    await draw(scheme, 'plain', null)
    expect(spinners()).toHaveLength(1)
  })
})

describe('which loading screen the session draws', () => {
  it('is Clawd on the hint and the spinner without, only until the tabs arrive', () => {
    expect(mobileSessionLoadingScreen({ terminalsLoaded: false, visibleTabCount: 0, routeAgentHint: 'claude' })).toBe('claude')
    expect(mobileSessionLoadingScreen({ terminalsLoaded: false, visibleTabCount: 0, routeAgentHint: null })).toBe('plain')
    // The real tabs decide from here: a cached strip, a loaded one, or one loaded empty.
    expect(mobileSessionLoadingScreen({ terminalsLoaded: false, visibleTabCount: 1, routeAgentHint: 'claude' })).toBeNull()
    expect(mobileSessionLoadingScreen({ terminalsLoaded: true, visibleTabCount: 1, routeAgentHint: 'claude' })).toBeNull()
    expect(mobileSessionLoadingScreen({ terminalsLoaded: true, visibleTabCount: 0, routeAgentHint: 'claude' })).toBeNull()
  })
})

describe("the tapped row's hint", () => {
  function Probe(props: { worktreeId: string; param: string | undefined; terminalsLoaded: boolean; clearParam: () => void; seen: SessionRouteAgentHint[] }) {
    props.seen.push(useSessionRouteAgentHint(props))
    return null
  }

  it('does not outlive the real tabs: spent once they load, cleared from the route, not back when they reload', async () => {
    const seen: SessionRouteAgentHint[] = []
    const clearParam = vi.fn()
    const at = (terminalsLoaded: boolean, param: string | undefined = 'claude', worktreeId = 'wt-1') => (
      <Probe worktreeId={worktreeId} param={param} terminalsLoaded={terminalsLoaded} clearParam={clearParam} seen={seen} />
    )
    await act(async () => {
      renderer = create(at(false))
    })
    expect(seen.at(-1)).toBe('claude')
    expect(clearParam).not.toHaveBeenCalled()
    await act(async () => {
      renderer!.update(at(true))
    })
    expect(seen.at(-1)).toBeNull()
    expect(clearParam).toHaveBeenCalled()
    // A reconnect that empties the strip again, with the param not yet gone from the route.
    await act(async () => {
      renderer!.update(at(false))
    })
    expect(seen.at(-1)).toBeNull()
    // The same screen reused for another workspace starts over with that one's hint.
    await act(async () => {
      renderer!.update(at(false, 'claude', 'wt-2'))
    })
    expect(seen.at(-1)).toBe('claude')
  })
})
