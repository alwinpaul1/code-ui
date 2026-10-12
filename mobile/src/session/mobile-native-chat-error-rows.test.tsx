import { createElement, type ReactNode, type ComponentType } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_CHAT_INTERRUPTED_STATUS_TEXT, type NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: unknown }): unknown =>
    React.createElement('Text', props, children as ReactNode)
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
    View: ({ children, ...props }: { children?: unknown }) => React.createElement('View', props, children as ReactNode),
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
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  return {
    MobileMarkdown: ({ content }: { content: string }) => React.createElement('Text', null, content)
  }
})

import { ThemeProvider } from '../theme/theme-context'

/** The provider as these tests mount it: createElement passes its child as the third argument. */
const Themed = ThemeProvider as unknown as ComponentType<{ initialPreference: 'light' | 'dark'; children?: ReactNode }>
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { agentTurnsByEnd } from './mobile-native-chat-turn-end'
import { errorRowOf } from './mobile-native-chat-error-rows'

// The Claude app draws a failed or stopped turn as its own row, apart from the
// agent's words: an API error record, and the `result` row whose subtype
// `error_during_execution` it names "Session interrupted" (qhu, 1.261009.20).
// Ours drew both as the agent's prose, with a Copy under them.

/** Claude Code 2.1.283 (session on this machine, 2026-09-2x): the record is an
 *  assistant message with `isApiErrorMessage: true`, which Orca's reader drops,
 *  leaving the words alone (claude-api-error-text.ts). */
const API_ERROR_2_1_283 = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)"
/** Claude Code 2.1.285, the other shape seen on this machine that week. */
const API_ERROR_2_1_285 = 'API Error: Connection lost mid-response. The response above may be incomplete.'

function assistant(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

/** What Orca's decoders make of a stopped turn, for both agents: Claude Code
 *  2.1.273's `[Request interrupted by user]` record carrying
 *  `interruptedMessageId`, and Codex 0.153.4's `event_msg` `turn_aborted`
 *  (`reason: "interrupted"`), each become this one system row. */
function interrupted(id: string): NativeChatMessage {
  return {
    id,
    role: 'system',
    blocks: [{ type: 'text', text: NATIVE_CHAT_INTERRUPTED_STATUS_TEXT }],
    timestamp: null,
    source: 'transcript'
  }
}

describe('which rows are error rows', () => {
  it.each([
    ['a Claude Code 2.1.283 API error', assistant('e1', API_ERROR_2_1_283), API_ERROR_2_1_283],
    ['a Claude Code 2.1.285 API error', assistant('e2', API_ERROR_2_1_285), API_ERROR_2_1_285],
    ['a stopped turn (Claude Code and Codex alike)', interrupted('i1'), 'Session interrupted']
  ])('reads %s as an error row', (_name, message, text) => {
    expect(errorRowOf(message)).toEqual({ text })
  })

  it.each([
    ['an answer that quotes an error below its first line', assistant('a1', 'Here is what failed.\n\nAPI Error: 500')],
    ['an answer that mentions one mid-sentence', assistant('a2', 'The API Error: 500 you saw came from the proxy.')],
    // Review of 2026-10-12: every recorded API error on this machine is one
    // line; an answer that opens with the words and goes on is the agent talking.
    ['an answer that opens with one and goes on', assistant('a4', 'API Error: 529 means the API is overloaded.\n\nRetry later.')],
    ['a user prompt pasting one', { ...assistant('u1', API_ERROR_2_1_283), role: 'user' as const }],
    [
      'an error row that also carries tool work',
      {
        ...assistant('a3', API_ERROR_2_1_283),
        blocks: [{ type: 'tool-call' as const, name: 'Bash', input: {} }, { type: 'text' as const, text: API_ERROR_2_1_283 }]
      }
    ]
  ])('leaves %s as prose', (_name, message) => {
    expect(errorRowOf(message)).toBeNull()
  })
})

describe('an error row on screen', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(message: NativeChatMessage, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        createElement(
          Themed,
          { initialPreference: scheme },
          createElement(MobileNativeChatMessage, {
            message,
            endsTurn: true,
            turnHasProse: true,
            copyTurnText: () => 'words'
          })
        )
      )
    })
    return renderer!
  }

  const texts = (node: ReactTestInstance): string[] =>
    node.findAllByType('Text' as never).map((text) => String(text.children.join('')))

  function colorOf(tree: ReactTestRenderer, text: string): string | undefined {
    const node = tree.root.findAllByType('Text' as never).find((entry) => entry.children.join('') === text)
    const styles = ([] as unknown[]).concat(node?.props.style).flat(Infinity) as { color?: unknown }[]
    return styles.reduce<string | undefined>((found, entry) => (typeof entry?.color === 'string' ? entry.color : found), undefined)
  }

  it.each([
    ['an API error', assistant('e1', API_ERROR_2_1_283), API_ERROR_2_1_283],
    ['a stopped turn', interrupted('i1'), 'Session interrupted']
  ])('draws %s in the danger colour with its glyph and no Copy, in light and in dark', (_name, message, text) => {
    for (const [scheme, colors] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      const tree = render(message, scheme)
      expect(texts(tree.root)).toContain(text)
      expect(tree.root.findAllByType('AlertCircle' as never)).toHaveLength(1)
      expect(colorOf(tree, text)).toBe(colors.danger)
      expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Copy message')).toHaveLength(0)
    }
    expect(darkColors.danger).not.toBe(lightColors.danger)
  })

  it('no longer says "Conversation interrupted" as if the agent wrote it', () => {
    expect(texts(render(interrupted('i1')).root)).not.toContain(NATIVE_CHAT_INTERRUPTED_STATUS_TEXT)
  })
})

describe('the turn an error ends', () => {
  it("keeps the turn's Copy under its last words, not under the error row", () => {
    const rows: NativeChatMessage[] = [
      { id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'go' }], timestamp: null, source: 'transcript' },
      assistant('a1', 'Looking at the tests now.'),
      assistant('e1', API_ERROR_2_1_283)
    ]
    expect([...agentTurnsByEnd(rows).keys()]).toEqual(['a1'])
  })

  it('gives a stopped turn no turn of its own to hang a Copy on', () => {
    const rows: NativeChatMessage[] = [
      { id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'go' }], timestamp: null, source: 'transcript' },
      assistant('a1', 'Starting.'),
      interrupted('i1')
    ]
    expect([...agentTurnsByEnd(rows).keys()]).toEqual(['a1'])
  })
})
