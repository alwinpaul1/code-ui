// A spawn group's roster row on the phone (Orca #26125): drawn from the host's live block,
// replacing its frozen sentence only when it can draw, outside the settled-tools collapse, and
// opened by group id from state the transcript holds. Light and dark: its tones are the palette's.

import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  NativeChatMessage,
  NativeChatSubagentEntry
} from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { Harness, Result, userMessage } from './use-mobile-native-chat-turn-disclosure.test-fixture'

vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }): unknown =>
      React.createElement(name, props, children)
  return {
    Animated: {
      View: host('View'),
      Text: host('Text'),
      Value: class {
        setValue(): void {}
        interpolate(): unknown {
          return this
        }
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
    Image: 'Image',
    Platform: { OS: 'android', Version: 34 },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerMediumImpact: vi.fn()
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('./MobileNativeChatShimmerText', () => ({
  ShimmerText: ({ text, active }: { text: string; active: boolean }) => createElement('Shimmer', { active }, text)
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 70_000 }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

function roster(
  agents: NativeChatSubagentEntry[],
  sentence: string | null = 'Kicked off 2 subagents'
): NativeChatMessage {
  return {
    id: 'spawn',
    role: 'system',
    blocks: [
      ...(sentence === null ? [] : [{ type: 'text' as const, text: sentence }]),
      { type: 'subagent-group', groupId: 'group-1', agents }
    ],
    timestamp: null,
    source: 'transcript'
  }
}

const WORKING: NativeChatSubagentEntry[] = [
  { id: 'a', label: 'review', state: 'working', startedAt: 10_000 },
  { id: 'b', label: 'tests', state: 'working', startedAt: 10_000 }
]
const FINISHED: NativeChatSubagentEntry[] = [
  { id: 'a', label: 'review', state: 'completed', startedAt: 0, settledAt: 60_000, tokens: 9_000 },
  { id: 'b', label: 'tests', state: 'failed', startedAt: 0, settledAt: 62_000, tokens: 3_000 }
]

function byTestId(node: ReactTestInstance, testID: string): boolean {
  return typeof node.type === 'string' && node.props.testID === testID
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(3).filter(Boolean))

describe('mobile transcript roster row', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    message: NativeChatMessage,
    props: Record<string, unknown> = {},
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatMessage message={message} {...props} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  const markdown = (tree: ReactTestRenderer): unknown[] =>
    tree.root.findAll((node) => String(node.type) === 'MobileMarkdown').map((n) => n.props.content)
  const group = (tree: ReactTestRenderer): ReactTestInstance[] =>
    tree.root.findAll((node) => byTestId(node, 'subagent-group'))
  const header = (tree: ReactTestRenderer): ReactTestInstance =>
    group(tree)[0]!.findAll((node) => String(node.type) === 'Pressable')[0]!

  it("draws the host's live group in place of its frozen sentence", () => {
    const tree = render(roster(WORKING))
    expect(markdown(tree)).toEqual([])
    expect(group(tree)).toHaveLength(1)
    expect(textOf(group(tree)[0]!)).toBe('Kicked off 2 subagents2 working · 1m 0s')
    // The headline shimmers while a child works, as the agent run's label does.
    expect(tree.root.find((node) => String(node.type) === 'Shimmer').props.active).toBe(true)
  })

  it('reads the settled verdict, run length and tokens, and stops shimmering', () => {
    const tree = render(roster(FINISHED, 'Ran 2 subagents (1 failed)'))
    expect(markdown(tree)).toEqual([])
    expect(textOf(group(tree)[0]!)).toBe('Ran 2 subagents1 failed · 1m 2s · 12k tokens')
    expect(tree.root.find((node) => String(node.type) === 'Shimmer').props.active).toBe(false)
  })

  it('speaks the header whole, its clock only once the group stops counting', () => {
    expect(header(render(roster(WORKING))).props.accessibilityLabel).toBe(
      'Kicked off 2 subagents · 2 working'
    )
    const alerted: NativeChatSubagentEntry[] = [
      ...WORKING,
      { id: 'c', label: 'lint', state: 'failed', startedAt: 0, settledAt: 5_000 }
    ]
    expect(header(render(roster(alerted))).props.accessibilityLabel).toBe(
      'Kicked off 3 subagents · 2 working +1 failed'
    )
    expect(header(render(roster(FINISHED))).props.accessibilityLabel).toBe(
      'Ran 2 subagents · 1 failed · 1m 2s · 12k tokens'
    )
  })

  it('keeps the sentence when there is no group it can draw', () => {
    const textOnly: NativeChatMessage = {
      id: 'spawn',
      role: 'system',
      blocks: [{ type: 'text', text: 'Ran 2 subagents' }],
      timestamp: null,
      source: 'transcript'
    }
    expect(markdown(render(textOnly))).toEqual(['Ran 2 subagents'])
    const childless = render(roster([], 'Ran 2 subagents'))
    expect(markdown(childless)).toEqual(['Ran 2 subagents'])
    expect(group(childless)).toEqual([])
  })

  it('draws a one-child group with bare words', () => {
    const tree = render(
      roster([{ id: 'a', label: 'review', state: 'completed', startedAt: 0, settledAt: 3_000 }], null)
    )
    expect(textOf(group(tree)[0]!)).toBe('Ran 1 subagentcompleted · 3s')
  })

  it('keeps a malformed roster from taking the row down, and keeps its sentence', () => {
    for (const broken of [
      { type: 'subagent-group', groupId: 'group-1' },
      { type: 'subagent-group', groupId: 'group-1', agents: 'two' },
      { type: 'subagent-group', groupId: 'group-1', agents: [{ id: 'a', label: 7, state: 'working' }] },
      { type: 'subagent-group', agents: WORKING }
    ]) {
      const message: NativeChatMessage = {
        id: 'spawn',
        role: 'system',
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a host row the phone never validated, as it arrives.
        blocks: [{ type: 'text', text: 'Kicked off 2 subagents' }, broken as never],
        timestamp: null,
        source: 'transcript'
      }
      const tree = render(message)
      expect(group(tree), JSON.stringify(broken)).toEqual([])
      expect(markdown(tree), JSON.stringify(broken)).toEqual(['Kicked off 2 subagents'])
    }
  })

  // Review of the port: the hidden sentence is not offered to Copy either.
  it('offers no Copy for the sentence the row no longer draws', () => {
    const tree = render(roster(WORKING))
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Copy message')).toEqual([])
  })

  it('keeps real text beside a group', () => {
    expect(markdown(render(roster(WORKING, 'Delegating the review.')))).toEqual([
      'Delegating the review.'
    ])
  })

  it('stays visible once its turn settles, outside the tool-run collapse', () => {
    const tree = render(roster(FINISHED, null), {
      structuredActivityUi: true,
      activeTurnIsWorking: false,
      turnExpanded: false
    })
    expect(group(tree)).toHaveLength(1)
  })

  it('lists each child when the transcript holds it open, and asks to toggle by group id', () => {
    const onToggleSubagentGroup = vi.fn()
    const closed = render(roster(FINISHED), { onToggleSubagentGroup })
    expect(closed.root.findAll((node) => byTestId(node, 'subagent-group-entry'))).toEqual([])
    act(() => header(closed).props.onPress())
    expect(onToggleSubagentGroup).toHaveBeenCalledWith('group-1')

    const open = render(roster(FINISHED), {
      subagentGroupsOpen: new Set(['group-1']),
      onToggleSubagentGroup
    })
    expect(open.root.findAll((node) => byTestId(node, 'subagent-group-entry')).map(textOf)).toEqual(
      ['reviewcompleted · 9k', 'testsfailed · 3k']
    )
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws its tones from the %s palette', (scheme, colors) => {
    const tree = render(roster(FINISHED), { subagentGroupsOpen: new Set(['group-1']) }, scheme)
    const verdict = group(tree)[0]!.findAll(
      (node) => String(node.type) === 'Text' && textOf(node).startsWith('1 failed')
    )[0]!
    expect(flat(verdict.props.style).color).toBe(colors.danger)
    const dots = tree.root
      .findAll((node) => byTestId(node, 'subagent-group-entry'))
      .map((entry) => flat(entry.findAll((node) => String(node.type) === 'View')[1]!.props.style))
    expect(dots.map((dot) => dot.backgroundColor)).toEqual([colors.textMuted, colors.danger])
  })
})

describe('transcript-held roster disclosure', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('opens a group by id and hands the open set to roster rows only', () => {
    const messages = [userMessage('ask'), roster(WORKING)]
    act(() => {
      renderer = create(createElement(Harness, { messages, enabled: true, isWorking: false }))
    })
    const disclosure = () => renderer!.root.findByType(Result).props.disclosure
    const rowFor = (index: number) => disclosure().resolveRow(index, messages[index]!)
    expect(rowFor(0).subagentGroupsOpen).toBeUndefined()
    expect(rowFor(1).subagentGroupsOpen?.has('group-1')).toBe(false)
    act(() => rowFor(1).onToggleSubagentGroup('group-1'))
    expect(rowFor(1).subagentGroupsOpen?.has('group-1')).toBe(true)
    act(() => rowFor(1).onToggleSubagentGroup('group-1'))
    expect(rowFor(1).subagentGroupsOpen?.has('group-1')).toBe(false)
  })

  it('forgets what was open when the chat it belongs to changes', () => {
    const messages = [userMessage('ask'), roster(WORKING)]
    act(() => {
      renderer = create(createElement(Harness, { messages, enabled: true, isWorking: false }))
    })
    const disclosure = () => renderer!.root.findByType(Result).props.disclosure
    act(() => disclosure().resolveRow(1, messages[1]!).onToggleSubagentGroup('group-1'))
    act(() => {
      renderer!.update(createElement(Harness, { messages, enabled: true, isWorking: false, scopeKey: 'other' }))
    })
    expect(disclosure().resolveRow(1, messages[1]!).subagentGroupsOpen?.has('group-1')).toBe(false)
  })
})
