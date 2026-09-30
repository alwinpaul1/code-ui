import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

// An agent message made only of tool calls still drew the Copy control after
// its last tool run. A tap copied nothing and gave no haptic, tint or notice:
// handleCopy found no prose and returned before the copy, so the control read
// as a dead button (review, 2026-09-30). A message with nothing to copy now
// draws no Copy control; one with prose is unchanged.

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
const TOOLS_ONLY = agentMessage([...bash('npm test'), ...bash('npm run build')])
const PROSE_AFTER_TOOLS = agentMessage([...bash('npm test'), { type: 'text', text: 'All green.' }])

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
        <MobileNativeChatMessage message={message} {...props} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const copyControls = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Copy message')
/** The labels of the Copy controls drawn, for a readable failure. */
const copyLabels = (root: ReactTestInstance): string[] =>
  copyControls(root).map((node) => String(node.props.accessibilityLabel))

beforeEach(() => {
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the Copy control of an agent message in a %s session', (scheme, palette) => {
  it('draws no Copy control under a message made only of tool calls', () => {
    const root = render(TOOLS_ONLY, scheme, { messageIndex: 3, onScrollToMessage: () => {} })
    expect(copyLabels(root)).toEqual([])
    // Its other control stays, in the theme's muted ink.
    const scroll = root.find(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Scroll this message to top'
    )
    expect(scroll.find((node) => String(node.type) === 'ArrowUp').props.color).toBe(palette.textMuted)
  })

  it('draws no Copy control, and no empty controls row, when the settled tools are folded away', () => {
    const root = render(TOOLS_ONLY, scheme, { structuredActivityUi: true, activeTurnIsWorking: false })
    expect(copyLabels(root)).toEqual([])
    expect(root.findAll((node) => String(node.type) === 'ArrowUp').length).toBe(0)
  })

  it('draws no Copy control for a message whose only text is blank', () => {
    const root = render(agentMessage([...bash('ls'), { type: 'text', text: '  \n ' }]), scheme)
    expect(copyLabels(root)).toEqual([])
  })

  it('keeps Copy under a message with prose, and copies that prose', async () => {
    const root = render(PROSE_AFTER_TOOLS, scheme)
    const [copy] = copyControls(root)
    expect(copy).toBeDefined()
    expect(copy!.find((node) => String(node.type) === 'Copy').props.color).toBe(palette.textMuted)
    await act(async () => copy!.props.onPress())
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('All green.')
    expect(flat(copy!.props.style({ pressed: false })).opacity ?? 1).not.toBe(0)
  })
})

// The same dead control on a sent prompt: an image-only prompt offered "Hold
// to copy" and a hold copied nothing.
describe('the hold-to-copy of a sent prompt', () => {
  const prompt = (blocks: NativeChatBlock[]): NativeChatMessage => ({
    id: 'u1',
    role: 'user',
    blocks,
    timestamp: null,
    source: 'transcript'
  })

  it.each(['light', 'dark'] as const)('offers no hold-to-copy on a prompt with no text, in %s', (scheme) => {
    const root = render(prompt([{ type: 'image-ref', path: '/tmp/shot.png' }]), scheme)
    const bubble = root.find(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Sent prompt'
    )
    expect(bubble.props.onLongPress).toBeUndefined()
    expect(bubble.props.accessibilityHint).toBeUndefined()
  })

  it('keeps hold-to-copy on a prompt with text', () => {
    const root = render(prompt([{ type: 'text', text: 'run the gate' }]), 'light')
    const bubble = root.find(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Sent prompt'
    )
    expect(bubble.props.onLongPress).toBeTypeOf('function')
    expect(bubble.props.accessibilityHint).toBe('Hold to copy')
  })
})
