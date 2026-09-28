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

// 2026-09-28, from the phone: a reply selected with a long press and copied pasted as "...only
// when someone runs ￼. I haven't confirmed...". The `cdk deploy` pill is an inline View in the
// prose Text, which Android copies as U+FFFC. The Copy that fixes it is native
// (modules/orca-selection-copy), and it can only be exact with two things from here: each pill's
// View carries the whole span it was cut from, and where it sits in it, on its nativeID; and the
// document is wrapped in the native view that takes its Texts' selection menus, with no pill
// mounted into a Text. This is Android as Metro resolves it, markdown-selection-copy.android.tsx
// over markdown-selection-copy.tsx.

const nativeModule = vi.hoisted(() => ({ present: true }))

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
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (nativeModule.present && name === 'OrcaSelectionCopy' ? {} : null),
  // Expo's adapter is a class around the host component; the host is what Fabric mounts.
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('./markdown-selection-copy', () => import('./markdown-selection-copy.android'))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

/** The host Expo's requireNativeViewManager registers for the module's view. */
const NATIVE_ROOT = 'ViewManagerAdapter_OrcaSelectionCopy'

let renderer: ReactTestRenderer | null = null
let scheme: 'light' | 'dark' = 'light'
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  scheme = 'light'
  resetRememberedPillCutsForTests()
})

/** Mount the reply as the chat does (paths open files), and let the phone cut its pills. */
function show(content: string, width = 360) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={content} identity="reply" onOpenFile={() => {}} />
      </ThemeProvider>
    )
  })
  act(() => device.layOutDocument(width))
  // The phone model measures the Text a pill is in; with no pill there is nothing to cut.
  if (pills().length > 0) {
    device.settle(width)
  }
}

const hostNodes = () => renderer!.root.findAll((node) => typeof node.type === 'string')

/** Every pill View, in the order its U+FFFC comes in its Text. */
function pills(): ReactTestInstance[] {
  return hostNodes().filter((node) => node.type === ('View' as never) && hostParent(node)?.type === ('Text' as never))
}

/** What a pill draws: the piece of its span cut to its line. */
const pieceText = (pill: ReactTestInstance) => pill.findByType('Text' as never).children.join('')

/** A pill's nativeID read the way PillCopy.kt reads it, or what was there instead. */
function copyText(pill: ReactTestInstance): { piece: number; span: string } | string {
  const id: unknown = pill.props.nativeID
  const match = typeof id === 'string' ? /^codeui-pill:(\d+):([\s\S]+)$/.exec(id) : null
  return match ? { piece: Number(match[1]), span: match[2]! } : `no pill copy text (nativeID: ${String(id)})`
}

/** The code spans a document holds, in order, as the source spells them. */
const sourceSpans = (content: string) => [...content.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!)

/**
 * The spans the pills say they copy as, one per span however many lines it crosses, checked
 * piece by piece: pieces of one span come together, numbered from 0, each carrying the whole span,
 * and what they draw is the span with only the spaces at its cuts gone.
 */
function copiedSpans(): string[] {
  const spans: string[] = []
  let drawn: string[] = []
  const all = pills()
  all.forEach((pill, at) => {
    const text = copyText(pill)
    expect(text, `pill "${pieceText(pill)}"`).toBeTypeOf('object')
    const { piece, span } = text as { piece: number; span: string }
    if (piece === 0) {
      spans.push(span)
      drawn = []
    } else {
      expect(copyText(all[at - 1]!), `pill "${pieceText(pill)}" follows the piece before it`).toEqual({
        piece: piece - 1,
        span
      })
    }
    drawn.push(pieceText(pill))
    const next = all[at + 1] ? copyText(all[at + 1]!) : null
    if (typeof next !== 'object' || next === null || next.piece === 0) {
      expect(drawn.join('').replace(/\s/g, ''), `the pieces of "${span}"`).toBe(span.replace(/\s/g, ''))
    }
  })
  return spans
}

