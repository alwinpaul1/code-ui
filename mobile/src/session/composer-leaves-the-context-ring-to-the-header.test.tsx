import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'

// The context ring moved from the composer's action row to the session header, as the Claude app
// places it (parity gap G9; session-header-copies-claude.test.tsx pins the header's ring, its
// colours and its touch-down open). The composer must not draw a second one: two rings, one in the
// dock and one in the header, would state the same figure twice and open two sheets.

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: ({ data, renderItem, keyExtractor, ...props }: {
      data: readonly unknown[]
      renderItem: (info: { item: unknown; index: number }) => unknown
      keyExtractor: (item: unknown) => string
    }) =>
      React.createElement(
        'FlatList',
        props,
        data.map((item, index) =>
          React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index }) as React.ReactNode)
        )
      ),
    Image: 'Image',
    Keyboard: { dismiss: () => {}, isVisible: () => true, addListener: () => ({ remove: () => {} }) },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})

vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})

vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/** The mocked host tags are plain strings React's element types do not list. */
function isHost(node: { type: unknown }, tag: string): boolean {
  return node.type === tag
}

async function mountComposer(scheme: 'light' | 'dark'): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileNativeChatComposer, {
          value: 'draft',
          onChangeText: () => {},
          onSend: async () => true,
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          agent: 'claude',
          contextWindow: { usedPercent: 42 } as never
        })}
      </ThemeProvider>,
      { createNodeMock: () => ({ focus: () => {}, blur: () => {}, isFocused: () => true }) }
    )
  })
}

const contextRings = (): ReactTestInstance[] =>
  renderer!.root.findAll(
    (node) =>
      isHost(node, 'Pressable') &&
      typeof node.props.accessibilityLabel === 'string' &&
      /context window|view usage/i.test(node.props.accessibilityLabel)
  )

describe.each(['light', 'dark'] as const)('the composer in %s mode', (scheme) => {
  it('draws no context ring, which the header now owns', async () => {
    await mountComposer(scheme)
    expect(contextRings()).toHaveLength(0)
    expect(renderer!.root.findAll((node) => isHost(node, 'BottomDrawer'))).toHaveLength(0)
  })
})
