import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
// The drawer shell pulls in gesture-handler's Flow-typed RN internals, which
// Node cannot parse; the sheet body under test never touches it.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('Drawer', null, children) : null
}))

import { useMobileNativeChatRewind } from './use-mobile-native-chat-rewind'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

function assistant(id: string, text: string): NativeChatMessage {
  return { ...user(id, text), role: 'assistant' }
}

const MESSAGES = [user('u1', 'first'), assistant('a1', 'reply one'), user('u2', 'second'), assistant('a2', 'reply two')]

type Args = Parameters<typeof useMobileNativeChatRewind>[0]

describe('the Rewind to here sheet', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileNativeChatRewind> | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  function Harness(args: Args): ReactNode {
    hook = useMobileNativeChatRewind(args)
    return hook.sheet
  }

  function mount(args: Partial<Args> = {}, preference: 'light' | 'dark' = 'light'): Args {
    const full: Args = {
      messages: MESSAGES,
      folded: MESSAGES,
      onRewindToMessage: vi.fn(async () => true),
      composerText: '',
      onComposerTextChange: vi.fn(),
      ...args
    }
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: preference }, createElement(Harness, full))
      )
    })
    return full
  }

  function textOf(node: ReactTestInstance): string {
    return node.findAllByType('Text' as never).map((text) => text.children.join('')).join('\n')
  }

  function button(label: string): ReactTestInstance {
    return renderer!.root.find(
      (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label
    )
  }

  it('offers rewind on the journalled user messages and on nothing else', () => {
    // A queued echo is drawn (it is in `folded`) but has no journal item the
    // host could rewind to, so it is never in `messages` and never offered.
    mount({ folded: [...MESSAGES, { ...user('pending-1', 'queued'), source: 'hook' }] })
    expect([...hook!.rewindable]).toEqual(['u1', 'u2'])
    expect(hook!.request).toEqual(expect.any(Function))
  })

  it('offers nothing when the lane has no way to rewind', () => {
    mount({ onRewindToMessage: undefined })
    expect(hook!.rewindable.size).toBe(0)
    expect(hook!.request).toBeUndefined()
    expect(renderer!.root.findAllByType('Drawer' as never)).toHaveLength(0)
  })

  it('asks before dropping anything, and names how many messages go', () => {
    const { onRewindToMessage } = mount()
    expect(renderer!.root.findAllByType('Drawer' as never)).toHaveLength(0)
    act(() => hook!.request?.('u2'))
    const sheet = renderer!.root.findByType('Drawer' as never)
    expect(textOf(sheet)).toContain('Rewind to this message?')
    expect(textOf(sheet)).toContain('Drops 2 messages from the conversation.')
    expect(textOf(sheet)).toContain('Conversation only; files stay as they are.')
    expect(textOf(sheet)).toContain('To restore files too, use /rewind in the terminal.')
    expect(onRewindToMessage).not.toHaveBeenCalled()
  })

  it('says "later messages" when it cannot count them', () => {
    mount({ folded: [] })
    act(() => hook!.request?.('u2'))
    const sheet = renderer!.root.findByType('Drawer' as never)
    expect(textOf(sheet)).toContain('Drops this message and the later messages')
  })

  it('does nothing on Cancel', () => {
    const { onRewindToMessage } = mount()
    act(() => hook!.request?.('u2'))
    act(() => button('Cancel').props.onPress())
    expect(onRewindToMessage).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByType('Drawer' as never)).toHaveLength(0)
  })

  it('rewinds on confirm, then puts the dropped prompt back into an empty composer', async () => {
    const { onRewindToMessage, onComposerTextChange } = mount()
    act(() => hook!.request?.('u2'))
    await act(async () => {
      button('Rewind').props.onPress()
    })
    expect(onRewindToMessage).toHaveBeenCalledWith('u2')
    expect(onComposerTextChange).toHaveBeenCalledWith('second')
    expect(renderer!.root.findAllByType('Drawer' as never)).toHaveLength(0)
  })

  it('leaves a draft the reader is typing alone', async () => {
    const { onComposerTextChange } = mount({ composerText: 'half-typed' })
    act(() => hook!.request?.('u2'))
    await act(async () => {
      button('Rewind').props.onPress()
    })
    expect(onComposerTextChange).not.toHaveBeenCalled()
  })

  it('leaves the composer alone when the host refused, since nothing was dropped', async () => {
    const { onComposerTextChange } = mount({ onRewindToMessage: vi.fn(async () => false) })
    act(() => hook!.request?.('u2'))
    await act(async () => {
      button('Rewind').props.onPress()
    })
    expect(onComposerTextChange).not.toHaveBeenCalled()
  })

  it('ignores a second request while one is still with the host', async () => {
    let settle: (accepted: boolean) => void = () => {}
    const onRewindToMessage = vi.fn(
      () => new Promise<boolean>((resolve) => {
        settle = resolve
      })
    )
    mount({ onRewindToMessage })
    act(() => hook!.request?.('u2'))
    act(() => button('Rewind').props.onPress())
    act(() => hook!.request?.('u1'))
    expect(renderer!.root.findAllByType('Drawer' as never)).toHaveLength(0)
    await act(async () => settle(true))
    expect(onRewindToMessage).toHaveBeenCalledTimes(1)
    act(() => hook!.request?.('u1'))
    expect(renderer!.root.findAllByType('Drawer' as never)).toHaveLength(1)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the sheet from the %s palette, never a fixed one', (preference, colors) => {
    mount({}, preference)
    act(() => hook!.request?.('u2'))
    const sheet = renderer!.root.findByType('Drawer' as never)
    const styles = sheet
      .findAllByType('Text' as never)
      .map((text) => Object.assign({}, ...([] as unknown[]).concat(text.props.style).flat(Infinity).filter(Boolean)))
    const title = styles.find((style) => style.color === colors.text)
    const body = styles.find((style) => style.color === colors.textSecondary)
    expect(title).toBeDefined()
    expect(body).toBeDefined()
    const other = preference === 'light' ? darkColors : lightColors
    expect(styles.some((style) => style.color === other.text)).toBe(false)
  })
})
