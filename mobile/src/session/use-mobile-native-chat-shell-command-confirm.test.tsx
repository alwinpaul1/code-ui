// A chat message that starts with `!` runs as a shell command on the desktop
// (mobile-native-chat-shell-command.ts says how it was read), so the phone asks
// before anything is written: Run sends it, Cancel writes nothing and the draft
// stays where it is. User's decision, 2026-10-02: "Run it, but confirm first."

import { createElement } from 'react'
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

import { ThemeProvider } from '../theme/theme-context'
import {
  SHELL_COMMAND_EMPTY_NOTICE,
  useMobileNativeChatShellCommandConfirm
} from './use-mobile-native-chat-shell-command-confirm'

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
let api: ReturnType<typeof useMobileNativeChatShellCommandConfirm>

function mount(agent: string | null, send: (text: string) => Promise<boolean>, report = vi.fn()) {
  function Probe() {
    api = useMobileNativeChatShellCommandConfirm(agent, send, report)
    return createElement('View', null, api.confirm)
  }
  act(() => {
    renderer = create(createElement(ThemeProvider, { initialPreference: 'light' }, createElement(Probe)))
  })
  return report
}

const texts = (): string[] =>
  renderer!.root
    .findAllByType('Text' as never)
    .map((node) => String(node.props.children))
const press = async (label: string) => {
  const button = renderer!.root.find(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  )
  await act(async () => {
    button.props.onPress()
  })
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('a message that starts with ! from the chat', () => {
  it('asks before anything is sent, and shows the command', async () => {
    const send = vi.fn(async () => true)
    mount('claude', send)
    let outcome: boolean | null = null
    await act(async () => {
      void api.send('!ls -la').then((accepted) => (outcome = accepted))
    })
    await flushLazy()

    expect(send).not.toHaveBeenCalled()
    expect(outcome).toBeNull()
    expect(texts().some((text) => text.includes('ls -la'))).toBe(true)
    expect(texts()).toContain('Run on the desktop?')
  })

  it('sends the message exactly as typed once the user taps Run, and says what the send said', async () => {
    const send = vi.fn(async () => true)
    mount('claude', send)
    let outcome: boolean | null = null
    await act(async () => {
      void api.send('!ls -la').then((accepted) => (outcome = accepted))
    })
    await flushLazy()

    await press('Run')

    expect(send).toHaveBeenCalledExactlyOnceWith('!ls -la')
    expect(outcome).toBe(true)
    expect(texts()).not.toContain('Run on the desktop?')
  })

  it('hands back a rejected send as rejected', async () => {
    const send = vi.fn(async () => false)
    mount('claude', send)
    let outcome: boolean | null = null
    await act(async () => {
      void api.send('!ls').then((accepted) => (outcome = accepted))
    })
    await flushLazy()
    await press('Run')
    expect(outcome).toBe(false)
  })

  it('writes nothing on Cancel, and the send comes back false so the draft stays', async () => {
    const send = vi.fn(async () => true)
    const report = mount('claude', send)
    let outcome: boolean | null = null
    await act(async () => {
      void api.send('!rm -rf build').then((accepted) => (outcome = accepted))
    })
    await flushLazy()

    await press('Cancel')

    expect(send).not.toHaveBeenCalled()
    expect(outcome).toBe(false)
    expect(report).not.toHaveBeenCalled()
    expect(texts()).not.toContain('Run on the desktop?')
  })

  it('writes nothing when the sheet is dismissed away from its buttons', async () => {
    const send = vi.fn(async () => true)
    mount('claude', send)
    let outcome: boolean | null = null
    await act(async () => {
      void api.send('!ls').then((accepted) => (outcome = accepted))
    })
    await flushLazy()
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {})
    expect(send).not.toHaveBeenCalled()
    expect(outcome).toBe(false)
  })

  it('sends a message with no leading ! straight through, with no question', async () => {
    const send = vi.fn(async () => true)
    mount('claude', send)
    let outcome: boolean | null = null
    await act(async () => {
      void api.send('fix the build!').then((accepted) => (outcome = accepted))
    })
    expect(send).toHaveBeenCalledExactlyOnceWith('fix the build!')
    expect(outcome).toBe(true)
    expect(texts()).not.toContain('Run on the desktop?')
  })

  it('sends a message with a leading space straight through: the agent keeps the space and it is no switch', async () => {
    const send = vi.fn(async () => true)
    mount('claude', send)
    await act(async () => {
      void api.send(' !ls')
    })
    expect(send).toHaveBeenCalledExactlyOnceWith(' !ls')
  })

  it('refuses a bare ! and says why: it would leave the desktop in shell mode with nothing to run', async () => {
    const send = vi.fn(async () => true)
    const report = mount('claude', send)
    let outcome: boolean | null = null
    await act(async () => {
      void api.send('!').then((accepted) => (outcome = accepted))
    })

    expect(send).not.toHaveBeenCalled()
    expect(outcome).toBe(false)
    expect(report).toHaveBeenCalledExactlyOnceWith(SHELL_COMMAND_EMPTY_NOTICE)
    expect(texts()).not.toContain('Run on the desktop?')
    expect(SHELL_COMMAND_EMPTY_NOTICE).toBe('Type a command after ! to run it on the desktop.')
  })

  it('asks for a Codex tab too: its binary has the same door', async () => {
    const send = vi.fn(async () => true)
    mount('codex', send)
    await act(async () => {
      void api.send('!ls')
    })
    await flushLazy()
    expect(send).not.toHaveBeenCalled()
    expect(texts()).toContain('Run on the desktop?')
  })

  it('leaves an agent that is neither alone', async () => {
    const send = vi.fn(async () => true)
    mount('omp', send)
    await act(async () => {
      void api.send('!ls')
    })
    expect(send).toHaveBeenCalledExactlyOnceWith('!ls')
  })

  it('shows a long command cut, and the whole of it is still what is sent', async () => {
    const send = vi.fn(async () => true)
    mount('claude', send)
    const long = `!${'x'.repeat(2000)}`
    await act(async () => {
      void api.send(long)
    })
    await flushLazy()
    const shown = texts().find((text) => text.includes('xxx')) ?? ''
    expect(shown.length).toBeLessThan(700)
    await press('Run')
    expect(send).toHaveBeenCalledExactlyOnceWith(long)
  })
})
