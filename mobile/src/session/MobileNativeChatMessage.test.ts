import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOOL_DETAIL_LENGTH } from '../../../src/shared/native-chat-tool-summary'
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
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

function userMessage(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'u1', role: 'user', blocks, timestamp: null, source: 'transcript' }
}

function toolMessage(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'a1', role: 'assistant', blocks, timestamp: null, source: 'transcript' }
}

describe('MobileNativeChatMessage', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    message: NativeChatMessage,
    props: Omit<Parameters<typeof MobileNativeChatMessage>[0], 'message'> = {}
  ): ReactTestRenderer {
    act(() => {
      renderer = create(createElement(MobileNativeChatMessage, { message, ...props }))
    })
    return renderer!
  }

  const textIn = (node: ReactTestInstance): string[] =>
    node.findAllByType('Text' as never).map((text) => String(text.children.join('')))

  it('lets the reader select the text of their own sent prompt', () => {
    // Why: reported 2026-09-12 — press-and-hold on a sent prompt selected
    // nothing, while an agent's answer selected. Only the agent side was
    // ever marked selectable.
    const tree = render(userMessage([{ type: 'text', text: 'run the full gate' }]))
    const selectable = tree.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.selectable === true)
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
    expect(selectable).toContain('run the full gate')
  })

  it('offers a copy control on a sent prompt when it is tapped, never on a queued one', () => {
    const sent = render(userMessage([{ type: 'text', text: 'record' }]))
    expect(sent.root.findAllByProps({ accessibilityLabel: 'Copy prompt' })).toHaveLength(0)

    act(() => {
      sent.root.findByProps({ accessibilityLabel: 'Sent prompt' }).props.onPress()
    })
    expect(sent.root.findAllByProps({ accessibilityLabel: 'Copy prompt' }).length).toBeGreaterThan(0)
    act(() => sent.unmount())

    const queued = render(userMessage([{ type: 'text', text: 'record' }]), {
      onCancelQueued: vi.fn()
    })
    expect(queued.root.findAllByProps({ accessibilityLabel: 'Sent prompt' })).toHaveLength(0)
    expect(queued.root.findAllByProps({ accessibilityLabel: 'Copy prompt' })).toHaveLength(0)
  })

  it('renders a loadable preview URI as an image thumbnail', () => {
    const tree = render(userMessage([{ type: 'image-ref', url: 'file:///a.jpg', alt: 'a photo' }]))
    const image = tree.root.findByType('Image' as never)
    expect(image.props.source).toEqual({ uri: 'file:///a.jpg' })
    expect(image.props.accessibilityLabel).toBe('a photo')
  })

  it('prefers the url over the path when both are present', () => {
    const tree = render(
      userMessage([{ type: 'image-ref', url: 'file:///local.jpg', path: '/tmp/host.png' }])
    )
    expect(tree.root.findByType('Image' as never).props.source).toEqual({
      uri: 'file:///local.jpg'
    })
  })

  it('shows an image chip, never the raw host path, for an unloadable image', () => {
    // A host temp path (a desktop paste, or an SSH host) is not loadable on the
    // device until the host grants it; the bubble must not print the path.
    const tree = render(userMessage([{ type: 'image-ref', path: '/tmp/host.png' }]))
    expect(tree.root.findAllByType('Image' as never)).toHaveLength(0)
    const texts = tree.root
      .findAllByType('Text' as never)
      .map((node) => String(node.children.join('')))
    expect(texts.some((text) => text.includes('/tmp/host.png'))).toBe(false)
    expect(texts).toContain('Image')
  })

  it('does not send inaccessible desktop paste paths through the failing file opener', () => {
    const onOpenFile = vi.fn()
    const tree = render(
      userMessage([
        {
          type: 'image-ref',
          path: '/var/folders/0y/session/T/orca-paste-1788732989689-c9b48721-60fe-4649-9ee3-a1369133656b.png'
        }
      ]),
      { onOpenFile }
    )
    expect(textIn(tree.root)).toContain('Image on Desktop')
    // The bubble itself is tappable (it discloses the copy control); the
    // image chip must not be.
    expect(
      tree.root
        .findAllByType('Pressable')
        .filter((node) => node.props.onPress && node.props.accessibilityLabel !== 'Sent prompt')
    ).toHaveLength(0)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('labels a tool row with the target path instead of raw input JSON', () => {
    const tree = render(
      toolMessage([{ type: 'tool-call', name: 'Read', input: { file_path: 'src/index.ts' } }]),
      { toolsExpanded: true }
    )
    const texts = textIn(tree.root)
    expect(texts).toContain('src/index.ts')
    expect(texts.some((text) => text.includes('"file_path":"src/index.ts"'))).toBe(false)
  })

  it('bounds expanded diff-less tool input before native text layout', () => {
    const tree = render(
      toolMessage([
        { type: 'tool-call', name: 'CustomTool', input: { payload: 'x'.repeat(100_000) } }
      ]),
      { toolsExpanded: true }
    )
    const detail = textIn(tree.root).find((text) => text.startsWith('{\n'))
    expect(detail).toHaveLength(MAX_TOOL_DETAIL_LENGTH + 1)
    expect(detail?.endsWith('…')).toBe(true)
  })

  it('expands formatted detail for a collapsed JSON-string tool input', () => {
    const tree = render(
      toolMessage([
        {
          type: 'tool-call',
          name: 'CustomTool',
          input: '{"cmd":"git status","description":"Inspect changes"}'
        }
      ])
    )
    // Innermost match, not the first: the run header now prints each member's
    // name as its own text node (#19372), so it answers to a tool name too. The
    // header comes first in tree order and the tool line after it.
    const pressableWith = (label: string): ReactTestInstance =>
      tree.root
        .findAllByType('Pressable' as never)
        .findLast((node) => textIn(node).includes(label))!

    act(() => pressableWith('Used a tool').props.onPress())
    // The row label is the command, and the detail stays closed until tapped.
    expect(textIn(tree.root)).toContain('git status')
    expect(textIn(tree.root).some((text) => text.startsWith('{\n'))).toBe(false)

    act(() => pressableWith('CustomTool').props.onPress())
    expect(textIn(tree.root)).toContain(
      '{\n  "cmd": "git status",\n  "description": "Inspect changes"\n}'
    )
  })

  it('does not echo the row label as detail when a row has nothing to expand', () => {
    // The Tools toggle opens every row at once, bypassing the tap guard — a row
    // whose formatted input is its own label would echo itself in a panel that
    // no tap can dismiss.
    const tree = render(toolMessage([{ type: 'tool-call', name: 'ListTodos', input: '{}' }]), {
      toolsExpanded: true
    })
    expect(textIn(tree.root).filter((text) => text === '{}')).toHaveLength(1)
    // The chevron has to agree with the panel, or the row claims to be open over
    // nothing and the tap that would close it is guarded off. Only the run header
    // is open here; the row itself stays collapsed.
    expect(tree.root.findAllByType('ChevronDown' as never)).toHaveLength(1)
    expect(tree.root.findAllByType('ChevronRight' as never)).toHaveLength(1)
  })

  it('does not expand a plain input that already fits in the row label', () => {
    const input = 'x'.repeat(60)
    const tree = render(toolMessage([{ type: 'tool-call', name: 'CustomTool', input }]), {
      toolsExpanded: true
    })
    expect(textIn(tree.root).filter((text) => text === input)).toHaveLength(1)
    expect(tree.root.findAllByType('ChevronDown' as never)).toHaveLength(1)
    expect(tree.root.findAllByType('ChevronRight' as never)).toHaveLength(1)
  })

  describe('the structured lane', () => {
    const settledRun: NativeChatMessage['blocks'] = [
      { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'failed' },
      { type: 'tool-result', output: '1 failing', isError: true }
    ]

    it('hangs the turn status under the user message it belongs to', () => {
      const tree = render(userMessage([{ type: 'text', text: 'go' }]), {
        structuredActivityUi: true,
        turnStatus: { startedAt: 1_000, thinking: false, workedSeconds: 184 },
        turnKey: 'u1',
        onToggleTurn: vi.fn()
      })
      expect(textIn(tree.root)).toContain('Worked for 3m 4s')
    })

    it("does not leave a settled turn's failed command reading as a failed reply", () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false
      })
      // The run is behind the turn caret now, not loose in the transcript.
      expect(textIn(tree.root).join(' ')).not.toContain('pnpm test')
    })

    it('brings that run back the moment the turn caret discloses it', () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false,
        turnExpanded: true
      })
      expect(textIn(tree.root).join(' ')).toContain('pnpm test')
    })

    it('still answers the global Tools toggle on a settled turn', () => {
      const tree = render(toolMessage(settledRun), {
        structuredActivityUi: true,
        activeTurnIsWorking: false,
        toolsExpanded: true
      })
      expect(textIn(tree.root).join(' ')).toContain('pnpm test')
    })

    it('keeps the run visible while the turn is still working', () => {
      const running: NativeChatMessage['blocks'] = [
        { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'running' }
      ]
      const tree = render(toolMessage(running), {
        structuredActivityUi: true,
        activeTurnIsWorking: true
      })
      expect(textIn(tree.root)).toContain('Running')
    })

    it('leaves the bridge lane exactly as it was', () => {
      const tree = render(toolMessage(settledRun), { activeTurnIsWorking: false })
      expect(textIn(tree.root).some((text) => text.startsWith('Ran '))).toBe(true)
      expect(textIn(tree.root).some((text) => text.startsWith('Running'))).toBe(false)
    })
  })
})
