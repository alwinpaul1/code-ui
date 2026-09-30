import { useState, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'

// A pick with the caret inside a mention replaced only the part before the
// caret: 'open @src/app.ts now' with the caret on the `c` of `src` became
// 'open @src/main.ts c/app.ts now', and the composer sent that.

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    // Renders every row eagerly so the test can press one.
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
      ...props
    }: {
      data: readonly unknown[]
      renderItem: (info: { item: unknown; index: number }) => unknown
      keyExtractor: (item: unknown) => string
    }) =>
      React.createElement(
        'FlatList',
        props,
        data.map((item, index) =>
          React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index }) as ReactNode)
        )
      ),
    Image: 'Image',
    Keyboard: { dismiss: vi.fn(), isVisible: () => true, addListener: () => ({ remove: () => {} }) },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Code: 'Code',
  Hand: 'Hand',
  Image: 'Image',
  ImagePlus: 'ImagePlus',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Zap: 'Zap',
  Plus: 'Plus',
  Square: 'Square',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})

/** The mocked host tags are plain strings React's element types do not list. */
const isHost = (node: ReactTestInstance, tag: string): boolean => (node.type as unknown) === tag

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('an @file pick with the caret inside the mention', () => {
  it.each(['light', 'dark'] as const)(
    'replaces the whole mention and puts the caret after it, in %s',
    async (scheme) => {
      const sent: string[] = []
      function Host(): React.JSX.Element {
        const [value, setValue] = useState('open @src/app.ts now')
        return (
          <MobileNativeChatComposer
            value={value}
            onChangeText={(text) => {
              sent.push(text)
              setValue(text)
            }}
            onSend={async () => true}
            sendSurfaceId="tab-a"
            getSendCompletionGeneration={() => 0}
            getComposerEditGeneration={() => 0}
            agent="claude"
            filePaths={['src/main.ts']}
          />
        )
      }
      await act(async () => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <Host />
          </ThemeProvider>
        )
      })
      const input = () => renderer!.root.find((node) => isHost(node, 'TextInput'))
      // The caret on the `c` of `src`.
      await act(async () =>
        (input().props.onSelectionChange as (e: unknown) => void)({
          nativeEvent: { selection: { start: 8, end: 8 } }
        })
      )
      const row = renderer!.root.find(
        (node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === '@src/main.ts'
      )
      await act(async () => (row.props.onPress as () => void)())
      expect(sent).toEqual(['open @src/main.ts now'])
      expect(input().props.value).toBe('open @src/main.ts now')
      const caret = 'open @src/main.ts '.length
      expect(input().props.selection).toEqual({ start: caret, end: caret })
    }
  )
})
