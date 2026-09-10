import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  SquareChevronRight: 'SquareChevronRight'
}))

// Two names that each carry the character a joined summary uses to separate
// members. Upstream #19372: `browser.open · tools/read` is unreadable as two
// calls, because the punctuation inside a name looks exactly like the one
// between names.
const PUNCTUATED_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'browser.open', input: { url: 'https://example.com' } },
  { type: 'tool-call', name: 'tools/read', input: { file_path: 'README.md' } }
]

const LONG_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
  { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
  { type: 'tool-call', name: 'Edit', input: { file_path: 'b.ts' } },
  { type: 'tool-call', name: 'Write', input: { file_path: 'c.ts' } },
  { type: 'tool-call', name: 'Read', input: { file_path: 'd.ts' } }
]

function Harness({ blocks }: { blocks: NativeChatBlock[] }): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded: false, styles })
}

type Rendered = { members: { name: string; color: string | undefined }[]; texts: string[] }

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  for (const node of renderer.root.findAllByType('Text')) {
    if (typeof node.props.children === 'string') {
      texts.push(node.props.children)
    }
  }
  const members = renderer.root
    .findAll((node) => node.props?.testID === 'tool-run-member-name')
    .map((node) => ({
      name: String(node.props.children),
      color: flattenColor(node.props.style)
    }))
  return { members, texts }
}

function flattenColor(style: unknown): string | undefined {
  const entries = Array.isArray(style) ? style : [style]
  for (const entry of entries) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { color?: unknown }).color === 'string'
    ) {
      return (entry as { color: string }).color
    }
  }
  return undefined
}

describe('a batch of tool calls in one run header', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(blocks: NativeChatBlock[], scheme: 'light' | 'dark' = 'light'): Rendered {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(Harness, { blocks })
        )
      )
    })
    return readTree(renderer!)
  }

  it('reads as two calls, not as one run of "browser.open · tools/read"', () => {
    const { members } = render(PUNCTUATED_RUN)
    expect(members.map((member) => member.name)).toEqual(['browser.open', 'tools/read'])
  })

  it('says how many calls the header could not name', () => {
    // Five calls; the header names three, so two are unaccounted for.
    expect(render(LONG_RUN).texts).toContain('+2 more')
  })

  it('leaves the count off a run the header names in full', () => {
    expect(render(PUNCTUATED_RUN).texts.join(' ')).not.toContain('more')
  })

  it('marks each member off from the next in light and in dark', () => {
    const light = render(PUNCTUATED_RUN, 'light')
    expect(light.members.map((member) => member.color)).toEqual([
      lightColors.text,
      lightColors.text
    ])
    act(() => renderer?.unmount())
    renderer = null
    const dark = render(PUNCTUATED_RUN, 'dark')
    expect(dark.members.map((member) => member.color)).toEqual([darkColors.text, darkColors.text])
    expect(darkColors.text).not.toBe(lightColors.text)
  })

  it('falls back to a plain call count when no call has a name', () => {
    const nameless: NativeChatBlock[] = [{ type: 'tool-call', name: '  ', input: {} }]
    expect(render(nameless).texts).toContain('1 tool call')
  })
})
