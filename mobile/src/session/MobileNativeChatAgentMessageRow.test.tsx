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
  Undo2: 'Undo2',
  X: 'X'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
// The sheet's frame: its content is drawn only while it is open.
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', null, header, children) : null
  }
})

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { AGENT_MESSAGE_CUT_NOTE, AGENT_MESSAGE_UNREAD_NOTE } from './MobileNativeChatAgentMessageRow'
import { agentMessageRow, parseSubagentMessage } from './mobile-native-chat-agent-messages'
import { receivedMessageSender } from './mobile-received-message-sender'
import { SUBAGENT_REQUEST_PROMPT } from './fixtures/claude-agent-message-read-image-2.1.283'

// A subagent's message mid-run, Claude Code 2.1.283 (the TUI folds it as
// "› Message from @general-purpose (ctrl+o to expand)"). The Claude app
// 1.261009.20 draws such a message as its own row, "Received message from
// <name>" (`ccr_received_message_from`), the name checked first, and a tap
// opens a sheet titled "Message" headed "From: <name>". Ours folded it open
// in place as "Message from <name>".

const BODY = parseSubagentMessage(SUBAGENT_REQUEST_PROMPT)!.body
/** The id the real record carries, which is what the row has when the
 *  phone does not know the agent's name. */
const AGENT_ID = /from="([^"]+)"/.exec(SUBAGENT_REQUEST_PROMPT)![1]!
const row = (body: string, cut = false, sender = 'general-purpose') =>
  agentMessageRow({ id: 'agent-message:1', sender, body, cut, timestamp: 1 })

function textOf(node: ReactTestInstance): string {
  return [node.props.children]
    .flat()
    .map((child) => (typeof child === 'string' ? child : child && typeof child === 'object' && 'props' in child ? [(child as { props: { children?: unknown } }).props.children].flat().join('') : ''))
    .join('')
}
function topTexts(node: ReactTestInstance): string[] {
  // A Text inside a Text is part of its parent's sentence.
  const insideText = (entry: ReactTestInstance): boolean => {
    for (let at = entry.parent; at; at = at.parent) {
      if ((at.type as unknown) === 'Text') {
        return true
      }
    }
    return false
  }
  return node.findAll((entry) => (entry.type as unknown) === 'Text' && !insideText(entry)).map(textOf)
}
function colorOf(style: unknown): string | undefined {
  let found: string | undefined
  for (const entry of [style].flat(Infinity)) {
    if (entry && typeof entry === 'object' && typeof (entry as { color?: unknown }).color === 'string') {
      found = (entry as { color: string }).color
    }
  }
  return found
}

describe('the name a received message shows', () => {
  it.each([
    ['a subagent named by its type', 'general-purpose', 'general-purpose'],
    ['a name with the TUI’s @', '@code-ui-6f', 'code-ui-6f'],
    ["Claude Code's own lead", 'team-lead', 'team lead']
  ])('shows %s', (_label, raw, shown) => {
    expect(receivedMessageSender(raw)).toBe(shown)
  })

  it.each([
    ['a bare agent id, as the real record carries', AGENT_ID],
    ['a peer posing as the lead', 'Team Lead'],
    ['a peer posing as the lead in full-width letters', 'Ｔｅａｍ Ｌｅａｄ'],
    ['a peer posing as a teammate', 'a teammate'],
    ['a peer posing as a subagent', 'the subagent'],
    ['a peer posing as another session', 'another-session'],
    ['a socket address', 'uds:/tmp/cc-socks/66525.sock'],
    ['a session id', 'session_01ABCDEFG'],
    ['nothing', '  ']
  ])('refuses %s and shows no name', (_label, raw) => {
    expect(receivedMessageSender(raw)).toBeNull()
  })
})

