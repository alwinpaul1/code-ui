import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeSessionPillPalette } from '../theme/claude-session-pill-palette'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { PUBLISHED_LINK, PUBLISHED_TITLE, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

// The Claude app's "N outputs" control (1.261013.20). Its session bar draws ONE outputs control
// (`u8z.h`, last in `u8z.e`, u8z.java:643-690). When two or more of pull requests, artifacts and a
// plan are present it is kind Mixed (os30.q, os30.java:687-711): the `files` glyph (U+E06F,
// wu0.java:122), "%d output(s)" counting PRs + artifacts + (plan ? 1 : 0) (`ns30.H`,
// ccr_thread_header_outputs), read "Open outputs" with a plan and "Open pull requests and
// artifacts" without (`ns30.G`). Its sheet is titled "Outputs" (`ccr_thread_outputs_title`,
// bottomsheet/b.java:2665-2683) and lists the plan, then "Pull requests (N)" and its rows, then
// "Artifacts (N)" and its rows (cv6 case 5; the headers only for Mixed, fp30.java:446-450).

const state = vi.hoisted(() => ({ pills: [] as unknown[], opened: [] as unknown[] }))
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
vi.mock('./use-session-pills', () => ({ useSessionPills: () => state.pills }))
vi.mock('./open-claude-artifact', () => ({ openClaudeArtifact: (link: unknown) => state.opened.push(link) }))
vi.mock('./ccr-session-cache', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ccrAccountForTab: () => 'acct',
  ccrAccountForConfigDir: () => null
}))

import { ThemeProvider } from '../theme/theme-context'
import { setClaudeArtifactListDepsForTests } from './claude-artifact-list-store'
import { CDS_OUTPUT_OUTLINES } from './ClaudeOutputsGlyph'
import { MobileSessionPillRow, OUTPUTS_PILL_HEIGHT, SessionPillRowView } from './MobileSessionPillRow'
import type { SessionArtifact } from './session-artifacts'
import type { SessionPill } from './session-pill-row-model'
import type { MobileSessionController } from './use-mobile-session-controller'

const PAGE: SessionArtifact = { uuid: PUBLISHED_UUID, url: PUBLISHED_LINK, title: PUBLISHED_TITLE }
const SECOND: SessionArtifact = { uuid: '0f8fad5b-d9cb-469f-a165-70867728950e', url: 'https://claude.ai/artifact/x', title: 'Second page' }
const PR: SessionPill = {
  kind: 'pull-request',
  number: 7701,
  label: '#7701',
  state: 'open',
  stateLabel: 'Open',
  tint: 'success',
  ci: 'passed',
  spoken: 'Pull request #7701',
  url: 'https://example.test/pr/7701'
}
const DIFF: SessionPill = { kind: 'diff', label: 'Diff', added: 3, removed: 1, url: 'https://example.test/pr/7701/files' }

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  state.pills = []
  state.opened = []
  setClaudeArtifactListDepsForTests(null)
})

const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
const pillStyle = (pill: ReactTestInstance) =>
  flat(typeof pill.props.style === 'function' ? pill.props.style({ pressed: false }) : pill.props.style)

function drawView(
  scheme: 'light' | 'dark',
  { pills = [], artifacts = 0, plan = false }: { pills?: SessionPill[]; artifacts?: number; plan?: boolean }
) {
  const onOpenOutputs = vi.fn()
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <SessionPillRowView
          pills={pills}
          onOpenPullRequest={vi.fn()}
          onCopyPrNumber={vi.fn()}
          onOpenPlan={plan ? vi.fn() : null}
          artifacts={artifacts > 0 ? { sessionCount: artifacts, onOpen: vi.fn() } : null}
          onOpenOutputs={onOpenOutputs}
        />
      </ThemeProvider>
    )
  })
  return onOpenOutputs
}

