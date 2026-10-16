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
import { SHELL_COMMAND_ATTACHMENTS_REFUSAL } from './mobile-native-chat-shell-command'

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
  // sends go to the API, not a PTY.
  it('does not ask on a structured session, whose sends are not typed into a terminal', async () => {
    const onSend = vi.fn(async () => true)
    mount('claude', onSend, vi.fn(), undefined, { structuredActivityUi: true })
    await act(async () => {
      void sendFromView('!ls')
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith('!ls')
  })

  // 2026-10-16: a `!` message with a screenshot reached Claude Code as "[Image #100]! node …", an
  // ordinary prompt, because the picture is pasted first and the `!` then lands in a box that is
  // not empty. Claude Code's bash mode takes only text, so the send is refused whole: the command,
  // the picture and the draft stay, and the line says how to run it. Codex pastes first too.
  it.each([
    ['claude', 'a photo', [{ id: 'p', uri: 'file:///a.jpg' }]],
    ['claude', 'a pending file', [{ id: 'f', uri: 'file:///a.pdf', kind: 'file' }]],
    ['codex', 'a photo', [{ id: 'p', uri: 'file:///a.jpg' }]]
  ])('%s: refuses a ! message that carries %s instead of sending the command to the model as text', async (agent, _name, attachments) => {
    const onSend = vi.fn(async () => true)
    const report = mount(agent, onSend, vi.fn(), undefined, { attachments })
    let outcome: boolean | null = null
    await act(async () => {
      void sendFromView('! node "/private/tmp/x/p19-dictation-cleanup.cjs"').then((accepted) => (outcome = accepted))
    })
    expect(onSend).not.toHaveBeenCalled()
    // false: the composer keeps the words, and the chips were never taken.
    expect(outcome).toBe(false)
    expect(report).toHaveBeenCalledExactlyOnceWith(SHELL_COMMAND_ATTACHMENTS_REFUSAL)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Run on the desktop?')
  })

  it('still sends a message with a picture whose words only start with a space before the !', async () => {
    const onSend = vi.fn(async () => true)
    mount('claude', onSend, vi.fn(), undefined, { attachments: [{ id: 'p', uri: 'file:///a.jpg' }] })
    await act(async () => {
      void sendFromView(' !look at this')
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith(' !look at this')
  })

  // The question was asked with no chip, and a pasted screenshot's chip landed while it was open:
  // Run then pasted the picture ahead of the command. Run reads the chips as they are when tapped.
  it('does not run the command when a picture is attached while the question is open', async () => {
    const onSend = vi.fn(async () => true)
    const report = vi.fn()
    const element = (attachments: unknown[]) => (
      <ThemeProvider initialPreference="light">
        <MobileNativeChatShellConfirmView
          {...(asProps({ agent: 'claude', onSend, reportBackgroundTaskFailure: report, attachments }))}
        />
      </ThemeProvider>
    )
    act(() => {
      renderer = create(element([]))
    })
    let outcome: boolean | null = null
    await act(async () => {
      void sendFromView('! node x.cjs').then((accepted) => (outcome = accepted))
    })
    await flushLazy()
    act(() => renderer!.update(element([{ id: 'p', uri: 'file:///shot.png' }])))

    const run = renderer!.root.find(
      (node) => node.props.accessibilityLabel === 'Run' && typeof node.props.onPress === 'function'
    )
    await act(async () => {
      run.props.onPress()
    })
    expect(onSend).not.toHaveBeenCalled()
    expect(outcome).toBe(false)
    expect(report).toHaveBeenCalledExactlyOnceWith(SHELL_COMMAND_ATTACHMENTS_REFUSAL)
  })

  it('keeps the command when the confirmed send itself fails', async () => {
    const onSend = vi.fn(async () => false)
    mount('claude', onSend, vi.fn(), undefined, { attachments: [] })
    let outcome: boolean | null = null
    await act(async () => {
      void sendFromView('!ls').then((accepted) => (outcome = accepted))
    })
    await flushLazy()
    const run = renderer!.root.find(
      (node) => node.props.accessibilityLabel === 'Run' && typeof node.props.onPress === 'function'
    )
    await act(async () => {
      run.props.onPress()
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith('!ls')
    expect(outcome).toBe(false)
  })

  // An answer is typed alone (answerQuestion pastes no chips), so the composer's pictures do not
  // make its `!` any less a shell command: it is asked about.
  it('asks before a ! answer while the composer holds a picture: the answer carries none', async () => {
    const onAnswerQuestion = vi.fn(async () => true)
    mount('claude', vi.fn(async () => true), vi.fn(), onAnswerQuestion, { attachments: [{ id: 'p', uri: 'file:///a.jpg' }] })
    await act(async () => {
      void (view.props!.onAnswerQuestion as (text: string) => Promise<boolean>)('!ls')
    })
    await flushLazy()
    expect(onAnswerQuestion).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer!.toJSON())).toContain('Run on the desktop?')
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
