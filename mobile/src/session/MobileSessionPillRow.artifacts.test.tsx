import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeSessionPillPalette } from '../theme/claude-session-pill-palette'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { PUBLISHED_LINK, PUBLISHED_TITLE, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

// The Claude app's artifacts button in the session bar above the composer (1.261013.20, read "Open
// artifacts", `%d artifact(s)`, ns30.java:610-660; the bar is `u8z.e`, u8z.java:643-690, laid out
// before the composer in ay8.java:8423-8445), on Code UI's Claude tabs: shown when the session
// published a page, counting them, and opening the Artifacts sheet.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: vi.fn(async () => {}) },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true })
)
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { visible: boolean; header: unknown; children: unknown }) =>
    props.visible ? createElement('Drawer', null, props.header as never, props.children as never) : null
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: () => null }))
vi.mock('./MobileSheetTitleBar', () => ({ MobileSheetTitleBar: (props: { title: string }) => createElement('TitleBar', { title: props.title }) }))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: async () => {} }) }))
vi.mock('./use-session-pills', () => ({ useSessionPills: () => [] }))
// The tab's session stands matched to this account (ccr-session-cache.ts).
vi.mock('./ccr-session-cache', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ccrAccountForTab: () => 'acct',
  ccrAccountForConfigDir: () => null
}))

import { ThemeProvider } from '../theme/theme-context'
import { setClaudeArtifactListDepsForTests } from './claude-artifact-list-store'
import { MobileSessionPillRow, OUTPUTS_PILL_HEIGHT, SessionPillRowView } from './MobileSessionPillRow'
import type { SessionArtifact } from './session-artifacts'
import type { MobileSessionController } from './use-mobile-session-controller'

const ACCOUNT_PAGE = { slug: 'a0000000-0000-4000-8000-000000000001', title: 'Release dashboard', rel: 'mine', updatedAt: '2026-10-16T12:00:00Z' }
const SECOND_UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const PAGE: SessionArtifact = { uuid: PUBLISHED_UUID, url: PUBLISHED_LINK, title: PUBLISHED_TITLE }

function listAnswers(frames: unknown[]): void {
  const fetchImpl = vi.fn<CcrFetch>(async () => ({ ok: true, status: 200, json: async () => ({ frames }) }))
  setClaudeArtifactListDepsForTests({
    load: async () =>
      ({
        fetch: fetchImpl,
        accounts: { list: async () => [{ id: 'acct', label: 'a', accessToken: 'tok', organizationUuid: 'org', error: null }] }
      }) as unknown as CcrPipelineDeps
  })
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  setClaudeArtifactListDepsForTests(null)
})

const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}

/** A Claude tab with these session pages, or (`claude: false`) a Codex or shell tab. */
function controller(artifacts: readonly SessionArtifact[], claude = true): MobileSessionController {
  return {
    showToast: vi.fn(),
    handlePanelTap: vi.fn(),
    nativeChatController: {
      nativeChatClaudePlan: claude ? null : undefined,
      nativeChatClaudeArtifacts: claude
        ? { artifacts, account: { tabId: 'tab-1', epoch: 1, agentSessionId: 'sess', configDir: '/home/me/.claude' } }
        : undefined
    }
  } as unknown as MobileSessionController
}

async function mount(artifacts: readonly SessionArtifact[], claude = true) {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <MobileSessionPillRow controller={controller(artifacts, claude)} />
      </ThemeProvider>
    )
  })
}

describe('the artifacts button on a Claude tab', () => {
  it('is not drawn when neither the session nor the account has a page', async () => {
    listAnswers([])
    await mount([])
    expect(host('artifacts-pill')).toBeUndefined()
    expect(renderer!.toJSON()).toBeNull()
  })

  it('counts one page as "1 artifact", read "Open artifacts"', async () => {
    listAnswers([])
    await mount([PAGE])
    const pill = host('artifacts-pill')!
    expect(pill.props.accessibilityLabel).toBe('Open artifacts')
    expect(texts(pill)).toEqual(['1 artifact'])
  })

  it('counts two pages as "2 artifacts"', async () => {
    listAnswers([])
    await mount([PAGE, { uuid: SECOND_UUID, url: 'https://claude.ai/artifact/x', title: null }])
    expect(texts(host('artifacts-pill')!)).toEqual(['2 artifacts'])
  })

  // Reported 2026-10-16: a session that had made nothing showed "Artifacts" and listed the whole
  // account. The Claude app hides the button for a session with no artifacts (ns30.java:610-660).
  it('is not drawn when only the account has pages and the session made none', async () => {
    listAnswers([ACCOUNT_PAGE])
    await mount([])
    expect(host('artifacts-pill')).toBeUndefined()
  })

  it('opens the Artifacts sheet listing the session’s page', async () => {
    listAnswers([])
    await mount([PAGE])
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'Drawer')).toHaveLength(0)
    await act(async () => host('artifacts-pill')!.props.onPress())
    expect(renderer!.root.find((node) => (node.type as unknown) === 'TitleBar').props.title).toBe('Artifacts')
    expect(texts(host('artifacts-section-session')!)).toEqual(['This session (1)', PUBLISHED_TITLE, 'Artifact · claude.ai'])
  })

  it('is not drawn on a Codex or shell tab, whatever the account holds', async () => {
    listAnswers([ACCOUNT_PAGE])
    await mount([], false)
    expect(host('artifacts-pill')).toBeUndefined()
  })
})

