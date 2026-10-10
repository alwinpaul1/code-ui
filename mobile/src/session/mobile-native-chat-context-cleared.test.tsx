import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentJournalTurnBody } from '../../../src/shared/agent-session-turn-record'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import {
  activeStructuredAgentSessionTurnId,
  isStructuredAgentSessionThinking
} from '../../../src/shared/structured-agent-session-live-turn'
import { projectStructuredItemToNativeChat } from '../../../src/shared/structured-agent-session-projection'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// The detail sheet a tool row opens mounts closed on every run, and it needs
// RN exports this mock leaves out; this suite is about the row, not the sheet.
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }) =>
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
    View: ({ children, ...props }: { children?: ReactNode }) =>
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

// Orca #26579 (bb44f74d00): a /clear keeps the chat and its tab. The host writes one status row
// carrying `contextClear` where the agent's context restarted, with the earlier messages left
// above it. Before this port the phone drew that row as ordinary agent prose ("Context cleared"
// in a reply bubble with copy controls), and the live-turn readers looked straight past it.

const BOUNDARY = { operationId: 'clear-op', afterFence: 3, clearedAt: 5_000 }

function row(
  itemId: string,
  sequence: number,
  body: AgentJournalRenderItem['body']
): AgentJournalRenderItem {
  return { itemId, revision: 1, sequence, observedAt: sequence, body }
}

const clearRow = (sequence: number, contextClear: unknown = BOUNDARY): AgentJournalRenderItem =>
  row('clear', sequence, {
    kind: 'status',
    text: 'Context cleared',
    presentation: 'context-cleared',
    contextClear
  } as AgentJournalRenderItem['body'])

describe('the boundary a /clear leaves in the chat', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(message: NativeChatMessage, scheme: 'light' | 'dark'): ReactTestRenderer {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatMessage message={message} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  const texts = (node: ReactTestInstance): string[] =>
    node.findAllByType('Text' as never).map((text) => String(text.children.join('')))

  it.each(['light', 'dark'] as const)(
    'draws one muted divider in the host words, not a reply (%s)',
    (scheme) => {
      const message = projectStructuredItemToNativeChat(clearRow(5))!
      const tree = render(message, scheme)
      expect(texts(tree.root)).toEqual(['Context cleared'])
      const divider = tree.root.find(
        (node) => (node.type as unknown) === 'View' && node.props.accessibilityLabel === 'Context cleared'
      )
      const colors = scheme === 'light' ? lightColors : darkColors
      const rules = divider.findAll(
        (node) =>
          (node.type as unknown) === 'View' && node.props.style?.backgroundColor === colors.border
      )
      expect(rules).toHaveLength(2)
      expect(tree.root.findAllByType('Copy' as never)).toHaveLength(0)
    }
  )

  it('keeps a boundary the host sent malformed as readable prose', () => {
    const message = projectStructuredItemToNativeChat(clearRow(5, { operationId: '' }))!
    const tree = render(message, 'light')
    expect(texts(tree.root)).toContain('Context cleared')
    expect(
      tree.root.findAll(
        (node) => (node.type as unknown) === 'View' && node.props.accessibilityLabel === 'Context cleared'
      )
    ).toHaveLength(0)
  })
})

describe('the live turn after a /clear', () => {
  const running = row('turn-t1', 2, agentJournalTurnBody({ turnId: 't1', state: 'running', startedAt: 1_000 }))
  const reasoning = row('r1', 3, { kind: 'message', role: 'reasoning', blocks: [{ type: 'text', text: 'hm' }] })

  it('reads no running turn from before the boundary', () => {
    expect(activeStructuredAgentSessionTurnId([running, reasoning])).toBe('t1')
    expect(activeStructuredAgentSessionTurnId([running, reasoning, clearRow(4)])).toBeNull()
  })

  it('reads no thinking from before the boundary', () => {
    expect(isStructuredAgentSessionThinking([running, reasoning])).toBe(true)
    expect(isStructuredAgentSessionThinking([running, reasoning, clearRow(4)])).toBe(false)
  })
})
