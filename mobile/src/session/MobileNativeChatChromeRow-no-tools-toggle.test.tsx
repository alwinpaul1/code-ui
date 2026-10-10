import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../theme/theme-context'
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import { makeChatViewStyles } from './mobile-native-chat-view-styles'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('./MobileNativeChatStatusLine', () => ({
  MobileNativeChatStatusLine: 'MobileNativeChatStatusLine'
}))
vi.mock('lucide-react-native', () => ({ Square: 'Square' }))

// 2026-10-10, the user: "remove the Tools from here and add as a toggle like
// turn on or turn off, like the Wrap long lines toggle." Expanding tool calls
// is a Settings switch now (Chat UI -> Expand tool calls); the row above the
// composer keeps the status line and Stop, and nothing else.

function Row({ agentWorking }: { agentWorking: boolean }) {
  const theme = useTheme()
  return createElement(MobileNativeChatChromeRow, {
    agentWorking,
    styles: makeChatViewStyles(theme)
  })
}

// The renderer's host elements are string tags here (react-native is mocked).
function hostsOf(renderer: ReactTestRenderer, tag: string): ReactTestInstance[] {
  return renderer.root.findAll((node) => (node.type as unknown) === tag)
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return hostsOf(renderer, 'Text').flatMap((node) => [node.props.children].flat().map(String))
}

describe('the chrome row above the composer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(scheme: 'light' | 'dark', agentWorking: boolean): ReactTestRenderer {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Row agentWorking={agentWorking} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  for (const scheme of ['light', 'dark'] as const) {
    for (const agentWorking of [false, true]) {
      it(`draws no Tools or Collapse control (${scheme}, ${agentWorking ? 'working' : 'idle'})`, () => {
        const tree = render(scheme, agentWorking)
        const labels = hostsOf(tree, 'Pressable')
          .map((node) => String(node.props.accessibilityLabel ?? ''))
        expect(labels.filter((label) => /tool calls/i.test(label))).toEqual([])
        expect(textsOf(tree)).not.toContain('Tools')
        expect(textsOf(tree)).not.toContain('Collapse')
      })
    }

    it(`takes no height of its own when there is nothing to show (${scheme})`, () => {
      // The Tools row used to hold the band open at 30dp. With it gone, an idle
      // row with no Stop and no status line must collapse to nothing, so the
      // composer sits where that row was. A minHeight or fixed height here
      // would leave an empty band over the glass composer.
      const tree = render(scheme, false)
      const row = hostsOf(tree, 'View').find((node) => node.props.pointerEvents === 'box-none')
      const style = Object.assign({}, ...[row?.props.style].flat())
      expect(style.minHeight).toBeUndefined()
      expect(style.height).toBeUndefined()
      expect(hostsOf(tree, 'Pressable')).toHaveLength(0)
    })
  }
})
