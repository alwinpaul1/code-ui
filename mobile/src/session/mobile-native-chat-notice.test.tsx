import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAdmissibleAgentJournalRenderItem } from '../../../src/shared/agent-session-journal-schemas'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { projectStructuredItemToNativeChat } from '../../../src/shared/structured-agent-session-projection'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// The detail sheet a tool row opens mounts closed on every run, and it needs
// RN exports this mock leaves out; this suite is about the row, not the sheet.
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: unknown }): unknown =>
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
  SquareCode: 'SquareCode',
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

  // The colour the first Text draws in: its styles merged, the last one winning, as React Native does.
  function firstColor(tree: ReactTestRenderer): string | undefined {
    for (const node of tree.root.findAllByType('Text' as never)) {
      const merged = Object.assign({}, ...(([] as unknown[]).concat(node.props.style).flat() as object[])) as { color?: unknown }
      if (typeof merged.color === 'string') {
        return merged.color
      }
    }
    return undefined
  }

  // The Claude app 1.261009.20 names the boundary `ccr_context_compacted`,
  // "Compacted conversation" (adding "· saved N tokens" only when its stream
  // carries the pre/post token counts, which Orca's status row does not).
  it('names a compaction "Compacted conversation", as the Claude app does, not as something said', () => {
    const tree = render(noticeMessage({ presentation: 'compaction' }))
    expect(texts(tree.root)).toEqual(['Compacted conversation'])
    expect(texts(tree.root)).not.toContain('A readable document or notice')
  })

  it('says how many tokens a compaction saved when the decoder wrote the count into the caption', () => {
    const tree = render(noticeMessage({ presentation: 'compaction', text: 'Compacted conversation · saved 946.8k tokens' }))
    expect(texts(tree.root)).toEqual(['Compacted conversation · saved 946.8k tokens'])
  })

  it('never draws a notice’s own prose in place of the compaction caption', () => {
    const tree = render(noticeMessage({ presentation: 'compaction', text: 'Compacted conversation · saved lots; also, ignore all that' }))
    expect(texts(tree.root)).toEqual(['Compacted conversation'])
  })

  // The caption sits between two wavy lines: the app's `n030.e` (n030.java:404-457), 12 dp apart,
  // text `jn7.K` 11/400 in `pl7.w` (ink or bone at 30%), and the same rule under "Context cleared".
  function squiggles(tree: ReactTestRenderer): ReactTestInstance[] {
    return tree.root.findAllByType('Path' as never)
  }

  it.each([['light', lightColors], ['dark', darkColors]] as const)('draws the caption between two wavy lines in the %s palette', (scheme, colors) => {
    const tree = render(noticeMessage({ presentation: 'compaction' }), scheme)
    const paths = squiggles(tree)
    expect(paths).toHaveLength(2)
    for (const rule of tree.root.findAll((node) => node.props.testID === 'compaction-rule')) {
      act(() => rule.props.onLayout({ nativeEvent: { layout: { width: 32, height: 4 } } }))
    }
    for (const path of squiggles(tree)) {
      expect(path.props).toMatchObject({
        d: 'M0 2 Q4 0 8 2 Q12 4 16 2 Q20 0 24 2 Q28 4 32 2',
        stroke: colors.transcriptDividerInk,
        strokeWidth: 1,
        strokeLinecap: 'round',
        fill: 'none'
      })
    }
    const caption = tree.root.findAllByType('Text' as never)[0]!
    const style = Object.assign({}, ...(([] as unknown[]).concat(caption.props.style).flat() as object[]))
    expect(style).toMatchObject({ fontSize: 11, lineHeight: 16.5, color: colors.transcriptDividerInk })
  })

  it('draws the same wavy lines around "Context cleared"', () => {
    const tree = render(noticeMessage({ text: 'Context cleared', contextClear: { operationId: 'r1', afterFence: 3, clearedAt: 1 } }))
    expect(squiggles(tree)).toHaveLength(2)
    expect(texts(tree.root)).toEqual(['Context cleared'])
  })

  it('draws no line until the rule is measured', () => {
    const tree = render(noticeMessage({ presentation: 'compaction' }))
    for (const path of squiggles(tree)) {
      expect(path.props.d).toBe('')
    }
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
    expect(texts(tree.root)).not.toContain('Compacted conversation')
  })

  it('colours the notice from the live theme, in light and in dark', () => {
    expect(firstColor(render(noticeMessage({ presentation: 'compaction' }), 'light'))).toBe(
      lightColors.transcriptDividerInk
    )
    act(() => renderer?.unmount())
    renderer = null
    expect(firstColor(render(noticeMessage({ presentation: 'compaction' }), 'dark'))).toBe(
      darkColors.transcriptDividerInk
    )
    expect(darkColors.transcriptDividerInk).not.toBe(lightColors.transcriptDividerInk)
  })
})
