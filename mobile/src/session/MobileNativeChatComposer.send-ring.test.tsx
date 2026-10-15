import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app's Send button while its send is in flight (1.261013.20): the composer hands
// `oj9.f` a `Send(enabled, processing)` state (`j28`, ui7.java:150), and `processing` draws a
// progress ring in the button in place of the arrow until the post returns. Code UI drew the
// arrow, greyed, with nothing to say the tap had been taken (parity audit #12). Claude tabs
// only: Codex keeps its button as it was.
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
  FileUp: 'FileUp',
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

function flat(style: unknown): Record<string, unknown> {
  if (typeof style === 'function') {
    return flat((style as (state: { pressed: boolean }) => unknown)({ pressed: false }))
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flat(entry)))
  }
  return (style ?? {}) as Record<string, unknown>
}

async function render(agent: string, onSend: (text: string) => Promise<boolean>, scheme: 'light' | 'dark' = 'light'): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatComposer
          value="run the tests"
          agent={agent}
          onChangeText={vi.fn()}
          onSend={onSend}
          sendSurfaceId="tab-a"
          getSendCompletionGeneration={() => 0}
          getComposerEditGeneration={() => 0}
          onAttachImage={vi.fn()}
          onMicPress={vi.fn()}
        />
      </ThemeProvider>
    )
  })
}

function send(): ReactTestInstance {
  return renderer!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Send message'
  )
}

function rings(): ReactTestInstance[] {
  return renderer!.root.findAll((node) => node.props.testID === 'native-chat-send-ring' && typeof node.type === 'string')
}

/** A send that stays in flight until `settle` is called. */
function heldSend(): { onSend: (text: string) => Promise<boolean>; settle: (accepted: boolean) => void } {
  let settle: (accepted: boolean) => void = () => {}
  const onSend = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
  return { onSend, settle: (accepted) => settle(accepted) }
}

describe('the Send button while a Claude send is in flight', () => {
  it.each(['light', 'dark'] as const)('draws a progress ring in the button instead of the arrow, in %s', async (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    const held = heldSend()
    await render('claude', held.onSend, scheme)
    expect(rings()).toHaveLength(0)
    await act(async () => send().props.onPress())
    expect(rings()).toHaveLength(1)
    expect(rings()[0]!.props.color).toBe(colors.composerSendGlyph)
    expect(send().findAll((node) => (node.type as unknown) === 'ArrowUp')).toHaveLength(0)
    // The clay circle stays clay while it works, and a second tap is not taken.
    expect(flat(send().props.style).backgroundColor).toBe(colors.composerSend)
    expect(send().props.accessibilityState).toMatchObject({ busy: true })
    await act(async () => held.settle(true))
  })

  it('takes the ring away once the send is taken', async () => {
    const held = heldSend()
    await render('claude', held.onSend)
    await act(async () => send().props.onPress())
    await act(async () => held.settle(true))
    expect(rings()).toHaveLength(0)
    expect(send().findAll((node) => (node.type as unknown) === 'ArrowUp')).toHaveLength(1)
  })

  it('takes the ring away when the send is refused, so the button is not left spinning', async () => {
    const held = heldSend()
    await render('claude', held.onSend)
    await act(async () => send().props.onPress())
    await act(async () => held.settle(false))
    expect(rings()).toHaveLength(0)
  })

  it('leaves a Codex tab’s button as it was: no ring', async () => {
    const held = heldSend()
    await render('codex', held.onSend)
    await act(async () => send().props.onPress())
    expect(rings()).toHaveLength(0)
    await act(async () => held.settle(true))
  })
})
