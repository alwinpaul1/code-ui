// The ask card's new words after Submit ("Sending…", the "Sent" status, and
// the line that says the agent has not taken the answer yet) drawn through the
// real Button and Txt under both themes. A literal colour here would pass every other test
// and still ship one theme's ink on the other's card.

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'
import { contrastRatio } from '../test/contrast'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))

import { ASK_SENT_WAIT_MS, ASK_SENT_WAITING_LINE, MobileNativeChatAsk } from './MobileNativeChatAsk'

const PUSH: AskPrompt = {
  questions: [
    {
      question: 'The branch is ready. Push it and update the pull request?',
      header: 'Push',
      multiSelect: false,
      options: [
        { label: 'Yes, push to PR 1100', description: 'Push the branch and update the open pull request.' },
        { label: 'No, keep it local', description: 'Leave the commits on this machine for now.' }
      ]
    }
  ]
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat))
  }
  return (style ?? {}) as Record<string, unknown>
}

function textNode(content: string): ReactTestInstance {
  const node = renderer!.root.findAll(
    (candidate) => (candidate.type as unknown) === 'Text' && [candidate.props.children].flat().join('') === content
  )[0]
  expect(node, `no "${content}" on the card`).toBeDefined()
  return node!
}

function button(label: string): ReactTestInstance {
  const node = renderer!.root.findAll(
    (candidate) => (candidate.type as unknown) === 'Pressable' && candidate.props.accessibilityLabel === label
  )[0]
  expect(node, `no "${label}" button`).toBeDefined()
  return node!
}

describe('the ask card after Submit, in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws Sending…, Sent and the waiting line in %s ink', async (scheme, palette) => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let reply: (accepted: boolean) => void = () => undefined
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatAsk
            prompt={PUSH}
            onAnswer={() =>
              new Promise<boolean>((resolve) => {
                reply = resolve
              })
            }
          />
        </ThemeProvider>
      )
    })
    const option = renderer!.root.findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio'
    )[0]!
    act(() => option.props.onPress())
    await act(async () => {
      button('Submit').props.onPress()
    })

    // In flight: a spinner and a word on the accent pill, not a dimmed Submit.
    const spinner = renderer!.root.findAll((node) => (node.type as unknown) === 'ActivityIndicator')[0]
    expect(spinner?.props.color).toBe(palette.onAccent)
    expect(flat(textNode('Sending…').props.style).color).toBe(palette.onAccent)
    expect(flat(button('Sending…').props.style).opacity).toBe(1)

    await act(async () => {
      reply(true)
    })
    // Sent is a status on its own ground, read at full strength: a disabled
    // Button would paint it at half, 1.9:1 in light.
    const pill = renderer!.root.findAll((node) => node.props.testID === 'ask-sent')[0]!
    const ground = flat(pill.props.style).backgroundColor as string
    expect(ground).toBe(palette.bgRaised)
    const sent = flat(textNode('Sent').props.style).color as string
    expect(sent).toBe(palette.textSecondary)
    expect(contrastRatio(sent, ground)).toBeGreaterThanOrEqual(4.5)
    const check = pill.findAll((node) => (node.type as unknown) === 'Check')[0]!
    expect(check.props.color).toBe(palette.success)
    // A graphic, not text: WCAG's 3:1 for non-text contrast.
    expect(contrastRatio(check.props.color as string, ground)).toBeGreaterThanOrEqual(3)

    act(() => {
      vi.advanceTimersByTime(ASK_SENT_WAIT_MS)
    })
    const waiting = flat(textNode(ASK_SENT_WAITING_LINE).props.style).color as string
    expect(waiting).toBe(palette.textSecondary)
    // Small caption text on the card's own ground: WCAG AA for body text.
    expect(contrastRatio(waiting, palette.bgPanel)).toBeGreaterThanOrEqual(4.5)
  })
})