// Reported 2026-10-16: "the artifact, shown like a tab, is not exactly like this". Code UI drew
// the old session pill chip (`jc20.c`, 1.261009.20: 14 dp corners, a hairline, no glyph). The
// 1.261013.20 session bar draws its outputs control with `u8z.h` (u8z.java:3778-3806) through the
// bar's button `u8z.d` (u8z.java:200): a 48 dp touch box (`tv30.l(.., 48)`) holding a full-round
// pill (`b2t.a` = 50%) on `ad5.n0()` with no hairline, padded 16 x 10 (`u8z.t`, u8z.java:4778-4786),
// then the artifacts glyph (`CdsIcon.artifacts` U+E017, `yu0.u` = 16 dp, in `ad5.x0()`), 8 dp, and
// "%d artifact(s)" in `xo7.G` (13, medium) in `ad5.x0()`, one line, ellipsized (r3z case 1).
describe.each(['light', 'dark'] as const)('the artifacts button in %s mode', (scheme) => {
  const claude = claudeSessionPillPalette(scheme)
  function drawBar(sessionCount: number, open = vi.fn(), onOpenPlan: (() => void) | null = null) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <SessionPillRowView
            pills={[]}
            onOpenPullRequest={vi.fn()}
            onCopyPrNumber={vi.fn()}
            onOpenPlan={onOpenPlan}
            artifacts={{ sessionCount, onOpen: open }}
          />
        </ThemeProvider>
      )
    })
    return open
  }

  it('draws the Claude app’s outputs pill, not the old hairline chip', () => {
    drawBar(3)
    const pill = host('artifacts-pill')!
    const style = flat(typeof pill.props.style === 'function' ? pill.props.style({ pressed: false }) : pill.props.style)
    expect(style).toMatchObject({
      backgroundColor: claude.outputsFill,
      borderRadius: OUTPUTS_PILL_HEIGHT / 2,
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8
    })
    expect(style.borderWidth ?? 0).toBe(0)
    // The app's 48 dp box, reached by slop so the bar keeps its height beside the other pills.
    expect(OUTPUTS_PILL_HEIGHT + pill.props.hitSlop.top + pill.props.hitSlop.bottom).toBeGreaterThanOrEqual(48)
  })

  it('leads with the artifacts glyph in the outputs ink, then the count in the same ink', () => {
    drawBar(1)
    const pill = host('artifacts-pill')!
    const glyph = pill.find((child) => child.props.testID === 'artifacts-pill-glyph' && typeof child.type === 'string')
    expect(glyph.props.width).toBe(16)
    expect(glyph.findByType('Path' as never).props.fill).toBe(claude.outputsInk)
    const label = pill.find((child) => (child.type as unknown) === 'Text')
    expect([label.props.children].flat().join('')).toBe('1 artifact')
    expect(flat(label.props.style)).toMatchObject({ color: claude.outputsInk, fontSize: 13 })
    expect(label.props.numberOfLines).toBe(1)
  })

  it('opens the sheet on a tap and is read "Open artifacts"', () => {
    const open = drawBar(2)
    const pill = host('artifacts-pill')!
    expect(pill.props.accessibilityLabel).toBe('Open artifacts')
    expect(pill.props.accessibilityRole).toBe('button')
    act(() => pill.props.onPress())
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('stays the last control in the session bar, after Plan', () => {
    drawBar(2, vi.fn(), vi.fn())
    const row = host('session-pill-row')!
    const order = row
      .findAll((node) => typeof node.type === 'string' && ['plan-pill', 'artifacts-pill'].includes(node.props.testID))
      .map((node) => node.props.testID)
    expect(order).toEqual(['plan-pill', 'artifacts-pill'])
  })
})
