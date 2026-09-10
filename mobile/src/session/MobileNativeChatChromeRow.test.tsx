import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
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
// The indicator animates through reanimated's native module; the row under
// test only needs to know whether it rendered.
vi.mock('./MobileAgentWorkingIndicator', () => ({
  MobileAgentWorkingIndicator: 'MobileAgentWorkingIndicator'
}))
vi.mock('lucide-react-native', () => ({
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Square: 'Square'
}))

const styles = {
  chromeRow: {},
  chromeLeft: {},
  chromeToggle: {},
  pressed: {},
  stopButton: {},
  sendError: {}
} as unknown as ChatViewStyles

function stopButton(renderer: ReactTestRenderer): unknown {
  return renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === 'Stop the agent')
}

function colorsOf(renderer: ReactTestRenderer): string[] {
  const found: string[] = []
  for (const node of renderer.root.findAllByType('Text')) {
    const style = node.props.style
    for (const entry of Array.isArray(style) ? style : [style]) {
      if (entry && typeof entry === 'object' && typeof entry.color === 'string') {
        found.push(entry.color)
      }
    }
  }
  return found
}

describe('the Stop button above the composer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    props: { agentWorking?: boolean; canStop?: boolean },
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileNativeChatChromeRow, {
            ...props,
            toolsExpanded: false,
            onToggleTools: () => {},
            styles
          })
        )
      )
    })
    return renderer!
  }

  it('stays away while the agent is working but has no turn to interrupt', () => {
    // The structured lane says "working" from the journalled send, seconds
    // before the provider opens a turn. Orca #19822.
    expect(stopButton(render({ agentWorking: true, canStop: false }))).toBeUndefined()
  })

  it('appears as soon as there is a turn to interrupt', () => {
    expect(stopButton(render({ agentWorking: true, canStop: true }))).toBeDefined()
  })

  it('follows the working flag when the caller says nothing about stopping', () => {
    // The bridge lane passes no `canStop`, and must keep the button it had.
    expect(stopButton(render({ agentWorking: true }))).toBeDefined()
    act(() => renderer?.unmount())
    renderer = null
    expect(stopButton(render({ agentWorking: false }))).toBeUndefined()
  })

  it('paints Stop in the danger tone of whichever theme is on', () => {
    expect(colorsOf(render({ agentWorking: true, canStop: true }, 'light'))).toContain(
      lightColors.danger
    )
    act(() => renderer?.unmount())
    renderer = null
    expect(colorsOf(render({ agentWorking: true, canStop: true }, 'dark'))).toContain(
      darkColors.danger
    )
  })
})
