import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { androidNativeParent } from '../test/android-fabric-native-parent.test-support'
import { ThemeProvider } from '../theme/theme-context'
import { MobileMarkdown } from './MobileMarkdown'
import { createPhone, hostParent } from './mobile-markdown-code-pill-phone.test-support'
import { resetRememberedPillCutsForTests } from './use-markdown-code-pill-runs'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => 1 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// 0.9.102 crashed on 2026-09-28 in a mount: "Unable to remove a view from a
// view that is not a ViewGroup. ParentTag: 50922 - Tag: 52692 - Index: 7"
// (SurfaceMountingManager.removeViewAt). Nothing in a reply makes a Text that
// parent: on RN 0.86.3 Android a Text keeps none of its inline Views, and
// Fabric mounts them into the nearest ancestor that forms a stacking context.
// The reply's own root did not form one (a `gap` and an onLayout), so its
// pill Views, prose and quote Texts and flattened boxes (a quote's) were
// mounted one by one into whatever held the reply (the chat list's cell). A
// pill's own Text goes into its pill, which its translateY makes a stacking
// context, and a nested Text is never inserted or removed natively at all.
//
// This is containment, not the proven cause. The crash's trigger was not
// found (its JS log was lost), and no View between the cell and a reply
// flattens or unflattens on the reply path today. What it rules out: any such
// flip moving a reply's views one by one, the kind of move react-native#57800
// (open, no repro) suspects of removing from a parent that is no ViewGroup.
// The reply keeps its own: its root forms a stacking context, and everything
// it draws is mounted into a native view of the reply's (the root, a pill,
// or a table's scroll view inside it) and nowhere else, for its whole life.

const require = createRequire(import.meta.url)
const reactNative = path.dirname(require.resolve('react-native/package.json'))

/** The file's code with its comments taken out, so a match is never prose. */
function code(relative: string): string {
  return readFileSync(path.join(reactNative, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

let renderer: ReactTestRenderer | null = null
let scheme: 'light' | 'dark' = 'light'
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetRememberedPillCutsForTests()
})

function element(content: string, textScale = 1) {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileMarkdown content={content} identity="reply" textScale={textScale} />
    </ThemeProvider>
  )
}

const mounted = (node: ReactTestInstance): object =>
  (node as unknown as { _fiber: { stateNode: object } })._fiber.stateNode

function hostNodes(): ReactTestInstance[] {
  return renderer!.root.findAll((node) => typeof node.type === 'string')
}

/** The reply's own root: the outermost host node it draws. */
function documentRoot(): ReactTestInstance {
  const roots = hostNodes().filter((node) => hostParent(node) === null)
  expect(roots).toHaveLength(1)
  return roots[0]!
}

/** The mocked host tags are plain strings React's element types do not list. */
function isHost(node: { type: unknown } | null, tag: string): boolean {
  return node?.type === tag
}

/** An inline View: a pill, or a figure, drawn inside a Text. */
const isInlineView = (node: ReactTestInstance) => isHost(node, 'View') && isHost(hostParent(node), 'Text')

/** Every string a node draws, for a failure message. */
function words(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : words(child))).join('')
}

function describeNode(node: ReactTestInstance): string {
  return `${isInlineView(node) ? 'the pill' : 'the Text'} "${words(node).slice(0, 40)}"`
}

/** Whether `node` is `root` or drawn inside it. */
function within(node: ReactTestInstance, root: ReactTestInstance): boolean {
  for (let up: ReactTestInstance | null = node; up; up = hostParent(up)) {
    if (up === root) {
      return true
    }
  }
  return false
}

/**
 * Where each pill and Text is mounted now, checked against where it was
 * mounted before: always into a native view of the reply's own (its root, or
 * a table's scroll view inside it), never into a Text, and into the same one
 * for as long as it lives.
 */
