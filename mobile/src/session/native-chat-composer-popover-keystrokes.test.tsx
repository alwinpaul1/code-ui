import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'

// 2026-09-26, Samsung S23 Ultra, Samsung keyboard: "After typing the @ or /
// symbol I lost the input to the keyboard, and no more keystrokes appeared
// until I clicked the input bar again." The recording shows the keyboard's
// toolbar greying out (its editor gone) on the very frame the @ or / menu
// opened or closed, the caret leaving the field, and e/d/j/u keys drawing
// their preview bubbles while the field stayed `@` or `/ndn`. The keyboard
// stayed up the whole time; a tap on the field brought the keys back.
//
// Cause: the fold wrapper around the input set `overflow: 'hidden'` only while
// the menu was up. In Fabric that one style decides whether the wrapper keeps
// its children or hands them to its parent (a view with only a testID is
// created but flattens its children; clipping makes it a stacking context
// that holds them). So every open and close moved the native EditText to a
// different parent, and Android drops focus and the keyboard's connection
// when a focused view is removed from its parent.

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    // Renders every row eagerly so assertions can see the whole suggestion list.
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
      ...props
    }: {
      data: readonly unknown[]
      renderItem: (info: { item: unknown; index: number }) => unknown
      keyExtractor: (item: unknown) => string
    }) =>
      React.createElement(
        'FlatList',
        { ...props, rowCount: data.length },
        data.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: keyExtractor(item) },
            renderItem({ item, index }) as React.ReactNode
          )
        )
      ),
    Image: 'Image',
    Keyboard: {
      dismiss: vi.fn(),
      isVisible: () => true,
      addListener: () => ({ remove: () => {} })
    },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1
    },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Code: 'Code',
  Hand: 'Hand',
  Image: 'Image',
  ImagePlus: 'ImagePlus',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Zap: 'Zap',
  Plus: 'Plus',
  Square: 'Square',
  X: 'X'
}))

vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})

type Scheme = 'light' | 'dark'
type HostNode = ReactTestRendererJSON
type Style = Record<string, unknown>

/** Every prop Fabric parses into ViewEvents; any of them makes a stacking context. */
const VIEW_EVENT_PROP =
  /^on(Click|Pointer|Touch|Responder|StartShouldSetResponder|MoveShouldSetResponder|ShouldBlockNativeResponder)/

function flattenStyle(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle)) as Style
  }
  return style && typeof style === 'object' ? (style as Style) : {}
}

/** `formsStackingContext` from ViewShadowNode::initialize, React Native 0.86.3
 *  (ReactCommon/react/renderer/components/view/ViewShadowNode.cpp), plus the
 *  Android host trait (`elevation`). Only a View that forms one keeps its
 *  children as its own native subviews; any other View's children are
 *  flattened into the nearest ancestor that does
 *  (mounting/internal/sliceChildShadowNodeViewPairs.cpp, `areChildrenFlattened`). */
function formsStackingContext(props: Record<string, unknown>): boolean {
  const style = flattenStyle(props.style)
  const pointerEvents = props.pointerEvents ?? style.pointerEvents
  const transform = style.transform
  return (
    props.collapsable === false ||
    pointerEvents === 'none' ||
    pointerEvents === 'box-only' ||
    Boolean(props.nativeID) ||
    props.accessible === true ||
    (style.opacity !== undefined && style.opacity !== 1) ||
    (Array.isArray(transform) ? transform.length > 0 : Boolean(transform)) ||
    // RN's default position is relative, so any zIndex counts unless static.
    (style.zIndex !== undefined && style.position !== 'static') ||
    style.display === 'none' ||
    (style.overflow !== undefined && style.overflow !== 'visible') ||
    Object.keys(props).some((key) => VIEW_EVENT_PROP.test(key)) ||
    (style.shadowColor !== undefined && style.shadowColor !== 'transparent') ||
    props.accessibilityElementsHidden === true ||
    props.accessibilityViewIsModal === true ||
    (props.importantForAccessibility !== undefined && props.importantForAccessibility !== 'auto') ||
    props.removeClippedSubviews === true ||
    (style.cursor !== undefined && style.cursor !== 'auto') ||
    Boolean(style.filter) ||
    (style.mixBlendMode !== undefined && style.mixBlendMode !== 'normal') ||
    style.isolation === 'isolate' ||
    (style.elevation !== undefined && style.elevation !== 0) ||
    (Array.isArray(props.accessibilityOrder) && props.accessibilityOrder.length > 0)
  )
}

/** The mocked host tags are plain strings React's element types do not list. */
function isHost(node: { type: unknown }, tag: string): boolean {
  return node.type === tag
}

function hostChildren(node: HostNode): HostNode[] {
  return (node.children ?? []).filter((child): child is HostNode => typeof child !== 'string')
}

function pathTo(node: HostNode, type: string): HostNode[] | null {
  if (node.type === type) {
    return [node]
  }
  for (const child of hostChildren(node)) {
    const found = pathTo(child, type)
    if (found) {
      return [node, ...found]
    }
  }
  return null
}

