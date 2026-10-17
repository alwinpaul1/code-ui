import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { ClaudeArtifactListItem } from './claude-artifacts'
import {
  PUBLISH_CALL,
  PUBLISH_RESULT,
  PUBLISHED_LINK,
  PUBLISHED_TITLE,
  PUBLISHED_UUID,
  QUICKSTART_CALL,
  QUICKSTART_RESULT
} from './fixtures/claude-artifact-tool-2.1.301'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      setValue(): void {}
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
const opened = vi.hoisted(() => [] as { url: string; title?: string | null }[])
vi.mock('./open-claude-artifact', () => ({ openClaudeArtifact: (link: { url: string; title?: string | null }) => opened.push(link) }))
// The account's list, as the store would hold it once read (claude-artifact-list-store.ts).
const list = vi.hoisted(() => ({ items: [] as ClaudeArtifactListItem[], askedFor: [] as (string | null)[] }))
vi.mock('./claude-artifact-list-store', () => ({
  useClaudeArtifactList: (accountId: string | null) => {
    list.askedFor.push(accountId)
    return { items: accountId === 'acct-1' ? list.items : [], loading: false, error: null, loadedAt: null }
  }
}))

import { ClaudeArtifactAccountContext } from './claude-artifact-account-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatToolSegment } from './MobileNativeChatToolSegment'

// The Claude Android app 1.261013.20 draws Claude Code's Artifact call as a card
// (a18.java:56-190 → kv30.a → bs30.d): a violet page tile peeking out of the
// card's bottom edge with the artifacts glyph, the page's title, and "Artifact"
// under it; "Artifact · Publishing…" and a spinner while it publishes; a plain
// step row with the error when it fails. Code UI drew every one of these as
// "Used Artifact ›" inside the run beside it.

// A lone unanswered call is the turn's live call, as the message hands it down while the turn
// works (MobileNativeChatMessage `inFlightToolCall`); `idle` renders it with the turn over.
function Harness({ blocks, idle }: { blocks: NativeChatBlock[]; idle?: boolean }) {
  const styles = useChatMessageStyles()
  const live = !idle && blocks.length === 1 && blocks[0]!.type === 'tool-call' ? blocks[0] : null
  return <MobileNativeChatToolSegment blocks={blocks} defaultExpanded={false} styles={styles} activeCall={live} />
}

let renderer: ReactTestRenderer | null = null

function render(blocks: NativeChatBlock[], scheme: 'light' | 'dark' = 'light', account: string | null = 'acct-1', idle = false): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <ClaudeArtifactAccountContext.Provider value={account}>
          <Harness blocks={blocks} idle={idle} />
        </ClaudeArtifactAccountContext.Provider>
      </ThemeProvider>
    )
  })
  return renderer!.root
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join('')
}

const byId = (root: ReactTestInstance, id: string): ReactTestInstance[] =>
  root.findAll((node) => node.props?.testID === id && typeof node.type === 'string')

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter((entry) => entry && typeof entry === 'object'))

function card(root: ReactTestInstance) {
  const [box] = byId(root, 'artifact-card')
  const subtitle = byId(root, 'artifact-card-subtitle')[0]
  return {
    box,
    title: textOf(byId(root, 'artifact-card-title')[0]!),
    subtitle: subtitle ? textOf(subtitle) : null,
    spinner: byId(root, 'artifact-card-spinner').length > 0,
    tappable: String(box?.type) === 'Pressable' && typeof box?.props.onPress === 'function'
  }
}

const RUNNING_PUBLISH: NativeChatBlock = { ...(PUBLISH_CALL as Extract<NativeChatBlock, { type: 'tool-call' }>), state: 'running' }

