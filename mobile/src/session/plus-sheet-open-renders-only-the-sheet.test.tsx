import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'

// The + sheet's open flag lived in the composer's own state, so the tap that
// opens it re-ran the whole composer first: the text field, the photo chips,
// the model pills, the context ring, the suggestion hook and the three other
// sheets' wrappers, none of which change. That render sits between the
// finger and the commit that mounts the sheet's native window, and again in
// front of the Photos tap's close. The flag now lives with the + and the sheet
// alone. (The picker itself waits for the sheet to have gone:
// plus-sheet-closes-before-the-picker-opens.test.tsx.)
//
// The chip strip stands in for "the rest of the composer": it is a plain
// function component that renders whenever the composer does.
//
// Not covered here: with the keyboard up, the + blurs the text field, and
// the field's onBlur re-renders the composer once for its focus border. That
// render comes back from the native side after the sheet's commit, not in
// front of it, and main paid it too (the drawer's close blurred the field).

const chipRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('./MobileNativeChatAttachmentChips', () => ({
  MobileNativeChatAttachmentChips: () => {
    chipRenders.count += 1
    return null
  }
}))

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
    Keyboard: { dismiss: () => {}, isVisible: () => false, addListener: () => ({ remove: () => {} }) },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Camera: 'Camera',
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
  Plus: 'Plus',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Square: 'Square',
  X: 'X',
  Zap: 'Zap'
}))

vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    // Reports the sheet gone in the commit that closes it: this file counts renders, not the exit.
    BottomDrawer: ({
      visible,
      onClose,
      onAfterClose,
      children
    }: {
      visible: boolean
      onClose: () => void
      onAfterClose?: () => void
      children?: unknown
    }) => {
      const wasVisible = React.useRef(visible)
      React.useEffect(() => {
        if (wasVisible.current && !visible) {
          onAfterClose?.()
        }
        wasVisible.current = visible
      }, [visible])
      return visible ? React.createElement('BottomDrawer', { visible, onClose }, children as React.ReactNode) : null
    }
  }
})

/** The mocked host tags are plain strings React's element types do not list. */
function isHost(node: { type: unknown }, tag: string): boolean {
  return node.type === tag
}

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  chipRenders.count = 0
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function mountComposer(scheme: 'light' | 'dark', onOpenMode = vi.fn()): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileNativeChatComposer, {
          value: 'hello',
          onChangeText: () => {},
          onSend: async () => true,
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          agent: 'claude',
          onCaptureImage: () => {},
          onAttachImage: () => {},
          onAttachFile: () => {},
          permissionMode: 'default',
          onSelectPermissionMode: onOpenMode
        })}
      </ThemeProvider>,
      { createNodeMock: () => ({ focus: () => {}, blur: () => {}, isFocused: () => false }) }
    )
  })
}

function find(label: string): ReactTestInstance {
  return renderer!.root.find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === label)
}

function attachSheet(): ReactTestInstance | undefined {
  return renderer!.root
    .findAll((node) => isHost(node, 'BottomDrawer'))
    .find((drawer) => drawer.findAll((node) => node.props.accessibilityLabel === 'Photos').length > 0)
}

async function tapPlus(): Promise<void> {
  const button = find('Add to chat')
  const press = (button.props.onPressIn ?? button.props.onPress) as () => void
  await act(async () => press())
}

describe.each(['light', 'dark'] as const)('the + sheet in %s mode', (scheme) => {
  it('opens without re-rendering the rest of the composer', async () => {
    await mountComposer(scheme)
    const before = chipRenders.count

    await tapPlus()

    expect(attachSheet(), 'the sheet did not open').toBeDefined()
    expect(chipRenders.count - before, 'the whole composer re-rendered to open the sheet').toBe(0)
  })

  it('closes without re-rendering the rest of the composer', async () => {
    await mountComposer(scheme)
    await tapPlus()
    const before = chipRenders.count

    await act(async () => (attachSheet()!.props.onClose as () => void)())

    expect(attachSheet()).toBeUndefined()
    expect(chipRenders.count - before, 'the whole composer re-rendered to close the sheet').toBe(0)
  })

  it('closes on Photos, and asks for the picker once it has gone', async () => {
    const onAttachImage = vi.fn()
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(MobileNativeChatComposer, {
            value: '',
            onChangeText: () => {},
            onSend: async () => true,
            sendSurfaceId: 'tab-a',
            getSendCompletionGeneration: () => 0,
            getComposerEditGeneration: () => 0,
            onCaptureImage: () => {},
            onAttachImage,
            onAttachFile: () => {}
          })}
        </ThemeProvider>
      )
    })
    await tapPlus()
    await act(async () => (find('Photos').props.onPress as () => void)())

    expect(onAttachImage).toHaveBeenCalledTimes(1)
    expect(attachSheet()).toBeUndefined()
  })

  it('hands over to the permission sheet from its Permission row', async () => {
    // The row closes this sheet and opens the mode sheet, which is the
    // composer's: the one open that does re-render it.
    await mountComposer(scheme)
    await tapPlus()

    await act(async () => (find('Permission mode').props.onPress as () => void)())

    expect(attachSheet()).toBeUndefined()
    const drawers = renderer!.root.findAll((node) => isHost(node, 'BottomDrawer'))
    expect(drawers, 'the permission sheet did not open').toHaveLength(1)
  })
})
