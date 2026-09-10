import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAdmissibleAgentJournalRenderItem } from '../../../src/shared/agent-session-journal-schemas'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { projectStructuredItemToNativeChat } from '../../../src/shared/structured-agent-session-projection'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

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
  AlertCircle: 'AlertCircle',
  AlertTriangle: 'AlertTriangle',
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Info: 'Info',
  Sparkles: 'Sparkles',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  return {
    MobileMarkdown: ({ content }: { content: string }) => React.createElement('Text', null, content)
  }
})

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

function statusItem(body: Record<string, unknown>): AgentJournalRenderItem {
  return {
    itemId: 'notice-1',
    revision: 1,
    sequence: 1,
    observedAt: 1_000,
    body: { kind: 'status', ...body } as AgentJournalRenderItem['body']
  }
}

const NOTICE_SHAPES = [
  { presentation: 'compaction' },
  { presentation: 'plan-document' },
  { tone: 'warning' },
  { tone: 'error' },
  { tone: 'notice' },
  { presentation: 'future-presentation', tone: 'future-tone' }
]

describe('a notice the host sends with display hints', () => {
  it.each(NOTICE_SHAPES)('survives journal admission: %j', (hints) => {
    expect(isAdmissibleAgentJournalRenderItem(statusItem({ text: 'A notice', ...hints }))).toBe(
      true
    )
  })

  it.each(NOTICE_SHAPES)('reaches the phone with its hints intact: %j', (hints) => {
    expect(
      projectStructuredItemToNativeChat(statusItem({ text: 'A notice', ...hints }))
    ).toMatchObject({ role: 'system', blocks: [{ type: 'text', text: 'A notice', ...hints }] })
  })
})

describe('a notice on screen', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function noticeMessage(block: Record<string, unknown>): NativeChatMessage {
    return {
      id: 's1',
      role: 'system',
      timestamp: null,
      source: 'transcript',
      blocks: [{ type: 'text', text: 'A readable document or notice', ...block }] as never
    }
  }

  function render(
    message: NativeChatMessage,
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileNativeChatMessage, { message })
        )
      )
    })
    return renderer!
  }

  const texts = (node: ReactTestInstance): string[] =>
    node.findAllByType('Text' as never).map((text) => String(text.children.join('')))

  function firstColor(tree: ReactTestRenderer): string | undefined {
    for (const node of tree.root.findAllByType('Text' as never)) {
      for (const entry of (Array.isArray(node.props.style)
        ? node.props.style.flat()
        : [node.props.style]) as { color?: unknown }[]) {
        if (entry && typeof entry.color === 'string') {
          return entry.color
        }
      }
    }
    return undefined
  }

  it('marks a compaction as a break in the conversation, not as something said', () => {
    const tree = render(noticeMessage({ presentation: 'compaction' }))
    expect(texts(tree.root)).toEqual(['Context compacted'])
    expect(texts(tree.root)).not.toContain('A readable document or notice')
  })

  it('gives a plan document a heading so it does not read as a reply', () => {
    const tree = render(noticeMessage({ presentation: 'plan-document' }))
    expect(texts(tree.root)).toContain('Plan')
    expect(texts(tree.root)).toContain('A readable document or notice')
  })

  it('keeps a warning readable and marks it as one', () => {
    const tree = render(noticeMessage({ tone: 'warning' }))
    expect(texts(tree.root)).toContain('A readable document or notice')
    expect(tree.root.findAllByType('AlertTriangle' as never)).toHaveLength(1)
  })

  it('shows an error with its own glyph', () => {
    const tree = render(noticeMessage({ tone: 'error' }))
    expect(tree.root.findAllByType('AlertCircle' as never)).toHaveLength(1)
  })

  it('falls back to plain prose for a hint this build does not know', () => {
    const tree = render(noticeMessage({ presentation: 'future-presentation', tone: 'future-tone' }))
    expect(texts(tree.root)).toContain('A readable document or notice')
    expect(tree.root.findAllByType('AlertTriangle' as never)).toHaveLength(0)
    expect(tree.root.findAllByType('AlertCircle' as never)).toHaveLength(0)
  })

  it('leaves an ordinary system line exactly as it was', () => {
    const tree = render(noticeMessage({}))
    expect(texts(tree.root)).toContain('A readable document or notice')
    expect(texts(tree.root)).not.toContain('Context compacted')
  })

  it('colours the notice from the live theme, in light and in dark', () => {
    expect(firstColor(render(noticeMessage({ presentation: 'compaction' }), 'light'))).toBe(
      lightColors.textMuted
    )
    act(() => renderer?.unmount())
    renderer = null
    expect(firstColor(render(noticeMessage({ presentation: 'compaction' }), 'dark'))).toBe(
      darkColors.textMuted
    )
    expect(darkColors.textMuted).not.toBe(lightColors.textMuted)
  })
})