/** Which element Android mounts the EditText under: the nearest ancestor View
 *  that keeps its children (or any non-View host, which always does). */
function nativeParentOfInput(renderer: ReactTestRenderer): string {
  const tree = renderer.toJSON()
  const roots = tree === null ? [] : Array.isArray(tree) ? tree : [tree]
  const path = roots.map((root) => pathTo(root, 'TextInput')).find((found) => found !== null)
  if (!path) {
    throw new Error('The composer rendered no TextInput')
  }
  for (let index = path.length - 2; index >= 0; index -= 1) {
    const ancestor = path[index]!
    const parent = index > 0 ? path[index - 1] : undefined
    const keepsChildren =
      ancestor.type !== 'View' ||
      formsStackingContext(ancestor.props) ||
      parent?.props.collapsableChildren === false
    if (keepsChildren) {
      const testID = ancestor.props.testID
      return typeof testID === 'string' ? testID : `${ancestor.type} at depth ${index}`
    }
  }
  return 'outside the composer'
}

type Step = { type: string } | { files: readonly string[] }

// Paths the recording's @ menu listed (host workspace, 2026-09-26).
const WORKSPACE_ROOT_FILES = [
  '.claude/scheduled_tasks.lock',
  '.claude/settings.local.json',
  '.claude/worktrees/agent-a985b23511f87b72/mobile/src/session/MobileNativeChatComposer.tsx',
  '.claude/worktrees/agent-a985b23511f87b72/mobile/src/session/MobileNativeChatView.tsx'
]
// One row: the degenerate menu, first row and last row the same.
const FILES_FOR_EJ = ['.claude/worktrees/ask-submit-tap/mobile/src/session/reject-ask.ts']

/** The @ half of the recording: `@` opens the menu, `e` filters it, `j`
 *  matches nothing until the desktop's search answers, backspace walks back
 *  through a reopen to an empty field. */
const AT_MENU_STEPS: Step[] = [
  { type: '@' },
  { files: WORKSPACE_ROOT_FILES },
  { type: '@e' },
  { type: '@ej' },
  { files: FILES_FOR_EJ },
  { type: '@e' },
  { files: [] },
  { files: WORKSPACE_ROOT_FILES },
  { type: '@' },
  { type: '' }
]

/** The / half: `/` opens the menu, `n` and `d` filter it, and the second `n`
 *  leaves nothing to match. Then the keys the recording lost. */
const SLASH_MENU_STEPS: Step[] = [
  { type: '/' },
  { type: '/n' },
  { type: '/nd' },
  { type: '/ndn' },
  { type: '/ndnj' },
  { type: '/ndnju' },
  { type: '/ndnjud' }
]

type Harness = {
  renderer: ReactTestRenderer
  run: (step: Step) => Promise<void>
  input: () => { props: Record<string, unknown> }
  menuOpen: () => boolean
  inputMounts: () => number
  typed: () => string
}

let mounted: ReactTestRenderer | null = null

afterEach(() => {
  act(() => mounted?.unmount())
  mounted = null
})

async function mountComposer(scheme: Scheme, initialFiles: readonly string[] = []): Promise<Harness> {
  let setFiles: (files: readonly string[]) => void = () => {}
  let lastTyped = ''
  let inputMounts = 0

  function Host(): React.JSX.Element {
    const [value, setValue] = useState('')
    const [files, setFilesState] = useState<readonly string[]>(initialFiles)
    setFiles = setFilesState
    return createElement(MobileNativeChatComposer, {
      value,
      onChangeText: setValue,
      onSend: async () => true,
      sendSurfaceId: 'tab-a',
      getSendCompletionGeneration: () => 0,
      getComposerEditGeneration: () => 0,
      agent: 'claude',
      filePaths: files as string[],
      onNeedFiles: () => {},
      onAttachImage: () => {}
    })
  }

  await act(async () => {
    mounted = create(
      <ThemeProvider initialPreference={scheme}>
        <Host />
      </ThemeProvider>,
      {
        createNodeMock: (element) => {
          if (element.type === 'TextInput') {
            inputMounts += 1
          }
          return { focus: () => {}, blur: () => {}, isFocused: () => true, setNativeProps: () => {} }
        }
      }
    )
  })
  const renderer = mounted!
  const input = () => renderer.root.find((node) => isHost(node, 'TextInput'))

  const run = async (step: Step): Promise<void> => {
    if ('files' in step) {
      await act(async () => setFiles(step.files))
      return
    }
    lastTyped = step.type
    const props = input().props as {
      onChangeText: (text: string) => void
      onSelectionChange: (e: { nativeEvent: { selection: { start: number; end: number } } }) => void
    }
    // Android reports the text first, then the caret after it.
    await act(async () => props.onChangeText(step.type))
    await act(async () =>
      props.onSelectionChange({
        nativeEvent: { selection: { start: step.type.length, end: step.type.length } }
      })
    )
  }

  return {
    renderer,
    run,
    input,
    menuOpen: () => renderer.root.findAll((node) => node.props.testID === 'composer-suggestions').length > 0,
    inputMounts: () => inputMounts,
    typed: () => lastTyped
  }
}