describe.each(['light', 'dark'] as const)('the outputs pill in %s mode', (scheme) => {
  const claude = claudeSessionPillPalette(scheme)

  it('keeps a lone pull request as its own pill, with no outputs pill', () => {
    drawView(scheme, { pills: [DIFF, PR] })
    expect(host('pull-request-pill')).toBeDefined()
    expect(host('outputs-pill')).toBeUndefined()
  })

  it('keeps lone artifacts as the artifacts pill, with no outputs pill', () => {
    drawView(scheme, { artifacts: 2 })
    expect(host('artifacts-pill')).toBeDefined()
    expect(host('outputs-pill')).toBeUndefined()
  })

  it('folds a pull request and an artifact into one "2 outputs" pill and drops their own pills', () => {
    const open = drawView(scheme, { pills: [DIFF, PR], artifacts: 1 })
    const pill = host('outputs-pill')!
    expect(texts(pill)).toEqual(['2 outputs'])
    expect(pill.props.accessibilityLabel).toBe('Open pull requests and artifacts')
    expect(host('pull-request-pill')).toBeUndefined()
    expect(host('artifacts-pill')).toBeUndefined()
    // Diff is not an output: it stays, before the outputs pill (u8z.e order).
    const order = host('session-pill-row')!
      .findAll((node) => typeof node.type === 'string' && ['diff-pill', 'outputs-pill'].includes(node.props.testID))
      .map((node) => node.props.testID)
    expect(order).toEqual(['diff-pill', 'outputs-pill'])
    act(() => pill.props.onPress())
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('counts all three kinds and reads "Open outputs" once there is a plan', () => {
    drawView(scheme, { pills: [PR], artifacts: 3, plan: true })
    const pill = host('outputs-pill')!
    expect(texts(pill)).toEqual(['5 outputs'])
    expect(pill.props.accessibilityLabel).toBe('Open outputs')
    expect(host('plan-pill')).toBeUndefined()
  })

  it('folds a plan and an artifact into "2 outputs", read "Open outputs"', () => {
    drawView(scheme, { artifacts: 1, plan: true })
    expect(texts(host('outputs-pill')!)).toEqual(['2 outputs'])
    expect(host('outputs-pill')!.props.accessibilityLabel).toBe('Open outputs')
  })

  it('is the outputs pill with the files glyph, in the outputs fill and ink', () => {
    drawView(scheme, { pills: [PR], artifacts: 1 })
    const pill = host('outputs-pill')!
    expect(pillStyle(pill)).toMatchObject({
      backgroundColor: claude.outputsFill,
      borderRadius: OUTPUTS_PILL_HEIGHT / 2,
      paddingHorizontal: 16,
      paddingVertical: 10
    })
    expect(OUTPUTS_PILL_HEIGHT + pill.props.hitSlop.top + pill.props.hitSlop.bottom).toBeGreaterThanOrEqual(48)
    const glyph = pill.find((child) => child.props.testID === 'outputs-pill-glyph' && typeof child.type === 'string')
    expect(glyph.props.width).toBe(16)
    expect(glyph.findByType('Path' as never).props).toMatchObject({ fill: claude.outputsInk, d: CDS_OUTPUT_OUTLINES.files })
    expect(flat(pill.find((child) => (child.type as unknown) === 'Text').props.style)).toMatchObject({
      color: claude.outputsInk,
      fontSize: 13
    })
  })
})

describe('a pill row with no Outputs sheet to open', () => {
  it('keeps the separate pills rather than draw an outputs pill that opens nothing', () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <SessionPillRowView
            pills={[PR]}
            onOpenPullRequest={vi.fn()}
            onCopyPrNumber={vi.fn()}
            artifacts={{ sessionCount: 1, onOpen: vi.fn() }}
          />
        </ThemeProvider>
      )
    })
    expect(host('outputs-pill')).toBeUndefined()
    expect(host('pull-request-pill')).toBeDefined()
    expect(host('artifacts-pill')).toBeDefined()
  })
})

function listAnswers(): void {
  const fetchImpl = vi.fn<CcrFetch>(async () => ({ ok: true, status: 200, json: async () => ({ frames: [] }) }))
  setClaudeArtifactListDepsForTests({
    load: async () =>
      ({
        fetch: fetchImpl,
        accounts: { list: async () => [{ id: 'acct', label: 'a', accessToken: 'tok', organizationUuid: 'org', error: null }] }
      }) as unknown as CcrPipelineDeps
  })
}

