// "when a message is queued had to click multiple times to get that send now
// done" (2026-10-14). A Send now tap can wait seconds over the relay: for a
// message still being typed into Claude, a look at the screen, the key's own
// round trip. The button looked untouched all that time, so it was tapped
// again. It now says "Sending…" until the tap settles, takes no second tap,
// and reads in both themes.

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: <T,>(styles: T) => styles },
  useColorScheme: () => 'light'
}))
vi.mock('./image-preview-store', () => ({ openImagePreview: vi.fn() }))
vi.mock('lucide-react-native', () => ({ Pencil: 'Pencil' }))

import { MobileNativeChatQueue } from './MobileNativeChatQueue'

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat))
  }
  return (style ?? {}) as Record<string, unknown>
}

function sendNowButton(): ReactTestInstance {
  const node = renderer!.root.findAll(
    (candidate) =>
      (candidate.type as unknown) === 'Pressable' && candidate.props.accessibilityLabel === 'Send queued messages now'
  )[0]
  expect(node, 'no Send now button').toBeDefined()
  return node!
}

function label(): ReactTestInstance {
  return sendNowButton().findAll((node) => (node.type as unknown) === 'Text')[0]!
}

describe('Send now while its tap is on its way, in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('says Sending… and takes one tap until it settles (%s)', async (scheme, palette) => {
    let settle: (sent: boolean) => void = () => undefined
    const onSendNow = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        })
    )
    // Degenerate size: one queued message, the one the user just sent.
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatQueue messages={['fix the build first']} agent="claude" agentWorking onSendNow={onSendNow} />
        </ThemeProvider>
      )
    })
    expect(label().props.children).toBe('Send now')
    expect(flat(label().props.style).color).toBe(palette.accentText)

    act(() => sendNowButton().props.onPress())
    act(() => sendNowButton().props.onPress())

    expect(onSendNow).toHaveBeenCalledTimes(1)
    expect(label().props.children).toBe('Sending…')
    expect(sendNowButton().props.disabled).toBe(true)
    expect(sendNowButton().props.accessibilityState).toMatchObject({ busy: true })
    const ink = flat(label().props.style).color as string
    expect(ink).toBe(palette.textSecondary)
    expect(contrastRatio(ink, palette.bgPanel)).toBeGreaterThanOrEqual(4.5)

    await act(async () => {
      settle(true)
    })
    expect(label().props.children).toBe('Send now')
    expect(sendNowButton().props.disabled).toBe(false)
  })

  // Failure path: a refused tap (its own error line says why) gives the button back.
  it('gives the button back after a tap that was refused', async () => {
    const onSendNow = vi.fn().mockResolvedValue(false)
    act(() => {
      renderer = create(
        <MobileNativeChatQueue messages={['fix the build first']} agent="claude" agentWorking onSendNow={onSendNow} />
      )
    })
    await act(async () => {
      sendNowButton().props.onPress()
    })
    expect(label().props.children).toBe('Send now')
    act(() => sendNowButton().props.onPress())
    expect(onSendNow).toHaveBeenCalledTimes(2)
  })
})