function checkMounts(when: string, seen: WeakMap<object, object>): { pills: number; texts: number } {
  const root = documentRoot()
  let pills = 0
  let texts = 0
  for (const node of hostNodes()) {
    if (!isInlineView(node) && !isHost(node, 'Text')) {
      continue
    }
    if (isInlineView(node)) {
      pills += 1
    } else {
      texts += 1
    }
    const parent = androidNativeParent(node, hostParent)
    expect(
      parent === null ? 'above the reply, into whatever holds it' : within(parent, root) ? 'inside the reply' : 'outside the reply',
      `${describeNode(node)} ${when}: mounted`
    ).toBe('inside the reply')
    expect(parent!.type, `${describeNode(node)} ${when}: mounted into a Text`).not.toBe('Text')
    const before = seen.get(mounted(node))
    if (before !== undefined) {
      expect(before === mounted(parent!), `${describeNode(node)} moved to another native parent ${when}`).toBe(true)
    }
    seen.set(mounted(node), mounted(parent!))
  }
  return { pills, texts }
}

const REPLY = [
  '## Changes to `src/session/MobileNativeChatView.tsx` and `use-mobile-chat-scroll-view.tsx`',
  '',
  'I moved `contentPosition` into **`useChatListRenderStability` and `pinToTail`** so the `FlashList` keeps `maintainVisibleContentPosition` stable, and `onLayout` no longer fires `pinToTail` twice. See [the docs](https://example.com) and `docs/mobile-agent-hud.md`.',
  '',
  '- `a.ts` then `b.ts`',
  '- *`c.ts`* and `d/e/f/g/h/i/j/k.ts`',
  '',
  '> A quoted `path/in/quote.ts` line.',
  '',
  '| file | note |',
  '| --- | --- |',
  '| `x.ts` | the `y` pill |',
  '',
  '### Next `step`',
  '',
  'Run `npx tsc --noEmit && npx vitest run && npx oxlint` from `mobile/`.'
].join('\n')

