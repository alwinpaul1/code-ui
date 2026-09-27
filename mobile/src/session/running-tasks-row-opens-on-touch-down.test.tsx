import { useMemo, useState } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'

// "6 running tasks" above the composer opens the background tasks sheet the
// way the + does (849b0843): on touch-down. The row is in the dock's chrome
// row, a sibling of the chat list, outside its scroll and under no gesture
// handler, so nothing can claim the touch after it has opened the sheet.

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    createAnimatedComponent: (c: unknown) => c,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({}),
    sequence: () => ({})
  },
  Easing: { inOut: () => 0, quad: 0 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

let renderer: ReactTestRenderer | null = null
const state = { opens: 0, open: false }

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  state.opens = 0
  state.open = false
})

/** The provider's own shape: opening sets a flag, so a second open is a no-op. */
function Host({ scheme }: { scheme: 'light' | 'dark' }): React.JSX.Element {
  const [, setOpen] = useState(false)
  const tasks = useMemo(
    () => ({
      runningCount: 6,
      openSheet: (): void => {
        state.opens += 1
        state.open = true
        setOpen(true)
      }
    }),
    []
  )
  return (
    <ThemeProvider initialPreference={scheme}>
      <NativeChatTasksContext.Provider value={tasks}>
        <MobileNativeChatStatusLine working={false} spinner={null} />
      </NativeChatTasksContext.Provider>
    </ThemeProvider>
  )
}

async function mount(scheme: 'light' | 'dark'): Promise<ReactTestInstance> {
  await act(async () => {
    renderer = create(<Host scheme={scheme} />)
  })
  return renderer!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === '6 running tasks. Open background tasks'
  )
}

describe.each(['light', 'dark'] as const)('the running tasks row in %s mode', (scheme) => {
  it('opens the background tasks sheet as the finger lands', async () => {
    const row = await mount(scheme)
    await act(async () => (row.props.onPressIn as (() => void) | undefined)?.())
    expect(state.open, 'the row waited for the finger to lift').toBe(true)
  })

  it('still opens from a screen reader’s click, which has no press-in', async () => {
    const row = await mount(scheme)
    await act(async () => (row.props.onPress as () => void)())
    expect(state.open).toBe(true)
  })
})
