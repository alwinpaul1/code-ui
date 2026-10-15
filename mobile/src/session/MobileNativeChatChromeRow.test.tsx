import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import { holdSendErrorRetry, resetSendErrorRetryForTests } from './native-chat-send-error-retry'
import type { ChatViewStyles } from './mobile-native-chat-view-styles'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Square: 'Square'
}))

const styles = {
  pressed: {},
  sendError: {}
} as unknown as ChatViewStyles

// Stop moved into the composer's send slot, where the Claude app keeps it
// (MobileNativeChatComposer.stop-in-send-slot.test.tsx). A second Stop left on
// the status line ("Working · 2 running tasks … Stop") is what this pins out.
// The working line itself left this row on 2026-10-15: it is the transcript's last row, as in
// the Claude app (MobileNativeChatView-status-line.test.ts), so nothing is drawn here for it.
describe('the chrome above the composer while the agent works', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['light', 'dark'] as const)('draws no Stop and no working line of its own (%s)', (scheme) => {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileNativeChatChromeRow, {
            // What the row used to take for its Stop and its working line; ignored now.
            ...({ agentWorking: true, canStop: true, onStop: vi.fn() } as Record<string, unknown>),
            styles
          })
        )
      )
    })
    expect(renderer!.root.findAllByType('Pressable' as never)).toHaveLength(0)
    expect(renderer!.toJSON()).toBeNull()
  })
})

// S5: a send refused before anything was written, its words back in the composer, offers Retry,
// as the Claude app's snackbar does. Only that failure: a later one without it never inherits it.
describe('the send-failure banner’s Retry', () => {
  let renderer: ReactTestRenderer | null = null
  const MESSAGE = 'Message not sent: not connected to your desktop'

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetSendErrorRetryForTests()
  })

  function render(message: string, onRetrySend: () => void, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileNativeChatChromeRow, { sendErrorMessage: message, onRetrySend, styles })
        )
      )
    })
    return renderer!
  }

  const retryButton = (tree: ReactTestRenderer) =>
    tree.root.findAllByType('Pressable').find((node) => node.props.accessibilityLabel === 'Retry sending the message')

  it('offers Retry for the failure that asked for it, and sends again when tapped', () => {
    const onRetrySend = vi.fn()
    holdSendErrorRetry(MESSAGE, true)
    const button = retryButton(render(MESSAGE, onRetrySend))
    expect(button).toBeDefined()
    act(() => button!.props.onPress())
    expect(onRetrySend).toHaveBeenCalledTimes(1)
  })

  it('offers none for a failure that did not ask for it', () => {
    holdSendErrorRetry(MESSAGE, true)
    expect(retryButton(render('Delivery unconfirmed — check chat before retrying', vi.fn()))).toBeUndefined()
    holdSendErrorRetry('Message not sent (session changed)', false)
    expect(retryButton(render('Message not sent (session changed)', vi.fn()))).toBeUndefined()
  })

  it('paints Retry in the danger tone of whichever theme is on', () => {
    holdSendErrorRetry(MESSAGE, true)
    const retryColors = (tree: ReactTestRenderer): string[] =>
      retryButton(tree)!
        .findAllByType('Text')
        .flatMap((node) => (Array.isArray(node.props.style) ? node.props.style : [node.props.style]))
        .flatMap((entry: unknown) =>
          entry && typeof entry === 'object' && typeof (entry as { color?: unknown }).color === 'string'
            ? [(entry as { color: string }).color]
            : []
        )
    expect(retryColors(render(MESSAGE, vi.fn(), 'light'))).toContain(lightColors.danger)
    expect(retryColors(render(MESSAGE, vi.fn(), 'dark'))).toContain(darkColors.danger)
  })
})
