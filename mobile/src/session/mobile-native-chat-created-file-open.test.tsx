// 2026-09-25, the user: "if a file like md or pdf or text is created when the
// user clicks this files on chatui open that corresponding file". The card an
// agent's new file gets ("Added file report.md +3 −0") drew the name as plain
// text, so the only way to the file was the path on the tool line above it.
// Claude Code 2.1.281 answers a Write with "File created successfully at:
// <absolute path>"; Codex adds one with an `*** Add File:` patch.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatDiffCard } from './MobileNativeChatDiffCard'
import { ToolRun } from './MobileNativeChatToolRun'

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, header, children }: { visible: boolean; header?: unknown; children?: unknown }) =>
      visible ? React.createElement('DraggableDetailSheet', null, header, children) : null
  }
})
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

function claudeWrite(path: string, content: string): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'Write', input: { file_path: path, content }, state: 'completed' },
    { type: 'tool-result', output: `File created successfully at: ${path}` }
  ]
}

function codexPatch(header: string, body: string[], summary: string): NativeChatBlock[] {
  return [
    {
      type: 'tool-call',
      name: 'exec',
      input: {
        command: ['bash', '-lc', ["apply_patch <<'EOF'", '*** Begin Patch', header, ...body, '*** End Patch', 'EOF'].join('\n')]
      },
      state: 'completed'
    },
    { type: 'tool-result', output: `Success. Updated the following files:\n${summary}` }
  ]
}

function Harness({ blocks, onOpenFile }: { blocks: NativeChatBlock[]; onOpenFile?: (path: string) => void }) {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded: true, activeCall: null, styles, onOpenFile })
}

describe('a file the agent created opens from its card in the chat', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function cardName(blocks: NativeChatBlock[], onOpenFile?: (path: string) => void, scheme: 'light' | 'dark' = 'light') {
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: scheme }, createElement(Harness, { blocks, onOpenFile }))
      )
    })
    const names = renderer!.root.findAll((node) => node.type === 'Text' && node.props.testID === 'diff-card-path')
    expect(names).toHaveLength(1)
    return names[0]!
  }

  it('opens the markdown file Claude just wrote when its name is tapped', () => {
    const onOpenFile = vi.fn()
    const name = cardName(claudeWrite('/w/docs/report.md', '# Report\n\nDone.\n'), onOpenFile)
    expect(name.props.children).toBe('report.md')
    act(() => name.props.onPress())
    expect(onOpenFile).toHaveBeenCalledWith('/w/docs/report.md')
  })

  it('opens a file Claude created empty, whose card has no rows at all', () => {
    const onOpenFile = vi.fn()
    const name = cardName(claudeWrite('/w/notes.txt', ''), onOpenFile)
    act(() => name.props.onPress())
    expect(onOpenFile).toHaveBeenCalledWith('/w/notes.txt')
  })

  it('opens a file Codex added through a patch', () => {
    const onOpenFile = vi.fn()
    const name = cardName(codexPatch('*** Add File: notes/todo.txt', ['+buy milk'], 'A notes/todo.txt'), onOpenFile)
    act(() => name.props.onPress())
    expect(onOpenFile).toHaveBeenCalledWith('notes/todo.txt')
  })

  it('opens a file the agent edited, not only one it created', () => {
    const onOpenFile = vi.fn()
    const name = cardName(
      codexPatch('*** Update File: src/greet.ts', ['@@ -1,1 +1,1 @@', "-  return 'hi'", "+  return 'hello'"], 'M src/greet.ts'),
      onOpenFile
    )
    act(() => name.props.onPress())
    expect(onOpenFile).toHaveBeenCalledWith('src/greet.ts')
  })

  it('offers nothing to open for a file the agent deleted', () => {
    const name = cardName(codexPatch('*** Delete File: old.txt', [], 'D old.txt'), vi.fn())
    expect(name.props.onPress).toBeUndefined()
    expect(name.props.accessibilityRole).toBeUndefined()
  })

  it('draws the name as a link in the theme in use, light and dark', () => {
    const light = cardName(claudeWrite('/w/a.md', 'x'), vi.fn(), 'light')
    const lightColor = [light.props.style].flat(3).reduce((color, entry) => entry?.color ?? color, undefined)
    act(() => renderer?.unmount())
    const dark = cardName(claudeWrite('/w/a.md', 'x'), vi.fn(), 'dark')
    const darkColor = [dark.props.style].flat(3).reduce((color, entry) => entry?.color ?? color, undefined)
    expect(lightColor).toBe(lightColors.accentText)
    expect(darkColor).toBe(darkColors.accentText)
    expect(lightColor).not.toBe(darkColor)
  })

  it('leaves the name plain where nothing can open it, as on a permission card proposing the file', () => {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileNativeChatDiffCard, {
            file: {
              path: '/w/new.md',
              oldPath: null,
              changeKind: 'added',
              added: 1,
              removed: 0,
              lines: [{ kind: 'add', text: '# New', oldLineNumber: null, newLineNumber: 1 }],
              lineNumbersKnown: false,
              truncated: false
            },
            verb: 'Create file'
          })
        )
      )
    })
    const name = renderer!.root.find((node) => node.type === 'Text' && node.props.testID === 'diff-card-path')
    expect(name.props.onPress).toBeUndefined()
  })
})