/** The reply in copy-pill-fffc.png, from its third list item down. */
const SCREENSHOT_REPLY = [
  '3. The email goes out through **Cloudflare Email Sending (SMTP)**, from **noreply@nexdash.com**, to the email address on that person’s account.',
  '',
  'The code tries mail services in order: Amazon SES, then Resend, then SMTP. In the production setup (`infra/lib/nexos-stack.ts`), SES is switched off and Cloudflare SMTP is configured, so SMTP is what sends it.',
  '',
  'One catch: that SMTP setup comes from PR #1129 and reaches production only when someone runs `cdk deploy`. I haven’t confirmed that has happened. If it hasn’t, the email fails quietly: the password is still set, and the server logs the email error.',
  '',
  'session:ok'
].join('\n')

const WORKTREE_ITEM =
  '- Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.'

/** Pills in a heading, bold, italics, a list, a quote and a table cell. */
const EVERY_PLACE = [
  '## Changes to `src/session/MobileNativeChatView.tsx`',
  '',
  'I moved `contentPosition` into **`useChatListRenderStability` and `pinToTail`**, and *`c.ts`* too.',
  '',
  '- `a.ts` then `b.ts`',
  '',
  '> A quoted `path/in/quote.ts` line.',
  '',
  '| file | note |',
  '| --- | --- |',
  '| `x.ts` | the `y` pill |'
].join('\n')

describe.each(['light', 'dark'] as const)('a reply’s pills on Android, %s', (which) => {
  it('each carry the words a Copy puts in place of their U+FFFC: `infra/lib/nexos-stack.ts` and `cdk deploy`', () => {
    scheme = which
    show(SCREENSHOT_REPLY)
    expect(copiedSpans()).toEqual(['infra/lib/nexos-stack.ts', 'cdk deploy'])
  })
})

describe('a reply’s pills on Android', () => {
  it('each carry their whole span when it is cut across lines, numbered from its first piece', () => {
    show(WORKTREE_ITEM)
    const path = '/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows'
    const split = pills().filter((pill) => (copyText(pill) as { span?: string }).span === path)
    expect(split.length, 'the path is cut across lines at 360 dp').toBeGreaterThan(1)
    expect(split.map((pill) => copyText(pill))).toEqual(split.map((_, piece) => ({ piece, span: path })))
    expect(copiedSpans()).toEqual(sourceSpans(WORKTREE_ITEM))
  })

  it('each carry their span in a heading, bold, italics, a list, a quote and a table cell', () => {
    show(EVERY_PLACE)
    expect(copiedSpans()).toEqual(sourceSpans(EVERY_PLACE))
  })

  it('carry the span on the pill View alone, not on its Text or the prose Text', () => {
    show(SCREENSHOT_REPLY)
    const withId = hostNodes().filter((node) => node.props.nativeID !== undefined)
    expect(withId).toEqual(pills())
  })

  it('carries the one pill of a reply that is only `x`, and nothing in a reply with none', () => {
    show('`x`')
    expect(pills().map((pill) => pill.props.nativeID)).toEqual(['codeui-pill:0:x'])
    act(() => renderer?.unmount())
    show('plain words')
    expect(hostNodes().filter((node) => node.props.nativeID !== undefined)).toEqual([])
  })
})

const require = createRequire(import.meta.url)

