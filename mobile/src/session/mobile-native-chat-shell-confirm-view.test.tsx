// The chat's own send is the one that asks about `!` messages: the overlay
// mounts the wrapper, and the wrapper hands the view a send that asks first.
// Structure test and a behaviour test, because a view mounted bare would pass
// every other test and run a `!` message with no question.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
const view = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('./MobileNativeChatView', () => ({
  MobileNativeChatView: (props: Record<string, unknown>) => {
    view.props = props
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

describe('the chat view as the overlay mounts it', () => {
  const mount = (agent: string, onSend: (text: string) => Promise<boolean>, report = vi.fn()) => {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileNativeChatShellConfirmView, {
            agent,
            onSend,
            reportBackgroundTaskFailure: report
          } as never)
        )
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
})
