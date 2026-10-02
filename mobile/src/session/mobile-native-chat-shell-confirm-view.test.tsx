// The chat's own send is the one that asks about `!` messages: the overlay
// mounts the wrapper, and the wrapper hands the view a send that asks first.
// Structure test and a behaviour test, because a view mounted bare would pass
// every other test and run a `!` message with no question.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: unknown }) =>
    visible ? children : null
}))
const view = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
  record: null as null | ((props: Record<string, unknown>) => void)
}))
vi.mock('./MobileNativeChatView', () => ({
  MobileNativeChatView: (props: Record<string, unknown>) => {
    view.props = props
    view.record?.(props)
    return null
  }
}))

import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatShellConfirmView } from './MobileNativeChatShellConfirmView'

const code = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    .split('\n')
    .filter((row) => !/^\s*(\/\/|\/\*|\*)/.test(row))
    .join('\n')

let renderer: ReactTestRenderer | null = null
/** The sheet is loaded lazily the first time a `!` message is sent. */
const flushLazy = async (): Promise<void> => {
  for (let wait = 0; wait < 100; wait++) {
    if (JSON.stringify(renderer?.toJSON() ?? null).includes('Run on the desktop?')) {
      return
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  view.props = null
})

describe('the chat overlay', () => {
  it('mounts the view that asks about a `!` message, never the bare one', () => {
    const overlay = code('./MobileNativeChatOverlay.tsx')
    expect(overlay).toMatch(/<MobileNativeChatShellConfirmView\b/)
    expect(overlay).not.toMatch(/<MobileNativeChatView\b/)
  })
})

const asProps = (props: Record<string, unknown>): ComponentProps<typeof MobileNativeChatShellConfirmView> =>
  props as unknown as ComponentProps<typeof MobileNativeChatShellConfirmView>

describe('the wrapper around the chat view', () => {
  it('renders the chat view once, with every prop it was handed except the two sends it guards', () => {
    const handed = {
      agent: 'claude',
      messages: [{ id: 'm' }],
      status: 'ready',
      composerText: 'draft',
      sendSurfaceId: 'surface-1',
      keyboardInset: 12,
      queuedMessages: ['a', 'b'],
      onStop: vi.fn(),
      onLoadEarlier: vi.fn(),
      reportBackgroundTaskFailure: vi.fn()
    }
    const views: Record<string, unknown>[] = []
    view.record = (props) => views.push(props)
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatShellConfirmView
            {...(asProps({ ...handed, onSend: vi.fn(), onAnswerQuestion: vi.fn() }))}
          />
        </ThemeProvider>
      )
    })

    expect(views).toHaveLength(1)
    for (const [key, value] of Object.entries(handed)) {
      expect(views[0]![key]).toBe(value)
    }
    expect(typeof views[0]!.onSend).toBe('function')
    expect(typeof views[0]!.onAnswerQuestion).toBe('function')
    expect(views[0]!.onSend).not.toBe(undefined)
    view.record = null
  })

  it('hands the view the same props on a re-render: nothing is added, dropped or renamed', () => {
    const views: Record<string, unknown>[] = []
    view.record = (props) => views.push(props)
    const element = (extra: Record<string, unknown>) => (
      <ThemeProvider initialPreference="light">
        <MobileNativeChatShellConfirmView {...asProps({ agent: 'codex', onSend: vi.fn(), ...extra })} />
      </ThemeProvider>
    )
    act(() => {
      renderer = create(element({ composerText: 'one' }))
    })
    act(() => renderer!.update(element({ composerText: 'two' })))
    expect(views.map((props) => props.composerText)).toEqual(['one', 'two'])
    expect(Object.keys(views[0]!).sort()).toEqual(Object.keys(views[1]!).sort())
    view.record = null
  })
})