describe('the flattening model these tests stand on', () => {
  // The model above is a copy of C++ in the installed React Native. An
  // upgrade that changes which views keep their children makes the model
  // wrong without failing anything else, so read the rule it copies.
  it('still matches the rule in the installed React Native', () => {
    const reactNative = path.dirname(
      createRequire(import.meta.url).resolve('react-native/package.json')
    )
    const read = (relative: string) =>
      readFileSync(path.join(reactNative, 'ReactCommon/react/renderer', relative), 'utf8')
    const viewTraits = read('components/view/ViewShadowNode.cpp')
    expect(viewTraits).toContain('bool formsStackingContext = !viewProps.collapsable ||')
    expect(viewTraits).toContain('viewProps.getClipsContentToBounds() ||')
    expect(viewTraits).toContain('!viewProps.testId.empty()')
    const slicing = read('mounting/internal/sliceChildShadowNodeViewPairs.cpp')
    expect(slicing.replace(/\s+/g, ' ')).toContain(
      'bool areChildrenFlattened = (!childShadowNode.getTraits().check( ShadowNodeTraits::Trait::FormsStackingContext) && !childrenFormStackingContexts)'
    )
  })
})

describe.each(['light', 'dark'] as const)('typing through the @ and / menus (%s)', (scheme) => {
  it.each([
    ['@', AT_MENU_STEPS],
    ['/', SLASH_MENU_STEPS]
  ] as const)(
    'keeps the keyboard attached to the input while the %s menu opens, filters, empties and closes',
    async (_trigger, steps) => {
      const harness = await mountComposer(scheme)
      const before = nativeParentOfInput(harness.renderer)
      const menuStates = new Set<boolean>([harness.menuOpen()])
      for (const step of steps) {
        await harness.run(step)
        menuStates.add(harness.menuOpen())
        expect(
          nativeParentOfInput(harness.renderer),
          `the input moved to a new native parent after ${JSON.stringify(step)}, menu ${harness.menuOpen() ? 'open' : 'closed'}; Android drops its focus and keyboard connection on that move`
        ).toBe(before)
      }
      // Not vacuous: the walk crossed both an open and a closed menu.
      expect([...menuStates].sort()).toEqual([false, true])
    }
  )
})

describe('the other ways a keystroke could be lost in the menus', () => {
  it('never remounts the input while the menu comes and goes', async () => {
    const harness = await mountComposer('light')
    for (const step of [...AT_MENU_STEPS, ...SLASH_MENU_STEPS]) {
      await harness.run(step)
    }
    expect(harness.inputMounts()).toBe(1)
  })

  it('never writes an older draft back into the input when a slow file search answers', async () => {
    const harness = await mountComposer('light')
    await harness.run({ type: '@' })
    await harness.run({ type: '@e' })
    await harness.run({ type: '@ej' })
    // The answer for `@` lands after `@ej` was typed.
    await harness.run({ files: WORKSPACE_ROOT_FILES })
    expect(harness.input().props.value).toBe('@ej')
    await harness.run({ files: FILES_FOR_EJ })
    expect(harness.input().props.value).toBe('@ej')
    await harness.run({ files: [] })
    expect(harness.input().props.value).toBe(harness.typed())
  })

  it('leaves the caret to the keyboard while typing through the menu', async () => {
    const harness = await mountComposer('light')
    for (const step of [...AT_MENU_STEPS, ...SLASH_MENU_STEPS]) {
      await harness.run(step)
      expect(harness.input().props.selection, `after ${JSON.stringify(step)}`).toBeUndefined()
    }
  })

  it('gives nothing in the menu a way to take focus from the input', async () => {
    const harness = await mountComposer('light', WORKSPACE_ROOT_FILES)
    await harness.run({ type: '@' })
    expect(harness.menuOpen()).toBe(true)
    const menu = harness.renderer.root.find((node) => node.props.testID === 'composer-suggestions')
    const takers = menu.findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props.autoFocus === true ||
          node.props.focusable === true ||
          ((isHost(node, 'Pressable') || isHost(node, 'FlatList')) && node.props.focusable !== false))
    )
    expect(takers.map((node) => String(node.type))).toEqual([])
  })

  it('draws at most eight rows per keystroke from a twenty-thousand-file workspace', async () => {
    const workspace = Array.from({ length: 20_000 }, (_, index) => `src/module-${index}/entry-${index}.ts`)
    const harness = await mountComposer('light', workspace)
    for (const text of ['@', '@e', '@en', '@ent']) {
      await harness.run({ type: text })
      const list = harness.renderer.root.find((node) => isHost(node, 'FlatList'))
      expect(list.props.rowCount, `after ${text}`).toBeLessThanOrEqual(8)
    }
  })
})
