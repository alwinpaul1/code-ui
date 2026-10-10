import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  MobileNativeChatVisualContext,
  type MobileNativeChatVisualRender
} from './mobile-native-chat-visual-context'

// Orca #26071: which rows of the phone's chat draw `::orca-visual` lines, and which block of a
// live reply holds back a directive still being typed.

vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown =>
    React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
      Text,
      Value: class {
        setValue(): void {}
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

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const renderVisual: MobileNativeChatVisualRender = () => 'visual'

function message(id: string, role: NativeChatMessage['role'], text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

describe('MobileNativeChatMessage visuals', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function markdownProps(
    row: NativeChatMessage,
    options: {
      visuals?: MobileNativeChatVisualRender | null
      activeTurnIsWorking?: boolean
      mayStillGrow?: boolean
      promptsAsMarkdown?: boolean
    } = {}
  ): Record<string, unknown> {
    act(() => {
      renderer = create(
        createElement(
          MobileNativeChatVisualContext.Provider,
          { value: options.visuals === undefined ? renderVisual : options.visuals },
          createElement(MobileNativeChatMessage, {
            message: row,
            activeTurnIsWorking: options.activeTurnIsWorking,
            mayStillGrow: options.mayStillGrow ?? true,
            promptsAsMarkdown: options.promptsAsMarkdown
          })
        )
      )
    })
    return renderer!.root.find((node) => String(node.type) === 'MobileMarkdown').props
  }

  it("renders a finished assistant reply's directives through the transcript renderer", () => {
    const props = markdownProps(message('a1', 'assistant', '::orca-visual{file="a.html"}'))
    expect(props.renderVisual).toBe(renderVisual)
    expect(props.content).toBe('::orca-visual{file="a.html"}')
  })

  it('hides a directive still being typed while its turn works, and mounts finished lines', () => {
    const props = markdownProps(
      message(
        'a1',
        'assistant',
        '::orca-visual{file="done.html"}\nChart below.\n::orca-visual{file="usage"}'
      ),
      { activeTurnIsWorking: true }
    )
    expect(props.renderVisual).toBe(renderVisual)
    expect(props.content).toBe('::orca-visual{file="done.html"}\nChart below.\n')
  })

  it('shows an earlier finished row of a working turn in full', () => {
    const text = 'Pick one:\n::orca-visual{file="options.html"}'
    expect(
      markdownProps(message('a0', 'assistant', text), {
        activeTurnIsWorking: true,
        mayStillGrow: false
      }).content
    ).toBe(text)
  })

  it('holds back only the last block of the row: text followed by a tool call is finished', () => {
    const text = 'Options:\n::orca-visual{file="options'
    const row: NativeChatMessage = {
      id: 'a1',
      role: 'assistant',
      blocks: [
        { type: 'text', text },
        { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } }
      ],
      timestamp: null,
      source: 'transcript'
    }
    expect(markdownProps(row, { activeTurnIsWorking: true }).content).toBe(text)
  })

  it('shows the whole reply once its turn settles', () => {
    const text = 'Chart below.\n::orca-visual{file="usage'
    expect(markdownProps(message('a1', 'assistant', text)).content).toBe(text)
  })

  it('leaves directives as text where the chat has no visual source', () => {
    const props = markdownProps(message('a1', 'assistant', '::orca-visual{file="a.html"}'), {
      visuals: null,
      activeTurnIsWorking: true
    })
    expect(props.renderVisual).toBeUndefined()
    expect(props.content).toBe('::orca-visual{file="a.html"}')
  })

  it('never renders visuals in system rows', () => {
    const props = markdownProps(message('s1', 'system', '::orca-visual{file="a.html"}'))
    expect(props.renderVisual).toBeUndefined()
  })

  it('never renders visuals in a user row, even one drawn as Markdown', () => {
    const props = markdownProps(message('u1', 'user', '::orca-visual{file="a.html"}'), {
      promptsAsMarkdown: true
    })
    expect(props.renderVisual).toBeUndefined()
  })
})