describe('React Native 0.86.3 on Android, as this model reads it', () => {
  it('never keeps a Text’s children in the Text: neither a Paragraph nor a nested Text forms a stacking context', () => {
    const paragraph = code('ReactCommon/react/renderer/components/text/ParagraphShadowNode.h')
    expect(paragraph).toMatch(/#ifdef ANDROID\s+traits\.unset\(ShadowNodeTraits::Trait::FormsStackingContext\);\s+#endif/)
    const text = code('ReactCommon/react/renderer/components/text/TextShadowNode.h')
    expect(text).toMatch(/#ifdef ANDROID\s+traits\.set\(ShadowNodeTraits::Trait::FormsView\);\s+#endif/)
    expect(text).not.toMatch(/FormsStackingContext/)
  })

  it('mounts a flattened node’s children into the nearest ancestor that forms a stacking context', () => {
    expect(code('ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp')).toMatch(
      /bool areChildrenFlattened =\s*\(!childShadowNode\.getTraits\(\)\.check\(\s*ShadowNodeTraits::Trait::FormsStackingContext\) &&\s*!childrenFormStackingContexts\)/
    )
  })

  it('makes a View with collapsable={false} a stacking context, and one with only onLayout none', () => {
    const view = code('ReactCommon/react/renderer/components/view/ViewShadowNode.cpp')
    const stacking = /bool formsStackingContext = ([\s\S]*?);/.exec(view)?.[1] ?? ''
    expect(stacking).toMatch(/^!viewProps\.collapsable \|\|/)
    expect(stacking).not.toMatch(/onLayout/)
    expect(code('ReactCommon/react/renderer/components/view/BaseViewProps.h')).toMatch(/bool onLayout\{\};/)
    // Nor is onLayout one of the ViewEvents bits that do make one.
    const events = code('ReactCommon/react/renderer/components/view/propsConversions.h')
    expect(events).toMatch(/"onClick"/)
    expect(events).not.toMatch(/"onLayout"/)
  })

  it('keeps a Text’s inline Views in the Text only under collapsableChildren={false}, so the check below can fail', () => {
    expect(code('ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp')).toMatch(
      /bool childrenFormStackingContexts = shadowNode\.getTraits\(\)\.check\(\s*ShadowNodeTraits::Trait::ChildrenFormStackingContext\);/
    )
    type Node = { type: string; props: Record<string, unknown>; parent: Node | null }
    const under = (collapsableChildren: boolean | undefined) => {
      const holder: Node = { type: 'View', props: { collapsableChildren }, parent: null }
      const text: Node = { type: 'Text', props: {}, parent: holder }
      const pill: Node = { type: 'View', props: { style: { transform: [{ translateY: 1 }] } }, parent: text }
      return androidNativeParent(pill, (node) => node.parent)?.type ?? 'nothing in the tree'
    }
    expect(under(false)).toBe('Text')
    expect(under(undefined)).toBe('nothing in the tree')
  })

  it('throws on a remove from any parent whose view is not a ViewGroup, a missing view included', () => {
    const mounting = code('ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/SurfaceMountingManager.kt')
    expect(mounting).toMatch(
      /if \(parentView !is ViewGroup\) \{\s*val message =\s*"Unable to remove a view from a view that is not a ViewGroup\.[^"]*"\s*FLog\.e\(TAG, message\)\s*throw IllegalStateException\(message\)/
    )
  })
})

describe.each(['light', 'dark'] as const)('a reply’s pills in the %s scheme', (which) => {
  it('stay mounted inside the reply, each in one place, while it streams in, re-cuts its pills, zooms and turns', () => {
    scheme = which
    const seen = new WeakMap<object, object>()
    const chunks = [80, 160, 240, 320, 400, 480, 560, REPLY.length]
    act(() => {
      renderer = create(element(REPLY.slice(0, chunks[0])))
    })
    act(() => device.layOutDocument(360))
    checkMounts('as it starts', seen)
    for (const end of chunks.slice(1)) {
      act(() => renderer!.update(element(REPLY.slice(0, end))))
      checkMounts(`at ${end} characters`, seen)
      for (let round = 0; round < 6 && device.pass(360); round += 1) {
        checkMounts(`re-cut at ${end} characters`, seen)
      }
    }
    act(() => renderer!.update(element(REPLY, 1.3)))
    checkMounts('zoomed', seen)
    for (let round = 0; round < 6 && device.pass(360, { textScale: 1.3 }); round += 1) {
      checkMounts('re-cut zoomed', seen)
    }
    device.rotateTo(700, { textScale: 1.3 })
    checkMounts('turned', seen)
    for (let round = 0; round < 6 && device.pass(700, { textScale: 1.3 }); round += 1) {
      checkMounts('re-cut turned', seen)
    }
    const { pills, texts } = checkMounts('at the end', seen)
    // The run holds pills in a heading, in bold, in italics, in a list, a
    // quote and a table cell, or this proves less than it says.
    expect(pills).toBeGreaterThanOrEqual(15)
    expect(texts).toBeGreaterThanOrEqual(10)
  })
})

describe('the smallest replies', () => {
  it('keeps a reply of one pill mounted inside itself', () => {
    act(() => {
      renderer = create(element('`x`'))
    })
    act(() => device.layOutDocument(360))
    expect(checkMounts('with one pill', new WeakMap())).toEqual({ pills: 1, texts: 2 })
  })

  it('keeps a reply whose only pill is in a heading mounted inside itself', () => {
    act(() => {
      renderer = create(element('# `x`'))
    })
    act(() => device.layOutDocument(360))
    expect(checkMounts('with a heading pill', new WeakMap())).toEqual({ pills: 1, texts: 3 })
  })

  it('keeps a reply with no pill at all mounted inside itself', () => {
    act(() => {
      renderer = create(element('plain words'))
    })
    act(() => device.layOutDocument(360))
    expect(checkMounts('with no pill', new WeakMap())).toEqual({ pills: 0, texts: 1 })
  })
})
