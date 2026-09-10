// Orca #18765 (172aa1ac3) on the phone. Before this, an agent's file edit
// rendered as every removed line followed by every added line, with no
// interleaving, no file name and no line numbers — and a Codex `exec` that
// applied a patch rendered no diff at all.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
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
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))

// Claude reports an edit as a snippet pair: the text before and the text after,
// with nothing saying where in the file either one sits.
const CLAUDE_EDIT: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'Edit',
    input: {
      file_path: '/w/src/app.ts',
      old_string: 'const a = 1\nconst b = 2\nconst c = 3',
      new_string: 'const a = 1\nconst b = 9\nconst c = 3'
    },
    state: 'completed'
  },
  { type: 'tool-result', output: 'The file /w/src/app.ts has been updated.' }
]

// The same edit, with the resolved hunks the provider matched against the real
// file. These are the only ranges that can honestly number a row.
const CLAUDE_EDIT_WITH_PATCH: NativeChatBlock[] = [
  CLAUDE_EDIT[0]!,
  {
    type: 'tool-result',
    output: 'The file /w/src/app.ts has been updated.',
    editPatch: {
      filePath: '/w/src/app.ts',
      hunks: [
        {
          oldStart: 40,
          oldLines: 3,
          newStart: 40,
          newLines: 3,
          lines: [' const a = 1', '-const b = 2', '+const b = 9', ' const c = 3']
        }
      ]
    }
  }
]

// Codex applies a patch through its command tool: the envelope arrives inside
// one word of the argument vector the tool ran.
const CODEX_EXEC_PATCH: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'exec',
    input: {
      command: [
        'bash',
        '-lc',
        [
          "apply_patch <<'EOF'",
          '*** Begin Patch',
          '*** Update File: src/greet.ts',
          '@@ -1,3 +1,3 @@',
          ' export function greet() {',
          "-  return 'hi'",
          "+  return 'hello'",
          '*** End Patch',
          'EOF'
        ].join('\n')
      ]
    },
    state: 'completed'
  },
  { type: 'tool-result', output: 'Success. Updated the following files:\nM src/greet.ts' }
]

const FAILED_EDIT: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'Edit',
    input: {
      file_path: '/w/src/app.ts',
      old_string: 'const b = 2',
      new_string: 'const b = 9'
    },
    state: 'completed'
  },
  { type: 'tool-result', output: 'String to replace not found in file.', isError: true }
]

function Harness({ blocks }: { blocks: NativeChatBlock[] }): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, {
    blocks,
    // Both the run and its child lines open, which is what the Tools toggle
    // does — the card's rows only exist once the line is revealed.
    defaultExpanded: true,
    activeCall: null,
    styles
  })
}

type Rendered = {
  rows: { marker: string; text: string; background: string | undefined }[]
  gutters: string[]
  texts: string[]
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

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  for (const node of renderer.root.findAllByType('Text')) {
    if (typeof node.props.children === 'string') {
      texts.push(node.props.children)
    }
  }
  const markers = renderer.root.findAll((node) => node.props?.testID === 'diff-card-marker')
  const bodies = renderer.root.findAll((node) => node.props?.testID === 'diff-card-text')
  const rows = markers.map((marker, index) => ({
    marker: String(marker.props.children),
    text: String(bodies[index]?.props.children ?? ''),
    background: styleValue(marker.parent?.props.style, 'backgroundColor')
  }))
  const gutters = renderer.root
    .findAll((node) => node.props?.testID === 'diff-card-gutter')
    .map((node) => String(node.props.children ?? ''))
  return { rows, gutters, texts }
}

describe('an agent file edit in the chat transcript', () => {
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

  it('interleaves the change instead of listing every removal then every addition', () => {
    const { rows } = render(CLAUDE_EDIT)
    expect(rows.map((row) => `${row.marker}${row.text}`)).toEqual([
      ' const a = 1',
      '-const b = 2',
      '+const b = 9',
      ' const c = 3'
    ])
  })

  it('says which file changed, and by how much', () => {
    const { texts } = render(CLAUDE_EDIT)
    expect(texts).toContain('app.ts')
    expect(texts).toContain('Edited file')
    expect(texts).toContain('+1')
    expect(texts).toContain('−1')
  })

  it('leaves the gutter blank when the provider resolved no ranges', () => {
    // A snippet pair cannot locate itself in the file; a number here would read
    // as a file position and be wrong.
    expect(render(CLAUDE_EDIT).gutters).toEqual([])
  })

  it('numbers the rows from the hunks the provider actually resolved', () => {
    expect(render(CLAUDE_EDIT_WITH_PATCH).gutters).toEqual(['40', '41', '41', '42'])
  })

  it('renders a diff for a Codex patch applied through its command tool', () => {
    const { rows, texts } = render(CODEX_EXEC_PATCH)
    expect(texts).toContain('greet.ts')
    expect(rows.map((row) => `${row.marker}${row.text}`)).toEqual([
      ' export function greet() {',
      "-  return 'hi'",
      "+  return 'hello'"
    ])
  })

  it('keeps the provider error visible when the edit did not land', () => {
    const { rows, texts } = render(FAILED_EDIT)
    expect(rows).toEqual([])
    expect(texts).toContain('String to replace not found in file.')
  })

  it('tints an added row for the theme in use, in light and in dark', () => {
    const light = render(CLAUDE_EDIT)
    const lightAdd = light.rows.find((row) => row.marker === '+')?.background
    act(() => renderer?.unmount())
    renderer = null
    const dark = render(CLAUDE_EDIT, 'dark')
    const darkAdd = dark.rows.find((row) => row.marker === '+')?.background
    expect(lightAdd).toBe(lightColors.diffAddBg)
    expect(darkAdd).toBe(darkColors.diffAddBg)
    expect(lightAdd).not.toBe(darkAdd)
  })
})
