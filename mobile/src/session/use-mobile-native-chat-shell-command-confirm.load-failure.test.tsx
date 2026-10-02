// The question before a `!` message runs is loaded the first time one is sent
// (use-mobile-native-chat-shell-command-confirm.tsx). If that load fails (a bundle chunk that
// will not load), React.lazy threw the rejection at render time and took the whole screen to the
// root error boundary. Now the send is refused with a message: nothing is written and the draft
// stays in the composer.

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
vi.mock('./ShellCommandQuestion', () => {
  throw new Error('Loading chunk ShellCommandQuestion failed.')
})

import {
  SHELL_COMMAND_QUESTION_FAILED,
  useMobileNativeChatShellCommandConfirm
} from './use-mobile-native-chat-shell-command-confirm'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function mount(send: (text: string) => Promise<boolean>, report: (message: string) => void) {
  let api!: ReturnType<typeof useMobileNativeChatShellCommandConfirm>
  function Probe() {
    api = useMobileNativeChatShellCommandConfirm('claude', send, report)
    return createElement('View', null, api.confirm)
  }
  act(() => {
    renderer = create(createElement(Probe))
  })
  return () => api
}

describe('a `!` message whose question cannot be loaded', () => {
  it('is refused with a message, writes nothing, and the screen stays up', async () => {
    const send = vi.fn(async () => true)
    const report = vi.fn()
    const api = mount(send, report)

    let outcome: boolean | null = null
    await act(async () => {
      outcome = await api().send('!rm -rf build')
    })

    expect(outcome).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledExactlyOnceWith(SHELL_COMMAND_QUESTION_FAILED)
    expect(SHELL_COMMAND_QUESTION_FAILED).toBe(
      'Could not open the question, so the command was not sent. Try again.'
    )
    // Nothing threw into the render: the tree is still mounted and shows nothing.
    expect(renderer!.toJSON()).not.toBeNull()
  })

  it('does not touch an ordinary message', async () => {
    const send = vi.fn(async () => true)
    const api = mount(send, vi.fn())
    await act(async () => {
      await api().send('fix the build')
    })
    expect(send).toHaveBeenCalledExactlyOnceWith('fix the build')
  })

  it('says nothing when there is no reporter, and still refuses', async () => {
    const send = vi.fn(async () => true)
    let api!: ReturnType<typeof useMobileNativeChatShellCommandConfirm>
    function Probe() {
      api = useMobileNativeChatShellCommandConfirm('claude', send)
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    let outcome: boolean | null = null
    await act(async () => {
      outcome = await api.send('!ls')
    })
    expect(outcome).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
