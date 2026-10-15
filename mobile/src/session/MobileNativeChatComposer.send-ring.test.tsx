import { readFileSync } from 'node:fs'
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
import { claudeSendRingShown } from './native-chat-send-ring'
import type { ClaudeChatGate } from './use-claude-anthropic-transcript'

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

/** `sendRing`: the tab is a Claude tab matched to its Anthropic session (claudeSendRingShown). */
async function render(agent: string, onSend: (text: string) => Promise<boolean>, scheme: 'light' | 'dark' = 'light', sendRing = agent === 'claude'): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatComposer
          value="run the tests"
          agent={agent}
          sendRing={sendRing}
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
    await render('codex', held.onSend, 'light', false)
    await act(async () => send().props.onPress())
    expect(rings()).toHaveLength(0)
    await act(async () => held.settle(true))
  })

  // Review 2026-10-15: the ring showed on any Claude tab. It is the Claude app's, drawn on a tab
  // matched to its Anthropic session, as the session's other app features are.
  it.each(['light', 'dark'] as const)('draws no ring on a Claude tab not matched to its Anthropic session, in %s', async (scheme) => {
    const held = heldSend()
    await render('claude', held.onSend, scheme, false)
    await act(async () => send().props.onPress())
    expect(rings()).toHaveLength(0)
    expect(send().findAll((node) => (node.type as unknown) === 'ArrowUp')).toHaveLength(1)
    await act(async () => held.settle(true))
  })
})

describe('which tabs ring their Send button', () => {
  it('a Claude tab matched to its Anthropic session', () => {
    expect(claudeSendRingShown('claude', { kind: 'matched' } as ClaudeChatGate)).toBe(true)
  })

  it('not an unmatched, signed-out, off or gateless Claude tab', () => {
    for (const kind of ['unmatched', 'signed-out', 'off', 'finding', 'new', 'orca-empty']) {
      expect(claudeSendRingShown('claude', { kind } as ClaudeChatGate)).toBe(false)
    }
    expect(claudeSendRingShown('claude', undefined)).toBe(false)
  })

  it('not a Codex tab, nor a tab with no agent, whatever its gate says', () => {
    expect(claudeSendRingShown('codex', { kind: 'matched' } as ClaudeChatGate)).toBe(false)
    expect(claudeSendRingShown(null, { kind: 'matched' } as ClaudeChatGate)).toBe(false)
  })
})

// The overlay is too wide to mount here; the wiring is pinned in its source, on code lines only
// (a `//` comment naming the call does not count): the chat view is handed the gate's answer, and
// the composer rings on that alone, not on the agent.
describe('where the ring’s gate is wired', () => {
  const code = (file: string) =>
    readFileSync(new URL(file, import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')

  it('the overlay hands the chat view the matched-tab answer', () => {
    expect(code('./MobileNativeChatOverlay.tsx')).toMatch(/sendRing=\{claudeSendRingShown\(controller\.nativeChatAgent, anthropicGate\)\}/)
  })

  it('the composer rings on that answer, not on the agent being Claude', () => {
    const composer = code('./MobileNativeChatComposer.tsx')
    expect(composer).toMatch(/sending=\{sending && sendRing\}/)
    expect(composer).not.toMatch(/sending=\{[^}]*agent === 'claude'/)
  })
})
