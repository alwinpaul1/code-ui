import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeScheme } from '../theme/tokens'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileNativeChatVisualState } from './use-mobile-native-chat-visual'

// The chrome around an inline chat visual (Orca #26071) in this app's light and dark themes, and
// the one state that must not offer a tap: a desktop whose Orca cannot serve visuals at all.

const visual = vi.hoisted(() => ({
  state: { kind: 'loading' } as MobileNativeChatVisualState,
  retry: vi.fn()
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement(name, props, children)
  return {
    ActivityIndicator: 'ActivityIndicator',
    Modal: host('Modal'),
    Pressable: host('Pressable'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
    useColorScheme: () => 'light'
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))
vi.mock('lucide-react-native', () => ({ Maximize2: 'Maximize2', X: 'X' }))
vi.mock('./MobileNativeChatVisualFrame', () => ({ MobileNativeChatVisualFrame: 'Frame' }))
vi.mock('./use-mobile-native-chat-visual', () => ({
  useMobileNativeChatVisual: () => ({ state: visual.state, retry: visual.retry })
}))

import { MobileNativeChatVisual } from './MobileNativeChatVisual'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the read hook is mocked; the client is only an identity here.
const source = { client: {} as RpcClient, sessionId: 'session-1' }

describe('MobileNativeChatVisual', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    visual.retry.mockClear()
  })

  function render(state: MobileNativeChatVisualState, scheme: ThemeScheme = 'light'): ReactTestInstance {
    visual.state = state
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatVisual directive={{ file: 'usage.html', title: 'Usage by day' }} source={source} />
        </ThemeProvider>
      )
    })
    return renderer!.root
  }

  const flat = (style: unknown): Record<string, unknown> =>
    Object.assign({}, ...[style].flat(3).filter(Boolean))

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws its frame and open button from the %s palette', (scheme, colors) => {
    const root = render({ kind: 'ready', html: '<p>', revision: 'a'.repeat(32) }, scheme)
    const frame = root.findAll((node) => String(node.type) === 'View' && node.findAllByType('Frame' as never).length > 0)[0]!
    expect(flat(frame.props.style).borderColor).toBe(colors.border)
    const open = root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Open Usage by day full screen')
    expect(flat(open.props.style).backgroundColor).toBe(colors.bgPanel)
    expect(root.findByType('Maximize2' as never).props.color).toBe(colors.textSecondary)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('says unavailable in muted %s ink, and a tap asks again', (scheme, colors) => {
    const root = render({ kind: 'unavailable' }, scheme)
    const line = root.find((node) => String(node.type) === 'Text')
    expect(flat(line.props.style).color).toBe(colors.textMuted)
    const button = root.find((node) => String(node.type) === 'Pressable')
    act(() => button.props.onPress())
    expect(visual.retry).toHaveBeenCalledTimes(1)
  })

  it('offers no tap where the host cannot serve visuals at all', () => {
    const root = render({ kind: 'unsupported' })
    expect(root.findAll((node) => String(node.type) === 'Pressable')).toEqual([])
    expect(root.find((node) => String(node.type) === 'Text').children).toEqual(['Visualization unavailable'])
  })

  it('reserves quiet space while it loads', () => {
    const root = render({ kind: 'loading' })
    expect(root.findAllByType('ActivityIndicator' as never)).toHaveLength(1)
    expect(root.findAllByType('Frame' as never)).toEqual([])
  })
})