describe('the chat view as the overlay mounts it', () => {
  const mount = (
    agent: string,
    onSend: (text: string) => Promise<boolean>,
    report = vi.fn(),
    onAnswerQuestion?: (text: string) => Promise<boolean>,
    extra: Record<string, unknown> = {}
  ) => {
    const props = { agent, onSend, onAnswerQuestion, reportBackgroundTaskFailure: report, ...extra } as unknown as ComponentProps<
      typeof MobileNativeChatShellConfirmView
    >
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatShellConfirmView {...props} />
        </ThemeProvider>
      )
    })
    return report
  }
  const sendFromView = (text: string): Promise<boolean> =>
    (view.props!.onSend as (text: string) => Promise<boolean>)(text)

  it('gives the view a send that does not reach the base send until Run', async () => {
    const onSend = vi.fn(async () => true)
    mount('claude', onSend)

    await act(async () => {
      void sendFromView('!ls')
    })
    await flushLazy()
    expect(onSend).not.toHaveBeenCalled()

    const run = renderer!.root.find(
      (node) => node.props.accessibilityLabel === 'Run' && typeof node.props.onPress === 'function'
    )
    await act(async () => {
      run.props.onPress()
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith('!ls')
  })

  it('passes a plain message straight to the base send', async () => {
    const onSend = vi.fn(async () => true)
    mount('claude', onSend)
    await act(async () => {
      void sendFromView('fix it')
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith('fix it')
  })

  it('says a bare ! on the overlay\'s own failure line', async () => {
    const onSend = vi.fn(async () => true)
    const report = mount('claude', onSend)
    await act(async () => {
      void sendFromView('!')
    })
    expect(onSend).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(1)
  })
  // A plain-text question's answer is typed into the composer and submitted, the same door.
  it('asks before a free-text answer that starts with ! is typed too', async () => {
    const onAnswerQuestion = vi.fn(async () => true)
    mount('claude', vi.fn(async () => true), vi.fn(), onAnswerQuestion)

    await act(async () => {
      void (view.props!.onAnswerQuestion as (text: string) => Promise<boolean>)('!rm -rf build')
    })
    await flushLazy()
    expect(onAnswerQuestion).not.toHaveBeenCalled()

    const run = renderer!.root.find(
      (node) => node.props.accessibilityLabel === 'Run' && typeof node.props.onPress === 'function'
    )
    await act(async () => {
      run.props.onPress()
    })
    expect(onAnswerQuestion).toHaveBeenCalledExactlyOnceWith('!rm -rf build')
  })

  it('passes an ordinary answer straight through, and hands the view none when there was none', async () => {
    const onAnswerQuestion = vi.fn(async () => true)
    mount('claude', vi.fn(async () => true), vi.fn(), onAnswerQuestion)
    await act(async () => {
      void (view.props!.onAnswerQuestion as (text: string) => Promise<boolean>)('yes')
    })
    expect(onAnswerQuestion).toHaveBeenCalledExactlyOnceWith('yes')

    act(() => renderer?.unmount())
    mount('claude', vi.fn(async () => true))
    expect(view.props!.onAnswerQuestion).toBeUndefined()
  })

  // The question belongs where `!` actually reaches an EMPTY agent input. A structured session's
  // sends go to the API, not a PTY; a send with a photo pastes the picture first, so the input
  // is not empty when the text arrives and the `!` is no switch.
  it('does not ask on a structured session, whose sends are not typed into a terminal', async () => {
    const onSend = vi.fn(async () => true)
    mount('claude', onSend, vi.fn(), undefined, { structuredActivityUi: true })
    await act(async () => {
      void sendFromView('!ls')
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith('!ls')
  })

  it.each([
    ['a photo', [{ id: 'p', uri: 'file:///a.jpg' }]],
    ['a pending file', [{ id: 'f', uri: 'file:///a.pdf', kind: 'file' }]]
  ])('does not ask when the send carries %s: the input is not empty when the text arrives', async (_name, attachments) => {
    const onSend = vi.fn(async () => true)
    mount('claude', onSend, vi.fn(), undefined, { attachments })
    await act(async () => {
      void sendFromView('!look at this')
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith('!look at this')
  })

  it('asks again once the attachments are gone, and with none attached at all', async () => {
    const onSend = vi.fn(async () => true)
    mount('claude', onSend, vi.fn(), undefined, { attachments: [] })
    await act(async () => {
      void sendFromView('!ls')
    })
    await flushLazy()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not ask for a structured session\'s answer either', async () => {
    const onAnswerQuestion = vi.fn(async () => true)
    mount('claude', vi.fn(async () => true), vi.fn(), onAnswerQuestion, { structuredActivityUi: true })
    await act(async () => {
      void (view.props!.onAnswerQuestion as (text: string) => Promise<boolean>)('!ls')
    })
    expect(onAnswerQuestion).toHaveBeenCalledExactlyOnceWith('!ls')
  })

})