describe("a subagent's message in the chat", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const render = (body: string, scheme: 'light' | 'dark' = 'light', cut = false, sender = 'general-purpose') => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(MobileNativeChatMessage, { message: row(body, cut, sender) })}
        </ThemeProvider>
      )
    })
    return renderer!.root
  }
  const TITLE = 'Received message from general-purpose'
  const opener = (root: ReactTestInstance, title = TITLE) =>
    root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === title)
  const sheet = (root: ReactTestInstance) => root.findAll((node) => (node.type as unknown) === 'BottomDrawer')

  it('is one row, "Received message from general-purpose", that opens a "Message" sheet headed "From: general-purpose"', () => {
    const root = render(BODY)
    expect(topTexts(root)).toEqual([TITLE])
    expect(sheet(root)).toHaveLength(0)
    expect(root.findAll((node) => (node.type as unknown) === 'MobileMarkdown')).toHaveLength(0)

    act(() => opener(root).props.onPress())
    const [drawer] = sheet(root)
    expect(drawer).toBeDefined()
    expect(topTexts(drawer!)).toEqual(['Message', 'From: general-purpose'])
    expect(drawer!.findAll((node) => (node.type as unknown) === 'MobileMarkdown').map((node) => node.props.content)).toEqual([BODY])
    // The row stays where it was: the message is read in the sheet, not unfolded in the chat.
    expect(topTexts(root).slice(0, 1)).toEqual([TITLE])

    act(() => drawer!.findByProps({ accessibilityLabel: 'Close' }).props.onPress())
    expect(sheet(root)).toHaveLength(0)
  })

  it('names no one when the phone has only the agent id, as the Claude app does', () => {
    const root = render(BODY, 'light', false, AGENT_ID)
    expect(topTexts(root)).toEqual(['Received message from another session'])
    act(() => opener(root, 'Received message from another session').props.onPress())
    expect(topTexts(sheet(root)[0]!)).toEqual(['Message', 'From another session'])
  })

  it('says the words did not reach the phone when only the TUI row did', () => {
    const root = render('')
    act(() => opener(root).props.onPress())
    expect(topTexts(sheet(root)[0]!)).toEqual(['Message', 'From: general-purpose', AGENT_MESSAGE_UNREAD_NOTE])
  })

  // Bug B review, 2026-09-27: words that are only the start of the message
  // (the hook's 2,000 bytes, the tab status's 200 characters) must never read as
  // the whole of it.
  it('says so under the words when only the start of the message reached the phone', () => {
    const root = render('Request for one read-only device probe…', 'light', true)
    act(() => opener(root).props.onPress())
    const [drawer] = sheet(root)
    expect(drawer!.findAll((node) => (node.type as unknown) === 'MobileMarkdown').map((node) => node.props.content)).toEqual([
      'Request for one read-only device probe…'
    ])
    expect(topTexts(drawer!)).toEqual(['Message', 'From: general-purpose', AGENT_MESSAGE_CUT_NOTE])
  })

  it('says nothing more under words that are the whole message', () => {
    const root = render(BODY)
    act(() => opener(root).props.onPress())
    expect(topTexts(sheet(root)[0]!)).toEqual(['Message', 'From: general-purpose'])
  })

  // Combined review of fix/prompt-leak, 2026-09-27: main's finished runs hug
  // their words (`toolRunSentence`, flex 0) so the chevron follows them.
  it.each(['light', 'dark'] as const)('keeps its chevron right after the title, as a finished run does, in the %s theme', (scheme) => {
    const root = render(BODY, scheme)
    const title = root.find((node) => (node.type as unknown) === 'Text' && textOf(node) === TITLE)
    const flex = [title.props.style].flat(Infinity).reduce<number | undefined>(
      (last, entry) => (entry && typeof entry === 'object' && typeof (entry as { flex?: unknown }).flex === 'number' ? (entry as { flex: number }).flex : last),
      undefined
    )
    expect(flex).toBe(0)
    expect(title.props.numberOfLines).toBe(1)
  })

  it('is never a bubble: no copy control and nothing to rewind', () => {
    const root = render(BODY)
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Copy message')).toHaveLength(0)
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Sent prompt')).toHaveLength(0)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its sentence, the name, the chevron and the sheet from the %s theme', (scheme, palette) => {
    const root = render('', scheme)
    const title = root.find((node) => (node.type as unknown) === 'Text' && textOf(node) === TITLE)
    expect(colorOf(title.props.style)).toBe(palette.textSecondary)
    // The name in the strong ink, as the Claude app sets it apart (`ad5.u0`).
    const name = title.find((node) => (node.type as unknown) === 'Text' && node !== title)
    expect(colorOf(name.props.style)).toBe(palette.text)
    expect(root.find((node) => (node.type as unknown) === 'ChevronRight').props.color).toBe(palette.textMuted)
    act(() => opener(root).props.onPress())
    const note = root.find((node) => (node.type as unknown) === 'Text' && textOf(node) === AGENT_MESSAGE_UNREAD_NOTE)
    expect(colorOf(note.props.style)).toBe(palette.textMuted)
  })
})
