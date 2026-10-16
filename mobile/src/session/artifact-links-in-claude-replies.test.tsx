import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { ThemeProvider } from '../theme/theme-context'
import type { ClaudeArtifactListItem } from './claude-artifacts'
import { PUBLISHED_LINK, PUBLISHED_TITLE, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

vi.mock('react-native', () => ({
  Image: Object.assign(() => null, { getSize: () => undefined }),
  Linking: { openURL: () => Promise.resolve() },
  PixelRatio: { get: () => 3 },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  processColor: () => 1
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
const external = vi.hoisted(() => [] as string[])
vi.mock('../platform/external-link', () => ({ openExternalLink: (url: string) => external.push(url) }))
const opened = vi.hoisted(() => [] as { url: string; title?: string | null }[])
vi.mock('./open-claude-artifact', () => ({ openClaudeArtifact: (link: { url: string; title?: string | null }) => opened.push(link) }))
const list = vi.hoisted(() => ({ items: [] as ClaudeArtifactListItem[], askedFor: [] as (string | null)[] }))
vi.mock('./claude-artifact-list-store', () => ({
  useClaudeArtifactList: (accountId: string | null) => {
    list.askedFor.push(accountId)
    return { items: accountId === 'acct-1' ? list.items : [], loading: false, error: null, loadedAt: null }
  }
}))
// Android's native prose view, with a stand-in for its measure (MobileMarkdown.native-prose.test.tsx).
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaNativeProse' ? { measure: () => 300 } : null),
  requireNativeViewManager: (name: string) => `ViewManagerAdapter_${name}`
}))
vi.mock('../components/native-prose-text', () => import('../components/native-prose-text.android'))

import { ClaudeArtifactAccountContext } from './claude-artifact-account-context'
import { ClaudeArtifactLinks } from './ClaudeArtifactLinks'

// The Claude Android app 1.261013.20 (ht1.java) draws a claude.ai artifact link
// in Claude's words as an artifact chip: the link's own words, else the page's
// title, else "Artifact · <the id's first 8>", read as "Artifact, <label>", and
// a tap opens the page in its own viewer. Code UI drew the bare address,
// `https://claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6`, and opened the browser.
// The link is the one Claude Code 2.1.301 answered a publish with
// (fixtures/claude-artifact-tool-2.1.301.ts).

const UNTITLED = 'Artifact · 8JHvPGXw'
const NATIVE = 'ViewManagerAdapter_OrcaNativeProse'

let renderer: ReactTestRenderer | null = null

function render(content: string, options: { reply?: boolean; account?: string | null; native?: boolean } = {}): ReactTestInstance {
  const { reply = true, account = null, native = false } = options
  const markdown = <MobileMarkdown content={content} typography={native ? TRANSCRIPT_MARKDOWN_TYPOGRAPHY : undefined} />
  const words: ReactNode = reply ? <ClaudeArtifactLinks text={content}>{markdown}</ClaudeArtifactLinks> : markdown
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <ClaudeArtifactAccountContext.Provider value={account}>{words}</ClaudeArtifactAccountContext.Provider>
      </ThemeProvider>
    )
  })
  return renderer!.root
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

function link(root: ReactTestInstance, words: string): ReactTestInstance {
  return root.find((node) => String(node.type) === 'Text' && typeof node.props.onPress === 'function' && textOf(node) === words)
}