function controller(
  { artifacts = [], plan = null, claude = true }: { artifacts?: readonly SessionArtifact[]; plan?: string | null; claude?: boolean }
): MobileSessionController {
  return {
    showToast: vi.fn(),
    handlePanelTap: vi.fn(),
    nativeChatController: {
      nativeChatClaudePlan: claude ? plan : undefined,
      nativeChatClaudeArtifacts: claude
        ? { artifacts, account: { tabId: 'tab-1', epoch: 1, agentSessionId: 'sess', configDir: '/home/me/.claude' } }
        : undefined
    }
  } as unknown as MobileSessionController
}

async function mount(ctrl: MobileSessionController) {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <MobileSessionPillRow controller={ctrl} />
      </ThemeProvider>
    )
  })
}

describe('the Outputs sheet', () => {
  it('lists the plan, then the pull request, then the session’s artifacts, under "Outputs"', async () => {
    listAnswers()
    state.pills = [PR]
    await mount(controller({ artifacts: [PAGE, SECOND], plan: '# Plan' }))
    await act(async () => host('outputs-pill')!.props.onPress())
    expect(renderer!.root.find((node) => (node.type as unknown) === 'TitleBar').props.title).toBe('Outputs')
    const sheet = host('session-outputs-sheet')!
    const order = sheet
      .findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string' && /^outputs-(plan-row|section-|pr-row|artifact-row)/.test(node.props.testID))
      .map((node) => node.props.testID)
    expect(order).toEqual([
      'outputs-plan-row',
      'outputs-section-pull-requests',
      'outputs-pr-row-7701',
      'outputs-section-artifacts',
      // Newest first, as the Artifacts sheet lists them (sessionArtifactRows).
      `outputs-artifact-row-${SECOND.uuid}`,
      `outputs-artifact-row-${PAGE.uuid}`
    ])
    expect(texts(host('outputs-section-pull-requests')!)).toEqual(['Pull requests (1)'])
    expect(texts(host('outputs-section-artifacts')!)).toEqual(['Artifacts (2)'])
    expect(texts(host('outputs-pr-row-7701')!)).toEqual(['#7701', 'Open', 'CI'])
  })

  it('opens the pull request as its pill would', async () => {
    listAnswers()
    state.pills = [PR]
    const ctrl = controller({ artifacts: [PAGE] })
    await mount(ctrl)
    await act(async () => host('outputs-pill')!.props.onPress())
    await act(async () => host('outputs-pr-row-7701')!.props.onPress())
    expect(ctrl.handlePanelTap).toHaveBeenCalledWith('pr')
    expect(host('session-outputs-sheet')).toBeUndefined()
  })

  it('opens the plan sheet from the plan row', async () => {
    listAnswers()
    await mount(controller({ artifacts: [PAGE], plan: '# Ship it' }))
    await act(async () => host('outputs-pill')!.props.onPress())
    await act(async () => host('outputs-plan-row')!.props.onPress())
    expect(host('session-outputs-sheet')).toBeUndefined()
    expect(renderer!.root.find((node) => (node.type as unknown) === 'TitleBar').props.title).toBe('Plan')
  })

  it('opens an artifact in the viewer from its row', async () => {
    listAnswers()
    state.pills = [PR]
    await mount(controller({ artifacts: [PAGE] }))
    await act(async () => host('outputs-pill')!.props.onPress())
    await act(async () => host(`outputs-artifact-row-${PAGE.uuid}`)!.props.onPress())
    expect(state.opened).toEqual([{ url: PUBLISHED_LINK, title: PUBLISHED_TITLE }])
    expect(host('session-outputs-sheet')).toBeUndefined()
  })

  it('draws no outputs pill on a Codex or shell tab, even beside a pull request', async () => {
    listAnswers()
    state.pills = [PR]
    await mount(controller({ claude: false }))
    expect(host('outputs-pill')).toBeUndefined()
    expect(host('artifacts-pill')).toBeUndefined()
    expect(host('pull-request-pill')).toBeDefined()
  })
})