/** A file's code with its comments taken out, so a match is never prose. */
function code(pkg: string, relative: string): string {
  return readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('an Expo view on Android, as the native-parent model reads it', () => {
  it('makes its children keep their own unless collapsableChildren={false}: the check a View makes, the other way round', () => {
    // expo-modules-core 57.0.16. A View sets ChildrenFormStackingContext for
    // collapsableChildren={false} (ViewShadowNode.cpp); an Expo view sets it
    // for true, the default. A Text directly under such a view keeps its
    // pills, and a TextView cannot hold a view: Fabric throws "Unable to add a
    // view into a view that is not a ViewGroup" (review of this fix).
    const expo = code('expo-modules-core', 'common/cpp/fabric/ExpoViewShadowNode.h')
    expect(expo).toMatch(
      /if \(viewProps\.collapsableChildren\) \{\s*this->traits_\.set\(react::ShadowNodeTraits::Trait::ChildrenFormStackingContext\);/
    )
    const view = code('react-native', 'ReactCommon/react/renderer/components/view/ViewShadowNode.cpp')
    expect(view).toMatch(/if \(!viewProps\.collapsableChildren\) \{\s*traits_\.set\(ShadowNodeTraits::Trait::ChildrenFormStackingContext\);/)
    expect(code('react-native', 'ReactCommon/react/renderer/components/view/BaseViewProps.h')).toMatch(
      /bool collapsableChildren\{true\};/
    )
  })
})

/**
 * Where each Text and pill of the reply is mounted, by the native-parent model: never into a Text
 * (a TextView holds no view, and Fabric throws on the insert), always inside the document's own
 * View (its root, or a table's scroll view inside it).
 */
function checkMounts(documentView: ReactTestInstance): number {
  const within = (node: ReactTestInstance | null): boolean =>
    node === null ? false : node === documentView || within(hostParent(node))
  const drawn = hostNodes().filter((node) => node.type === ('Text' as never) || pills().includes(node))
  for (const node of drawn) {
    const parent = androidNativeParent(node, hostParent)
    const what = `"${node.findAll((inner) => typeof inner.type === 'string').flatMap((inner) => inner.children.filter((child) => typeof child === 'string')).join('').slice(0, 40)}"`
    expect(parent?.type, `${what} mounted into a Text`).not.toBe('Text')
    expect(within(parent), `${what} mounted inside the document's View`).toBe(true)
  }
  return drawn.length
}

/** The one host with no host above it, and the host nodes directly under it. */
function outermost(): { root: ReactTestInstance; children: ReactTestInstance[] } {
  const roots = hostNodes().filter((node) => hostParent(node) === null)
  expect(roots).toHaveLength(1)
  return { root: roots[0]!, children: hostNodes().filter((node) => hostParent(node) === roots[0]) }
}

describe.each(['light', 'dark'] as const)('the document on Android, %s', (which) => {
  it('is wrapped in the native view that takes its Texts’ selection menus, and no pill is mounted into a Text', () => {
    scheme = which
    show(EVERY_PLACE)
    const { root, children } = outermost()
    expect(root.type).toBe(NATIVE_ROOT)
    // The document's own View, as before this fix: the Texts sit under a View, which reads
    // collapsableChildren the way the model says, not under the Expo view, which reads it the
    // other way round and would make a Text keep its pills.
    expect(children.map((node) => [node.type, node.props.collapsable])).toEqual([['View', false]])
    expect(checkMounts(children[0]!)).toBeGreaterThan(10)
  })

  it('keeps a reply of one pill and a reply of none the same way', () => {
    scheme = which
    show('`x`')
    expect(checkMounts(outermost().children[0]!)).toBe(3)
    act(() => renderer?.unmount())
    show('plain words')
    const { root, children } = outermost()
    expect(root.type).toBe(NATIVE_ROOT)
    expect(checkMounts(children[0]!)).toBe(1)
  })
})

describe('the document on an Android build without the module', () => {
  it('is drawn as before, not wrapped, with every pill mounted in its View, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    nativeModule.present = false
    vi.resetModules()
    // A mock's factory runs once per registration, so register it again for the new registry.
    vi.doMock('./markdown-selection-copy', () => import('./markdown-selection-copy.android'))
    try {
      const fresh = await import('./MobileMarkdown')
      const theme = await import('../theme/theme-context')
      act(() => {
        renderer = create(
          <theme.ThemeProvider initialPreference="light">
            <fresh.MobileMarkdown content={EVERY_PLACE} identity="reply" onOpenFile={() => {}} />
          </theme.ThemeProvider>
        )
      })
      const { root } = outermost()
      expect([root.type, root.props.collapsable]).toEqual(['View', false])
      expect(checkMounts(root)).toBeGreaterThan(10)
      expect(warn.mock.calls.filter(([message]) => String(message).includes('OrcaSelectionCopy'))).toHaveLength(1)
    } finally {
      nativeModule.present = true
      warn.mockRestore()
    }
  })
})
