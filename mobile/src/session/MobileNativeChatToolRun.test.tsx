import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'

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
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
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

function Harness({
  blocks,
  activeTurnIsWorking,
  defaultExpanded = false,
  expandChildren
}: {
  blocks: NativeChatBlock[]
  activeTurnIsWorking?: boolean
  defaultExpanded?: boolean
  expandChildren?: boolean
}): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, {
    blocks,
    defaultExpanded,
    expandChildren,
    activeCall:
      activeTurnIsWorking === undefined
        ? null
        : selectActiveToolCall(blocks, { activeTurnIsWorking }),
    styles
  })
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

  // 2026-09-12: the fold reads as the Claude app writes it — one sentence
  // about what the tools did, not the agent's tool names and arguments.
  it('reads as one sentence about what the tools did', () => {
    expect(render(LONG_RUN).texts).toContain('Ran a command, read 2 files, edited 2 files')
  })

  it('does not name a tool or its argument in the collapsed row', () => {
    const { texts } = render(PUNCTUATED_RUN)
    expect(texts.join(' ')).not.toContain('browser.open')
    expect(texts.join(' ')).not.toContain('README.md')
    // `tools/read` reads; `browser.open` is a tool with no plain-English verb.
    expect(texts).toContain('Read a file, used a tool')
  })

  it('falls back to a plain call count when no call has a name', () => {
    const nameless: NativeChatBlock[] = [{ type: 'tool-call', name: '', input: {} }]
    expect(render(nameless).texts).toContain('Used a tool')
  })
})

// A live turn: a `shell` call still running, and one already settled behind it.
const LIVE_SHELL_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' }, state: 'completed' },
  { type: 'tool-result', output: 'ok' },
  { type: 'tool-call', name: 'shell', input: { command: 'pnpm test' }, state: 'running' }
]
// Codex's classified shell row: the word is `read`, but it really ran a command.
const LIVE_CLASSIFIED_RUN: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'read',
    input: { command: 'cat src/app.ts', path: 'src/app.ts' },
    state: 'running'
  }
]
// Claude's `Read` shares that word and ran no command at all.
const LIVE_CLAUDE_READ_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Read', input: { file_path: 'src/app.ts' }, state: 'running' }
]

describe('a tool run while the turn is still working', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    props: Parameters<typeof Harness>[0],
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: scheme }, createElement(Harness, props))
      )
    })
    return renderer!
  }

  function texts(tree: ReactTestRenderer): string[] {
    // `{callCount}×` arrives as `[2, '×']`, so join primitive children rather
    // than only taking the ones that are already a single string.
    return tree.root.findAllByType('Text').map((node) => {
      const children = node.props.children
      return (Array.isArray(children) ? children : [children])
        .filter((child) => typeof child === 'string' || typeof child === 'number')
        .join('')
    })
  }

  function activeLabelColor(tree: ReactTestRenderer): string | undefined {
    const label = tree.root.findAll((node) => node.props?.testID === 'tool-run-active-label')[0]
    return flattenColor(label?.props.style)
  }

  it('names the call that is still running instead of counting the settled ones', () => {
    const tree = render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
    expect(texts(tree)).toContain('Running')
    // The batch sentence is what the live row replaces.
    expect(texts(tree).some((text) => text.startsWith('Ran '))).toBe(false)
  })

  it('goes back to the batch summary the moment the turn settles', () => {
    const tree = render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: false })
    expect(texts(tree).some((text) => text.startsWith('Ran '))).toBe(true)
    expect(texts(tree).some((text) => text.startsWith('Running'))).toBe(false)
  })

  it('gives a Codex row that really ran a command the terminal glyph', () => {
    const tree = render({ blocks: LIVE_CLASSIFIED_RUN, activeTurnIsWorking: true })
    expect(tree.root.findAllByType('SquareTerminal')).toHaveLength(1)
    expect(tree.root.findAllByType('Wrench')).toHaveLength(0)
  })

  it("does not claim a shell ran for Claude's Read, which shares the word", () => {
    const tree = render({ blocks: LIVE_CLAUDE_READ_RUN, activeTurnIsWorking: true })
    expect(tree.root.findAllByType('Wrench')).toHaveLength(1)
    expect(tree.root.findAllByType('SquareTerminal')).toHaveLength(0)
  })

  it('keeps the running label on the theme, in light and in dark', () => {
    const lightColor = activeLabelColor(
      render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true })
    )
    act(() => renderer?.unmount())
    renderer = null
    const darkColor = activeLabelColor(
      render({ blocks: LIVE_SHELL_RUN, activeTurnIsWorking: true }, 'dark')
    )
    expect(lightColor).toBe(lightColors.textSecondary)
    expect(darkColor).toBe(darkColors.textSecondary)
    expect(darkColor).not.toBe(lightColor)
  })

  it('leaves the child rows shut when the turn caret is what opened the run', () => {
    const tree = render({ blocks: LIVE_SHELL_RUN, defaultExpanded: true, expandChildren: false })
    // The run body is open — the settled call's row is on screen — but the row
    // itself has not disclosed its result.
    expect(texts(tree)).toContain('a.ts')
    expect(texts(tree)).not.toContain('ok')
  })
})
