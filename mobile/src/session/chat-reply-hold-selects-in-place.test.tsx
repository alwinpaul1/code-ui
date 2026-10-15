import type { ReactElement, ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// The user, 2026-10-15, with two screenshots: in the Claude app a hold on Claude's words goes
// straight into Android's selection (the word under the finger highlighted in clay, two clay
// handles, a floating "Copy | Select all" bar); in Code UI the same hold opened a card with
// "Copy" and "Select text". "I need the exact hold and copy from claude mobile."
//
// com.anthropic.claude 1.261013.20 (decompiled): a text block of a Code-session message is drawn
// by gy30.j, which wraps a parsed text block (`tpy` with its Markdown, `z82`) in t8i.o, the
// app's SelectionContainer (z530.k: SelectionRegistrar `slu`, SelectionManager `ilu`). Each text
// block is one selection: its paragraphs and list items select together. Tool rows and thoughts
// are drawn outside it. A sent prompt's bubble (gy30.d, through hpq) has no SelectionContainer:
// a hold on it opens the message menu (Copy, Select text), which Code UI keeps.

vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): ReactNode =>
    React.createElement('Text', props, children)
  // processColor stands in for Android's colour ints: each colour gets a number, kept to read back.
  const colours: string[] = []
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
    ActivityIndicator: 'ActivityIndicator',
    Image: Object.assign(() => null, { getSize: () => undefined }),
    Linking: { openURL: () => Promise.resolve() },
    Modal: ({ children, ...props }: { children?: ReactNode }) => React.createElement('Modal', props, children),
    PixelRatio: { getFontScale: () => 1 },
    Platform: { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    processColor: (colour: string) => {
      if (!colours.includes(colour)) {
        colours.push(colour)
      }
      return colours.indexOf(colour) + 1
    },
    __colours: colours,
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaSelectionCopy' ? {} : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('../components/markdown-selection-copy', () => import('../components/markdown-selection-copy.android'))
vi.mock('./use-native-chat-screen-focus', () => ({ useNativeChatScreenFocus: () => undefined }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }))
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
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))

import * as ReactNative from 'react-native'
import { ChatTextHoldSelectsContext } from '../components/chat-text-selectable-context'
import { chatSelectionColors } from '../components/chat-selection-colors'
import { triggerMediumImpact } from '../platform/haptics'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'
const colourOf = (int: unknown): string | undefined =>
  typeof int === 'number' ? (ReactNative as unknown as { __colours: string[] }).__colours[int - 1] : undefined

const REPLY = ['First paragraph of the reply.', '', 'Second, with **bold** words.', '', '- one item', '- another item'].join(
  '\n'
)

const message = (role: NativeChatMessage['role'], blocks: NativeChatMessage['blocks'], id = `${role}-1`): NativeChatMessage => ({
  id,
  role,
  blocks,
  timestamp: null,
  source: 'transcript'
})
const text = (role: NativeChatMessage['role'], words: string): NativeChatMessage => message(role, [{ type: 'text', text: words }])

const words = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(words).join('')

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function tree(row: NativeChatMessage, scheme: 'light' | 'dark', listAtRest: boolean): ReactElement {
  return (
    <ThemeProvider initialPreference={scheme}>
      <ChatTextHoldSelectsContext.Provider value={listAtRest}>
        <MobileNativeChatMessage message={row} />
      </ChatTextHoldSelectsContext.Provider>
    </ThemeProvider>
  )
}

function render(row: NativeChatMessage, scheme: 'light' | 'dark' = 'light', listAtRest = true): ReactTestInstance {
  act(() => {
    renderer = create(tree(row, scheme, listAtRest))
  })
  return renderer!.root
}

/** What would take a hold before Android's selection: a Pressable with a long press. */
const holdTargets = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll((node) => String(node.type) === 'Pressable' && typeof node.props.onLongPress === 'function')
const selectableTexts = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll((node) => String(node.type) === 'Text' && node.props.selectable === true)
/** The selectable Text a hold on `first` starts in, if its selection can run on to `last`. */
const proseHolding = (root: ReactTestInstance, first: string, last: string): ReactTestInstance | undefined =>
  selectableTexts(root).find((node) => words(node).includes(first) && words(node).includes(last))
