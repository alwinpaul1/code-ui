import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// The chat message module reaches the tool detail sheet; a bare shell for it,
// as MobileNativeChatMessage.test.ts does.
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown => React.createElement('Text', props, children)
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
    ScrollView: 'ScrollView',
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 360, height: 780, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Undo2: 'Undo2'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { AGENT_MESSAGE_CUT_NOTE, AGENT_MESSAGE_UNREAD_NOTE } from './MobileNativeChatAgentMessageRow'
import { agentMessageRow, parseSubagentMessage } from './mobile-native-chat-agent-messages'
import { SUBAGENT_REQUEST_PROMPT } from './fixtures/claude-agent-message-read-image-2.1.283'

// The row a subagent's message is drawn as (Claude Code 2.1.283's TUI folds it
// as "› Message from @general-purpose (ctrl+o to expand)", and opens it to the
// message under "Message from general-purpose").

const BODY = parseSubagentMessage(SUBAGENT_REQUEST_PROMPT)!.body
const row = (body: string, cut = false) => agentMessageRow({ id: 'agent-message:1', sender: 'general-purpose', body, cut, timestamp: 1 })

function texts(node: ReactTestInstance): string[] {
  return node.findAll((entry) => (entry.type as unknown) === 'Text').map((entry) => [entry.props.children].flat().join(''))
}
function colorOf(style: unknown): string | undefined {
  for (const entry of [style].flat(Infinity)) {
    if (entry && typeof entry === 'object' && typeof (entry as { color?: unknown }).color === 'string') {
      return (entry as { color: string }).color
    }
  }
  return undefined
}

describe("a subagent's message in the chat", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const render = (body: string, scheme: 'light' | 'dark' = 'light', cut = false) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(MobileNativeChatMessage, { message: row(body, cut) })}
        </ThemeProvider>
      )
    })
    return renderer!.root
  }
  const toggle = (root: ReactTestInstance) =>
    root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Message from general-purpose')

  it('stays folded to "Message from general-purpose" until tapped, then opens to the message as Markdown', () => {
    const root = render(BODY)
    expect(texts(root)).toEqual(['Message from general-purpose'])
    expect(root.findAll((node) => (node.type as unknown) === 'MobileMarkdown')).toHaveLength(0)
    expect(toggle(root).props.accessibilityState).toEqual({ expanded: false })

    act(() => toggle(root).props.onPress())
    const markdown = root.findAll((node) => (node.type as unknown) === 'MobileMarkdown')
    expect(markdown.map((node) => node.props.content)).toEqual([BODY])
    expect(toggle(root).props.accessibilityState).toEqual({ expanded: true })

    act(() => toggle(root).props.onPress())
    expect(root.findAll((node) => (node.type as unknown) === 'MobileMarkdown')).toHaveLength(0)
  })

  it('says the words did not reach the phone when only the TUI row did', () => {
    const root = render('')
    act(() => toggle(root).props.onPress())
    expect(texts(root)).toEqual(['Message from general-purpose', AGENT_MESSAGE_UNREAD_NOTE])
  })

  // Bug B review, 2026-09-27: words that are only the start of the message
  // (the hook's 2,000 bytes, the tab status's 200 characters) must never read as
  // the whole of it.
  it('says so under the words when only the start of the message reached the phone', () => {
    const root = render('Request for one read-only device probe…', 'light', true)
    act(() => toggle(root).props.onPress())
    expect(root.findAll((node) => (node.type as unknown) === 'MobileMarkdown').map((node) => node.props.content)).toEqual([
      'Request for one read-only device probe…'
    ])
    expect(texts(root)).toEqual(['Message from general-purpose', AGENT_MESSAGE_CUT_NOTE])
  })

  it('says nothing more under words that are the whole message', () => {
    const root = render(BODY)
    act(() => toggle(root).props.onPress())
    expect(texts(root)).toEqual(['Message from general-purpose'])
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the note under a cut message from the %s theme', (scheme, palette) => {
    const root = render('Request for one read-only device probe…', scheme, true)
    act(() => toggle(root).props.onPress())
    const note = root.find((node) => (node.type as unknown) === 'Text' && [node.props.children].flat().join('') === AGENT_MESSAGE_CUT_NOTE)
    expect(colorOf(note.props.style)).toBe(palette.textMuted)
  })

  // Combined review of fix/prompt-leak, 2026-09-27: main's finished runs hug
  // their words (`toolRunSentence`, flex 0) so the chevron follows them; this
  // row's title took the rest of the line, and its chevron sat at the far right.
  it.each([
    ['light', 'light'],
    ['dark', 'dark']
  ] as const)('keeps its chevron right after the title, as a finished run does, in the %s theme', (_label, scheme) => {
    const root = render(BODY, scheme)
    const title = root.find((node) => (node.type as unknown) === 'Text' && [node.props.children].flat().join('') === 'Message from general-purpose')
    const flex = [title.props.style].flat(Infinity).reduce<number | undefined>(
      (last, entry) => (entry && typeof entry === 'object' && typeof (entry as { flex?: unknown }).flex === 'number' ? (entry as { flex: number }).flex : last),
      undefined
    )
    expect(flex).toBe(0)
    const shrink = [title.props.style].flat(Infinity).some((entry) => entry && typeof entry === 'object' && (entry as { flexShrink?: unknown }).flexShrink === 1)
    expect(shrink).toBe(true)
  })

  it('is never a bubble: no copy control and nothing to rewind', () => {
    const root = render(BODY)
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Copy message')).toHaveLength(0)
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Sent prompt')).toHaveLength(0)
  })

  it('keeps the title to one line at phone width', () => {
    const root = render(BODY)
    const title = root.find((node) => (node.type as unknown) === 'Text' && [node.props.children].flat().join('') === 'Message from general-purpose')
    expect(title.props.numberOfLines).toBe(1)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its title, chevron and note from the %s theme', (scheme, palette) => {
    const root = render('', scheme)
    const title = root.find((node) => (node.type as unknown) === 'Text' && [node.props.children].flat().join('') === 'Message from general-purpose')
    expect(colorOf(title.props.style)).toBe(palette.textSecondary)
    expect(root.find((node) => (node.type as unknown) === 'ChevronRight').props.color).toBe(palette.textMuted)
    act(() => toggle(root).props.onPress())
    expect(root.find((node) => (node.type as unknown) === 'ChevronDown').props.color).toBe(palette.textMuted)
    const note = root.find((node) => (node.type as unknown) === 'Text' && [node.props.children].flat().join('') === AGENT_MESSAGE_UNREAD_NOTE)
    expect(colorOf(note.props.style)).toBe(palette.textMuted)
  })
})