function nativeSpec(root: ReactTestInstance): { view: ReactTestInstance; model: { text: string; links: { kind: string; href?: string }[] } } {
  const document = root.find((node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function')
  act(() => document.props.onLayout({ nativeEvent: { layout: { width: 360, height: 0, x: 0, y: 0 } } }))
  const view = root.find((node) => String(node.type) === NATIVE)
  return { view, model: JSON.parse(view.props.spec as string).model }
}

beforeEach(() => {
  opened.length = 0
  external.length = 0
  list.items = []
  list.askedFor = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe("an artifact link in Claude's reply", () => {
  it('shows "Artifact · <id>" instead of the address, and opens the page in the app', () => {
    const root = render(`Published it: ${PUBLISHED_LINK}`)
    expect(textOf(root)).toBe(`Published it: ${UNTITLED}`)
    const chip = link(root, UNTITLED)
    expect(chip.props.accessibilityLabel).toBe(`Artifact, ${UNTITLED}`)
    act(() => chip.props.onPress())
    expect(opened).toEqual([{ url: PUBLISHED_LINK, title: null }])
    expect(external).toEqual([])
  })

  it("shows the page's title from the account's list when it names the page", () => {
    list.items = [{ uuid: PUBLISHED_UUID, title: PUBLISHED_TITLE, rel: 'mine', updatedAt: 1, url: PUBLISHED_LINK, createdAt: null, audience: null, typeTitle: null, typeSlug: null, thumbUrl: null, starred: false, ownerEmail: null }]
    const root = render(`Published it: ${PUBLISHED_LINK}.`, { account: 'acct-1' })
    expect(textOf(root)).toBe(`Published it: ${PUBLISHED_TITLE}.`)
    act(() => link(root, PUBLISHED_TITLE).props.onPress())
    expect(opened).toEqual([{ url: PUBLISHED_LINK, title: PUBLISHED_TITLE }])
    expect(link(root, PUBLISHED_TITLE).props.accessibilityLabel).toBe(`Artifact, ${PUBLISHED_TITLE}`)
  })

  it("keeps a Markdown link's own words, and still opens it in the app", () => {
    list.items = [{ uuid: PUBLISHED_UUID, title: PUBLISHED_TITLE, rel: 'mine', updatedAt: 1, url: PUBLISHED_LINK, createdAt: null, audience: null, typeTitle: null, typeSlug: null, thumbUrl: null, starred: false, ownerEmail: null }]
    const root = render(`See [the check page](${PUBLISHED_LINK}).`, { account: 'acct-1' })
    expect(textOf(root)).toBe('See the check page.')
    const chip = link(root, 'the check page')
    expect(chip.props.accessibilityLabel).toBe('Artifact, the check page')
    act(() => chip.props.onPress())
    expect(opened).toEqual([{ url: PUBLISHED_LINK, title: PUBLISHED_TITLE }])
  })

  it('draws the label for a Markdown link whose words are only its address', () => {
    const root = render(`[${PUBLISHED_LINK}](${PUBLISHED_LINK})`)
    expect(textOf(root)).toBe(UNTITLED)
  })

  it('leaves any other link as it was: its address, opened in the browser', () => {
    const root = render(`Docs: https://example.com/ring and ${PUBLISHED_LINK}`)
    act(() => link(root, 'https://example.com/ring').props.onPress())
    expect(external).toEqual(['https://example.com/ring'])
    expect(opened).toEqual([])
  })

  it('reads no list when the reply holds no artifact link', () => {
    render('Nothing published here: https://example.com/ring', { account: 'acct-1' })
    expect(list.askedFor.every((asked) => asked === null)).toBe(true)
  })

  it('stays the address, opened in the browser, outside an agent reply', () => {
    const root = render(`Published it: ${PUBLISHED_LINK}`, { reply: false })
    expect(textOf(root)).toBe(`Published it: ${PUBLISHED_LINK}`)
    act(() => link(root, PUBLISHED_LINK).props.onPress())
    expect(external).toEqual([PUBLISHED_LINK])
    expect(opened).toEqual([])
  })

  it("draws the label in Android's native prose view too, and a tap there opens the page in the app", () => {
    const content = `Published it: ${PUBLISHED_LINK}\n\nDocs: https://example.com/ring`
    const { view, model } = nativeSpec(render(content, { native: true }))
    expect(model.text).toBe(`Published it: ${UNTITLED}\n\nDocs: https://example.com/ring`)
    expect(model.links.map((entry) => entry.href)).toEqual([PUBLISHED_LINK, 'https://example.com/ring'])
    act(() => view.props.onLinkPress({ nativeEvent: { link: 0 } }))
    expect(opened).toEqual([{ url: PUBLISHED_LINK, title: null }])
    act(() => view.props.onLinkPress({ nativeEvent: { link: 1 } }))
    expect(external).toEqual(['https://example.com/ring'])
  })
})
