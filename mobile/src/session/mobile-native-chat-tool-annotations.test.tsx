// Orca #19226 (d0506bf5d) on the phone. Before this, a tool row said only its
// name: an MCP call read as the `mcp__linear__list_issues` token the provider
// transports it under, a shell row that exited non-zero looked exactly like one
// that succeeded, and a web search's own results were buried in its raw output.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'

const openURL = vi.fn(async () => true)

vi.mock('react-native', () => ({
  Animated: {
    Text: 'Text',
    Value: class {
      constructor(private value: number) {}
      setValue(next: number): void {
        this.value = next
      }
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Linking: { openURL: (url: string) => openURL(url) },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))

const MCP_CALL: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'mcp__linear__list_issues',
    input: { team: 'core' },
    state: 'completed'
  },
  { type: 'tool-result', output: '3 issues' }
]

// A provider that names its own MCP call without the reserved prefix. Only the
// stated identity proves it is MCP — a slash in a name does not.
const MCP_CALL_BY_IDENTITY: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'linear/list_issues',
    input: { team: 'core' },
    mcpIdentity: { server: 'linear', tool: 'list_issues' },
    state: 'completed'
  }
]

const FAILED_SHELL: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'shell',
    input: { command: 'pnpm test' },
    exitCode: 1,
    durationMs: 2400,
    state: 'completed'
  },
  { type: 'tool-result', output: '1 failing' }
]

const CLEAN_SHELL: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'shell',
    input: { command: 'pnpm test' },
    exitCode: 0,
    durationMs: 120,
    state: 'completed'
  }
]

const WEB_SEARCH: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'web_search',
    input: { query: 'expo router' },
    webSearchResults: [
      { title: 'Expo Router', url: 'https://docs.expo.dev/router/' },
      { title: '', url: 'https://expo.dev/blog' }
    ],
    state: 'completed'
  }
]

function Harness({ blocks }: { blocks: NativeChatBlock[] }): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded: true, activeCall: null, styles })
}

function styleValue(style: unknown, key: string): string | undefined {
  const entries = Array.isArray(style) ? style.flat(3) : [style]
  let found: string | undefined
  for (const entry of entries) {
    const value = (entry as Record<string, unknown> | null | undefined)?.[key]
    if (typeof value === 'string') {
      found = value
    }
  }
  return found
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((node) => node.props?.testID === testID)
}

function textsFor(renderer: ReactTestRenderer, testID: string): string[] {
  return byTestId(renderer, testID).map((node) => String(node.props.children))
}

describe('what a tool row says about how it ran', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    openURL.mockClear()
  })

  function render(
    blocks: NativeChatBlock[],
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(Harness, { blocks })
        )
      )
    })
    return renderer!
  }

  it('names an MCP call by its server and tool, not by its transport token', () => {
    const tree = render(MCP_CALL)
    expect(textsFor(tree, 'tool-mcp-server')).toEqual(['Linear'])
    expect(textsFor(tree, 'tool-mcp-tool')).toEqual(['list issues'])
  })

  it('takes the provider at its word when the name carries no MCP prefix', () => {
    const tree = render(MCP_CALL_BY_IDENTITY)
    expect(textsFor(tree, 'tool-mcp-server')).toEqual(['Linear'])
  })

  it('says a shell row failed, and how long it took', () => {
    const tree = render(FAILED_SHELL)
    expect(textsFor(tree, 'tool-exit-code')).toEqual(['exit 1'])
    // `formatNativeChatDuration` rounds to whole seconds above a second.
    expect(textsFor(tree, 'tool-duration')).toEqual(['2s'])
  })

  it('shows nothing extra on a row the provider reported nothing about', () => {
    const tree = render(MCP_CALL)
    expect(byTestId(tree, 'tool-exit-code')).toEqual([])
    expect(byTestId(tree, 'tool-duration')).toEqual([])
  })

  it('lists the pages a web search returned, and opens one when tapped', () => {
    const tree = render(WEB_SEARCH)
    // The second hit has no title, so it stands under its own URL.
    expect(textsFor(tree, 'tool-search-title')).toEqual(['Expo Router', 'https://expo.dev/blog'])
    act(() => {
      byTestId(tree, 'tool-search-title')[0]!.parent!.props.onPress()
    })
    expect(openURL).toHaveBeenCalledWith('https://docs.expo.dev/router/')
  })

  it('marks a failing exit code apart from a clean one, in light and in dark', () => {
    const failedLight = styleValue(
      byTestId(render(FAILED_SHELL), 'tool-exit-code')[0]!.props.style,
      'color'
    )
    const cleanLight = styleValue(
      byTestId(render(CLEAN_SHELL), 'tool-exit-code')[0]!.props.style,
      'color'
    )
    act(() => renderer?.unmount())
    renderer = null
    const failedDark = styleValue(
      byTestId(render(FAILED_SHELL, 'dark'), 'tool-exit-code')[0]!.props.style,
      'color'
    )
    expect(failedLight).toBe(lightColors.danger)
    expect(cleanLight).toBe(lightColors.textMuted)
    expect(failedDark).toBe(darkColors.danger)
    expect(failedLight).not.toBe(failedDark)
  })
})
