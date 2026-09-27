import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'

// The composer's context ring opens its sheet the way the + does
// (849b0843): on touch-down, not when the finger lifts. The recording of
// 2026-09-27 held each tap about 80 ms, all of it spent waiting. The ring
// sits in the composer's action row, in the dock, outside the chat list's
// scroll and under no gesture handler, so nothing can claim the touch after
// it has opened the sheet. The sheet itself sends the keyboard away as it
// opens (sheets-over-the-chat-keyboard.test.tsx).

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

function ring(): ReactTestInstance {
  return renderer!.root.find(
    (node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === 'Context window 42% used'
  )
}

function sheetUp(): boolean {
  return renderer!.root.findAll((node) => isHost(node, 'BottomDrawer')).length > 0
}

describe.each(['light', 'dark'] as const)('the context ring in %s mode', (scheme) => {
  it('opens its sheet as the finger lands', async () => {
    await mountComposer(scheme)
    await act(async () => (ring().props.onPressIn as (() => void) | undefined)?.())
    expect(sheetUp(), 'the ring waited for the finger to lift').toBe(true)
  })

  it('still opens from a screen reader’s click, which has no press-in', async () => {
    await mountComposer(scheme)
    await act(async () => (ring().props.onPress as () => void)())
    expect(sheetUp()).toBe(true)
  })

  it('stays open when the release follows the press-in', async () => {
    await mountComposer(scheme)
    await act(async () => (ring().props.onPressIn as (() => void) | undefined)?.())
    await act(async () => (ring().props.onPress as () => void)())
    expect(sheetUp(), 'the release toggled the sheet shut').toBe(true)
  })
})
