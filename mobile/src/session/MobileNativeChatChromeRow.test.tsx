import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import type { ChatViewStyles } from './mobile-native-chat-view-styles'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
// The status line breathes through Animated; the row under test only needs
// to know whether it rendered.
vi.mock('./MobileNativeChatStatusLine', () => ({
  MobileNativeChatStatusLine: 'MobileNativeChatStatusLine'
}))
vi.mock('lucide-react-native', () => ({
  Square: 'Square'
}))

const styles = {
  chromeRow: {},
  chromeLeft: {},
  pressed: {},
  sendError: {}
} as unknown as ChatViewStyles

// Stop moved into the composer's send slot, where the Claude app keeps it
// (MobileNativeChatComposer.stop-in-send-slot.test.tsx). A second Stop left on
// the status line ("Working · 2 running tasks … Stop") is what this pins out.
describe('the status line above the composer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['light', 'dark'] as const)('draws no Stop of its own while the agent works (%s)', (scheme) => {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileNativeChatChromeRow, {
            agentWorking: true,
            // What the row used to take for its Stop; ignored now.
            ...({ canStop: true, onStop: vi.fn() } as Record<string, unknown>),
            styles
          })
        )
      )
    })
    expect(renderer!.root.findAllByType('Pressable' as never)).toHaveLength(0)
    expect(renderer!.root.findAllByType('MobileNativeChatStatusLine' as never)).toHaveLength(1)
  })
})
