// The diff card is agent-agnostic and lane-agnostic: one component under the
// tool line on both the bridge lane and the structured lane. This pins that
// "Revert this hunk" reaches it on both, for a Claude edit and a Codex patch,
// and that the permission card — which shows a proposal, not a landed edit —
// never mounts it with the action.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { HunkRevertOutcome } from './mobile-diff-hunk-revert-request'
import { resetHunkRevertMarksForTests } from './mobile-diff-hunk-revert-marks'

vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: unknown }): unknown =>
    React.createElement('Text', props, children)
  return {
    Animated: {
      Text,
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
    Image: 'Image',
    Pressable: 'Pressable',
    Text,
    View: ({ children, ...props }: { children?: unknown }) =>
      React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light'
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const CLAUDE_EDIT: NativeChatMessage['blocks'] = [
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

const CODEX_EXEC_PATCH: NativeChatMessage['blocks'] = [
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
          '@@ export function greet() {',
          "-  return 'hi'",
          "+  return 'hello'",
          ' }',
          '*** End Patch',
          'EOF'
        ].join('\n')
      ]
    },
    state: 'completed'
  },
  { type: 'tool-result', output: 'Success. Updated the following files:\nM src/greet.ts' }
]

function assistant(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'a1', role: 'assistant', blocks, timestamp: null, source: 'transcript' }
}

describe('Revert this hunk reaches the card on both lanes', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => resetHunkRevertMarksForTests())
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const revertButtons = (root: ReactTestInstance) =>
    root.findAll((node) => node.props?.accessibilityLabel === 'Revert this hunk')

  function render(
    blocks: NativeChatMessage['blocks'],
    props: Omit<Parameters<typeof MobileNativeChatMessage>[0], 'message'>
  ): ReactTestRenderer {
    act(() => {
      renderer = create(createElement(MobileNativeChatMessage, { message: assistant(blocks), ...props }))
    })
    return renderer!
  }

  it.each([
    ['a Claude edit', CLAUDE_EDIT, '/w/src/app.ts'],
    ['a Codex patch', CODEX_EXEC_PATCH, 'src/greet.ts']
  ])('offers it on the bridge lane for %s and hands the card’s file to the handler', async (_name, blocks, path) => {
    const onRevertHunk = vi.fn(
      async (): Promise<HunkRevertOutcome> => ({ status: 'reverted', removed: 1, restored: 1 })
    )
    // The bridge lane: no structured UI; the global Tools toggle opens the lines.
    const tree = render(blocks, { toolsExpanded: true, onRevertHunk })
    const buttons = revertButtons(tree.root)
    expect(buttons).toHaveLength(1)
    await act(async () => {
      buttons[0]!.props.onPress()
    })
    expect(onRevertHunk).toHaveBeenCalledTimes(1)
    expect(onRevertHunk.mock.calls[0]?.[0]).toMatchObject({ path, changeKind: 'edited' })
    expect(onRevertHunk.mock.calls[0]?.[1]).toBe(0)
    // The card's identity starts with the message it came from, so a later
    // message that re-applies the same edit is a different card.
    expect(onRevertHunk.mock.calls[0]?.[2]).toMatch(/^a1:/)
  })

  it('offers it on the structured lane once the turn caret discloses the settled run', () => {
    const onRevertHunk = vi.fn(
      async (): Promise<HunkRevertOutcome> => ({ status: 'reverted', removed: 1, restored: 1 })
    )
    const tree = render(CLAUDE_EDIT, {
      structuredActivityUi: true,
      activeTurnIsWorking: false,
      turnExpanded: true,
      // The turn caret opens the run with its lines collapsed; a tap on the
      // Edit line reveals the card.
      onRevertHunk
    })
    const line = tree.root.findAll(
      (node) => node.props?.accessibilityRole === 'button' && node.props?.accessibilityState?.expanded === false
    )[0]
    expect(line).toBeDefined()
    act(() => line!.props.onPress())
    expect(revertButtons(tree.root)).toHaveLength(1)
  })

  it('offers nothing when the view wired no handler, on either lane', () => {
    expect(revertButtons(render(CLAUDE_EDIT, { toolsExpanded: true }).root)).toHaveLength(0)
  })

  it('never mounts the card with the action on the permission card, which shows a proposal', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./MobileNativeChatPermission.tsx', import.meta.url)),
      'utf8'
    )
    const mounts = source.match(/<MobileNativeChatDiffCard\b[^>]*\/>/gs) ?? []
    expect(mounts.length).toBeGreaterThan(0)
    for (const mount of mounts) {
      expect(mount).not.toContain('onRevertHunk')
    }
  })
})