beforeEach(() => {
  opened.length = 0
  list.items = []
  list.askedFor = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the Artifact card, as the Claude app draws it', () => {
  it('says "Artifact · Publishing…" under the file name with a spinner while the page goes up, and does not open', () => {
    const shown = card(render([RUNNING_PUBLISH]))
    expect(shown).toMatchObject({ title: 'code-ui-artifact-check.html', subtitle: 'Artifact · Publishing…', spinner: true, tappable: false })
    expect(shown.box!.props.accessibilityLabel).toBe('code-ui-artifact-check.html, Publishing…')
    // Nothing is published yet, so the account's list is not asked for.
    expect(list.askedFor.every((asked) => asked === null)).toBe(true)
  })

  it('says "Artifact · Opening…" while an open call runs', () => {
    const open: NativeChatBlock = { type: 'tool-call', name: 'Artifact', callId: 'toolu_open', state: 'running', input: { action: 'open', url: PUBLISHED_LINK, title: 'Status page' } }
    expect(card(render([open]))).toMatchObject({ title: 'Status page', subtitle: 'Artifact · Opening…', spinner: true, tappable: false })
  })

  it('draws a publish the turn never answered as a plain row, not a card that spins forever', () => {
    const root = render([RUNNING_PUBLISH], 'light', 'acct-1', true)
    expect(byId(root, 'artifact-card')).toHaveLength(0)
    expect(byId(root, 'artifact-card-spinner')).toHaveLength(0)
  })

  it("names a published page by the account list's title over the file name, and opens it in the app", () => {
    list.items = [{ uuid: PUBLISHED_UUID, title: PUBLISHED_TITLE, rel: 'mine', updatedAt: 1, url: PUBLISHED_LINK, createdAt: null, audience: null, typeTitle: null, typeSlug: null, thumbUrl: null, starred: false, ownerEmail: null }]
    const root = render([PUBLISH_CALL, PUBLISH_RESULT])
    const shown = card(root)
    expect(shown).toMatchObject({ title: PUBLISHED_TITLE, subtitle: 'Artifact', spinner: false, tappable: true })
    expect(shown.box!.props.accessibilityLabel).toBe(`Open ${PUBLISHED_TITLE}`)
    expect(list.askedFor).toContain('acct-1')
    act(() => shown.box!.props.onPress())
    // As the chat's account, so the viewer opens it signed in as the account that owns it.
    expect(opened).toEqual([{ url: PUBLISHED_LINK, title: PUBLISHED_TITLE, accountId: 'acct-1' }])
  })

  it('falls back to the file name when the list does not name the page, or no account is known', () => {
    expect(card(render([PUBLISH_CALL, PUBLISH_RESULT])).title).toBe('code-ui-artifact-check.html')
    act(() => renderer?.unmount())
    list.items = [{ uuid: PUBLISHED_UUID, title: PUBLISHED_TITLE, rel: 'mine', updatedAt: 1, url: PUBLISHED_LINK, createdAt: null, audience: null, typeTitle: null, typeSlug: null, thumbUrl: null, starred: false, ownerEmail: null }]
    expect(card(render([PUBLISH_CALL, PUBLISH_RESULT], 'light', null)).title).toBe('code-ui-artifact-check.html')
  })

  it('says "Artifact" alone, with no subtitle, for a page with no title anywhere', () => {
    const untitled: NativeChatBlock = { type: 'tool-call', name: 'Artifact', callId: PUBLISH_CALL.type === 'tool-call' ? PUBLISH_CALL.callId : '', input: { files: { 'index.html': 'page.html' } } }
    const shown = card(render([untitled, PUBLISH_RESULT]))
    expect(shown).toMatchObject({ title: 'Artifact', subtitle: null, tappable: true })
    expect(shown.box!.props.accessibilityLabel).toBe('Open Artifact')
    act(() => renderer?.unmount())
    // Untitled and still publishing: the state alone, the title already says "Artifact".
    expect(card(render([{ ...untitled, state: 'running' } as NativeChatBlock]))).toMatchObject({ title: 'Artifact', subtitle: 'Publishing…', spinner: true })
  })

  it('draws a failed publish as a plain step row naming the error, not a card', () => {
    const failed: NativeChatBlock = { type: 'tool-result', callId: (PUBLISH_CALL as { callId: string }).callId, output: 'Publish refused: the file is over 16MB\nmore detail', isError: true }
    const root = render([PUBLISH_CALL, failed])
    expect(byId(root, 'artifact-card')).toHaveLength(0)
    const [row] = byId(root, 'artifact-failed-row')
    expect(textOf(row!)).toBe('Publish refused: the file is over 16MB')
  })

  it('leaves the quickstart to the ordinary tool row', () => {
    const root = render([QUICKSTART_CALL, QUICKSTART_RESULT])
    expect(byId(root, 'artifact-card')).toHaveLength(0)
    expect(byId(root, 'artifact-failed-row')).toHaveLength(0)
  })

  it.each([
    ['light', lightColors, { card: 'rgba(252, 251, 255, 0.1)', tile: '#EFEDFF', tileBorder: '#BFB9F5', icon: '#4A3AA7' }],
    ['dark', darkColors, { card: 'rgba(29, 22, 73, 0.15)', tile: '#1D1649', tileBorder: '#322777', icon: '#A096EB' }]
  ] as const)('is violet in %s, over the theme surface with its border and ink', (scheme, palette, violet) => {
    const root = render([PUBLISH_CALL, PUBLISH_RESULT], scheme)
    const box = flat((byId(root, 'artifact-card')[0]!.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false }))
    expect(box).toMatchObject({ backgroundColor: violet.card, borderColor: palette.border, borderRadius: 12, borderWidth: 0.5, overflow: 'hidden' })
    const tile = flat(byId(root, 'artifact-card-tile')[0]!.props.style)
    expect(tile).toMatchObject({ backgroundColor: violet.tile, borderColor: violet.tileBorder, width: 56, height: 72, borderRadius: 8, paddingBottom: 15 })
    expect(tile.transform).toEqual([{ translateY: 15 }])
    const glyph = root.find((node) => node.props?.testID === 'artifact-card-glyph')
    expect(glyph.props).toMatchObject({ size: 24, color: violet.icon })
    expect(flat(byId(root, 'artifact-card-title')[0]!.props.style).color).toBe(palette.text)
    expect(flat(byId(root, 'artifact-card-subtitle')[0]!.props.style).color).toBe(palette.textSecondary)
  })
})
