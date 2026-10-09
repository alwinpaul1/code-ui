import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

// 2026-10-09, the Claude app and ours side by side: Claude draws its message
// actions once, at the END of the assistant's turn, left-aligned under the text.
// Ours drew copy and the scroll-up arrow right-aligned after EVERY assistant
// message of the turn, beside a tool row too ("Ran Show the new abstract…").

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, children) : null
  }
})
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
    Platform: { OS: 'android', Version: 34 },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
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
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

import * as Clipboard from 'expo-clipboard'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const bash = (command: string): NativeChatBlock[] => [
  { type: 'tool-call', name: 'Bash', input: { command } },
  { type: 'tool-result', output: 'ok' }
]
const agentMessage = (blocks: NativeChatBlock[]): NativeChatMessage => ({
  id: 'a1',
  role: 'assistant',
  blocks,
  timestamp: null,
  source: 'transcript'
})
const PROSE = agentMessage([{ type: 'text', text: 'All green.' }])
const PROSE_THEN_TOOLS = agentMessage([{ type: 'text', text: 'Checking.' }, ...bash('npm test')])
const TOOLS_THEN_PROSE = agentMessage([...bash('npm test'), { type: 'text', text: 'All green.' }])
const TOOLS_ONLY = agentMessage(bash('npm test'))

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null

function render(
  message: NativeChatMessage,
  scheme: 'light' | 'dark',
  props: Partial<Parameters<typeof MobileNativeChatMessage>[0]> = {}
): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatMessage message={message} messageIndex={2} onScrollToMessage={() => {}} {...props} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const control = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
  root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)
const copyControls = (root: ReactTestInstance) => control(root, 'Copy message')
const upControls = (root: ReactTestInstance) => control(root, 'Scroll this message to top')

/** Every ancestor of a node, nearest first. */
function ancestors(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = []
  for (let up = node.parent; up; up = up.parent) {
    out.push(up)
  }
  return out
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the actions under an agent message in a %s session', (scheme, palette) => {
  it('draw once, after the last block of the turn, with copy and the scroll-up arrow both kept', () => {
    const root = render(TOOLS_THEN_PROSE, scheme, { endsTurn: true })
    expect(copyControls(root)).toHaveLength(1)
    expect(upControls(root)).toHaveLength(1)
    expect(copyControls(root)[0]!.find((node) => String(node.type) === 'Copy').props.color).toBe(palette.textMuted)
    expect(upControls(root)[0]!.find((node) => String(node.type) === 'ArrowUp').props.color).toBe(palette.textMuted)
  })

  it('draw nowhere on a message the turn goes on past', () => {
    for (const message of [PROSE, PROSE_THEN_TOOLS, TOOLS_THEN_PROSE, TOOLS_ONLY]) {
      const root = render(message, scheme, { endsTurn: false })
      expect(copyControls(root)).toHaveLength(0)
      expect(upControls(root)).toHaveLength(0)
      act(() => renderer?.unmount())
    }
  })

  it('stand left-aligned under the text, not right-aligned at the edge', () => {
    for (const message of [PROSE, TOOLS_THEN_PROSE, TOOLS_ONLY]) {
      const root = render(message, scheme, { endsTurn: true })
      const copyOrUp = (copyControls(root)[0] ?? upControls(root)[0])!
      const justifications = ancestors(copyOrUp)
        .map((node) => flat(node.props.style).justifyContent)
        .filter((value) => value !== undefined)
      expect(justifications).not.toContain('flex-end')
      expect(justifications[0]).toBe('flex-start')
      act(() => renderer?.unmount())
    }
  })

  it('sit under the tool run of a turn that ends on one, not inside its row', () => {
    const root = render(TOOLS_ONLY, scheme, { endsTurn: true })
    const up = upControls(root)[0]!
    const run = root.find((node) => node.props.testID === 'tool-run-header')
    // The run's own row held them at its right end; they are not in it now.
    expect(run.parent!.findAll((node) => node === up)).toHaveLength(0)
    // findAll walks the tree in document order: the run first, the actions after.
    const inOrder = root.findAll(
      (node) => node.props.testID === 'tool-run-header' || node === up
    )
    expect(inOrder.map((node) => (node === up ? 'actions' : 'run'))).toEqual(['run', 'actions'])
  })

  it('still draw no Copy for a message with no words, and keep the scroll-up arrow', () => {
    const root = render(TOOLS_ONLY, scheme, { endsTurn: true })
    expect(copyControls(root)).toHaveLength(0)
    expect(upControls(root)).toHaveLength(1)
  })

  it('still copy the message prose when pressed', async () => {
    const root = render(PROSE, scheme, { endsTurn: true })
    await act(async () => copyControls(root)[0]!.props.onPress())
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('All green.')
  })

  it('draw by default, so a chat that does not say where its turns end keeps its actions', () => {
    const root = render(PROSE, scheme)
    expect(copyControls(root)).toHaveLength(1)
  })
})

beforeEach(() => {
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
})
