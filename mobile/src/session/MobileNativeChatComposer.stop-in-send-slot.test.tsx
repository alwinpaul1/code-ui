import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// Stop lives in the send button's slot, as the Claude app has it (1.261009.20,
// decompiled: yv8.i picks one of Idle/Ready/Sending/Receiving/Interrupting, and
// ll case 3 maps Receiving and Interrupting to the Stop button, the rest to
// Send; krz.d shows exactly one of the two). Both Stop states need an empty
// composer, so typing while the agent works brings Send back to queue the
// message and Stop goes. Code UI drew Stop as a red pill on the status line
// above the composer instead. Sizes and colours stay Code UI's own: the 36 dp
// circle of + and the mic, and the danger tone the old pill had.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null }))
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
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))

import { MobileNativeChatComposer } from './MobileNativeChatComposer'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown, pressed = false): Record<string, unknown> {
  if (typeof style === 'function') {
    return flat((style as (state: { pressed: boolean }) => unknown)({ pressed }), pressed)
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flat(entry, pressed)))
  }
  return (style ?? {}) as Record<string, unknown>
}

type Extra = {
  canStop?: boolean
  stopping?: boolean
  onStop?: () => void
  attachments?: { id: string; uri: string; status: 'ready' }[]
}

async function render(value: string, extra: Extra, scheme: 'light' | 'dark' = 'light'): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatComposer
          value={value}
          onChangeText={vi.fn()}
          onSend={vi.fn().mockResolvedValue(true)}
          sendSurfaceId="tab-a"
          getSendCompletionGeneration={() => 0}
          getComposerEditGeneration={() => 0}
          onAttachImage={vi.fn()}
          onMicPress={vi.fn()}
          {...(extra as Record<string, unknown>)}
        />
      </ThemeProvider>
    )
  })
}

function labelled(label: string): ReactTestInstance[] {
  return renderer!.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label
  )
}

/** The last button in the action row: the trailing slot Send and Stop share. */
function trailing(): ReactTestInstance {
  const row = renderer!.root.find((node) => node.props.testID === 'native-chat-composer-actions')
  const buttons = row.findAll((node) => (node.type as unknown) === 'Pressable')
  return buttons[buttons.length - 1]!
}

describe('Stop in the composer’s send slot', () => {
  it('takes the send slot while the agent works and nothing is typed', async () => {
    await render('', { canStop: true, onStop: vi.fn() })
    expect(labelled('Send message')).toHaveLength(0)
    expect(trailing().props.accessibilityLabel).toBe('Stop the agent')
  })

  it('gives the slot back to Send once there is text, so it can be queued', async () => {
    await render('and then run the tests', { canStop: true, onStop: vi.fn() })
    expect(labelled('Stop the agent')).toHaveLength(0)
    expect(trailing().props.accessibilityLabel).toBe('Send message')
    expect(trailing().props.disabled).toBe(false)
  })

  it('gives the slot back to Send for a photo with no words', async () => {
    await render('   ', { canStop: true, onStop: vi.fn(), attachments: [{ id: 'p', uri: 'file:///p.jpg', status: 'ready' }] })
    expect(labelled('Stop the agent')).toHaveLength(0)
    expect(trailing().props.accessibilityLabel).toBe('Send message')
  })

  it('shows Send, never Stop, while the agent is idle', async () => {
    await render('', { canStop: false, onStop: vi.fn() })
    expect(labelled('Stop the agent')).toHaveLength(0)
    expect(trailing().props.accessibilityLabel).toBe('Send message')
  })

  it('interrupts on a tap', async () => {
    const onStop = vi.fn()
    await render('', { canStop: true, onStop })
    await act(async () => trailing().props.onPress())
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('rings itself while stopping and stays tappable, as the Claude app does', async () => {
    await render('', { canStop: true, onStop: vi.fn(), stopping: false })
    expect(renderer!.root.findAll((node) => node.props.testID === 'native-chat-stop-ring')).toHaveLength(0)
    await act(async () => renderer!.unmount())
    await render('', { canStop: true, onStop: vi.fn(), stopping: true })
    expect(renderer!.root.findAll((node) => node.props.testID === 'native-chat-stop-ring')).toHaveLength(1)
    expect(trailing().props.disabled).toBeFalsy()
    expect(trailing().props.accessibilityState).toMatchObject({ busy: true })
  })

  it.each(['light', 'dark'] as const)('draws Stop in Code UI’s own circle and danger tone in %s', async (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    await render('', { canStop: true, onStop: vi.fn() }, scheme)
    const style = flat(trailing().props.style)
    expect(style).toMatchObject({ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgRaised })
    const square = trailing().find((node) => (node.type as unknown) === 'Square')
    expect(square.props.fill).toBe(colors.danger)
    expect(square.props.color).toBe(colors.danger)
  })
})
