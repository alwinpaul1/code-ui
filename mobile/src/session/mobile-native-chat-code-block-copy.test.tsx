import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// The chat message module reaches the tool detail sheet; a bare shell for it,
// as MobileNativeChatMessage.test.ts does.
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown =>
    React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
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
    Linking: { openURL: () => Promise.resolve() },
    Platform: { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text,
    View: 'View',
    StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
const pasteboard = vi.hoisted(() => ({ written: [] as string[] }))
vi.mock('expo-clipboard', () => ({
  setStringAsync: async (value: string) => {
    pasteboard.written.push(value)
    return true
  }
}))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { agentMessageRow } from './mobile-native-chat-agent-messages'

const REPLY = ['Run the gate:', '', '```sh', 'cd mobile && npx tsc --noEmit', 'npx vitest run', '```', '', 'Then push.'].join('\n')
const CODE = 'cd mobile && npx tsc --noEmit\nnpx vitest run'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  pasteboard.written = []
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function mount(element: ReturnType<typeof createElement>): ReactTestRenderer {
  act(() => {
    renderer = create(element)
  })
  return renderer!
}

function message(role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id: `${role}-1`, role, blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

const codeButtons = (tree: ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Copy code'
  )

async function press(button: ReactTestInstance): Promise<void> {
  await act(async () => {
    await button.props.onPress()
  })
}

// 2026-09-29, from the device: "Have a copy button for code". Which chat rows
// draw a fence through MobileMarkdown, and so carry its Copy button.
describe('a code block in the chat', () => {
  it('has its own Copy on an agent reply, which copies the code and not the reply', async () => {
    const tree = mount(createElement(MobileNativeChatMessage, { message: message('assistant', REPLY) }))
    // The reply's own Copy is still there, beside the block's.
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Copy message' }).length).toBeGreaterThan(0)
    const [button, ...others] = codeButtons(tree)
    expect(others).toHaveLength(0)
    await press(button!)
    expect(pasteboard.written).toEqual([CODE])
  })

  it('has it on a prompt the lead agent wrote, drawn as Markdown in the bubble', async () => {
    const tree = mount(
      createElement(MobileNativeChatMessage, { message: message('user', REPLY), promptsAsMarkdown: true })
    )
    const [button] = codeButtons(tree)
    await press(button!)
    expect(pasteboard.written).toEqual([CODE])
  })

  // A typed prompt is plain text, not Markdown: there is no block to copy,
  // and a hold on the bubble copies the whole prompt (2026-09-21).
  it('adds nothing to a prompt the user typed', () => {
    const tree = mount(createElement(MobileNativeChatMessage, { message: message('user', REPLY) }))
    expect(codeButtons(tree)).toHaveLength(0)
  })

  it('has it on a message from a subagent, once opened', async () => {
    const row = agentMessageRow({ id: 'agent-message:1', sender: 'reviewer', body: REPLY, cut: false, timestamp: 1 })
    const tree = mount(createElement(MobileNativeChatMessage, { message: row }))
    expect(codeButtons(tree)).toHaveLength(0)
    act(() => {
      tree.root
        .find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Message from reviewer')
        .props.onPress()
    })
    const [button] = codeButtons(tree)
    await press(button!)
    expect(pasteboard.written).toEqual([CODE])
  })
})