const nativeRoots = (root: ReactTestInstance): ReactTestInstance[] => root.findAllByType(NATIVE_ROOT as never)
const menu = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll((node) => node.props.testID === 'message-menu' && typeof node.type === 'string')

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('holding a Claude reply in a %s session', (scheme, palette) => {
  it('selects text in place instead of opening a menu', () => {
    const root = render(text('assistant', REPLY), scheme)
    // Nothing above the words takes the hold first, so Android's own selection starts on it.
    expect(holdTargets(root).length).toBe(0)
    // One hold can drag from the first paragraph to the last list item: one selection per block.
    expect(proseHolding(root, 'First paragraph', 'another item')).toBeDefined()
    expect(nativeRoots(root)[0]?.props.holdSelects).toBe(true)
    expect(menu(root).length).toBe(0)
  })

  it('draws the handles in the theme accent and the highlight in the accent at 40%', () => {
    const root = render(text('assistant', REPLY), scheme)
    const nativeRoot = nativeRoots(root)[0]
    expect(nativeRoot).toBeDefined()
    const expected = chatSelectionColors(palette)
    expect(colourOf(nativeRoot!.props.selectionHandleColor)).toBe(palette.accent)
    expect(colourOf(nativeRoot!.props.selectionHighlightColor)).toBe(expected.highlight)
  })
})

describe('each kind of row takes a hold as the Claude app does', () => {
  it('selects a reply with a code fence and a table in place, with no menu', () => {
    const root = render(text('assistant', 'Run:\n\n```sh\nnpm test\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'))
    expect(holdTargets(root).length).toBe(0)
    expect(selectableTexts(root).some((node) => words(node).includes('Run:'))).toBe(true)
    expect(selectableTexts(root).some((node) => words(node).includes('npm test'))).toBe(true)
  })

  it('selects inline code with the words around it', () => {
    const root = render(text('assistant', 'Run `pnpm test` before you push.'))
    expect(proseHolding(root, 'Run', 'before you push.')).toBeDefined()
  })

  it('keeps the menu on a sent prompt, and nothing in its bubble selects in place', () => {
    const root = render(text('user', 'run the gate\n\n- then **push**'))
    expect(holdTargets(root)).toHaveLength(1)
    expect(selectableTexts(root).map(words)).toEqual([])
  })

  it('draws a reply’s tool rows outside the selection: only its words select', () => {
    const root = render(
      message('assistant', [
        { type: 'text', text: 'Listing the files.' },
        { type: 'tool-call', name: 'Bash', input: { command: 'ls -la' } },
        { type: 'tool-result', output: 'total 0' },
        { type: 'text', text: 'Done.' }
      ])
    )
    expect(holdTargets(root).length).toBe(0)
    const selected = selectableTexts(root).map(words)
    expect(selected.some((line) => line.includes('Listing the files.'))).toBe(true)
    expect(selected.some((line) => line.includes('Done.'))).toBe(true)
    expect(selected.some((line) => line.includes('ls -la'))).toBe(false)
  })

  it('gives a thought neither a selection in place nor a menu', () => {
    const root = render(text('reasoning', 'Thinking about it.'))
    expect(holdTargets(root).length).toBe(0)
    expect(selectableTexts(root).map(words)).toEqual([])
  })
})

describe('a scroll never starts a selection in a reply', () => {
  it('tells the reply’s native root a hold may not start one while the list scrolls', () => {
    const root = render(text('assistant', REPLY), 'light', false)
    expect(nativeRoots(root)[0]?.props.holdSelects).toBe(false)
    // The words stay selectable, so a selection already open is not ended by the scroll.
    expect(proseHolding(root, 'First paragraph', 'another item')).toBeDefined()
    expect(triggerMediumImpact).not.toHaveBeenCalled()
  })
})

describe('sizes at the edges', () => {
  it('gives an empty reply nothing to select and nothing to hold', () => {
    for (const empty of ['', '   \n\n  ']) {
      const root = render(text('assistant', empty))
      expect(holdTargets(root).length).toBe(0)
      expect(selectableTexts(root).filter((node) => words(node).trim() !== '')).toEqual([])
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('selects a one-word reply in place', () => {
    const root = render(text('assistant', 'Done.'))
    expect(holdTargets(root).length).toBe(0)
    expect(proseHolding(root, 'Done.', 'Done.')).toBeDefined()
  })
})
