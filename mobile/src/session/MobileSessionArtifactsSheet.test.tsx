import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { PUBLISHED_LINK, PUBLISHED_TITLE, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

// The session's Artifacts sheet (the Claude app's, m74.java:179-190): the session's own pages only,
// the account they belong to, the order, titles from the account's list, and a tap.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { visible: boolean; header: unknown; children: unknown }) =>
    props.visible ? createElement('Drawer', null, props.header as never, props.children as never) : null
}))
vi.mock('./MobileSheetTitleBar', () => ({ MobileSheetTitleBar: (props: { title: string }) => createElement('TitleBar', { title: props.title }) }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('./open-claude-artifact', () => ({ openClaudeArtifact: opened }))

import { ThemeProvider } from '../theme/theme-context'
import { setClaudeArtifactListDepsForTests } from './claude-artifact-list-store'
import { MobileSessionArtifactsSheet } from './MobileSessionArtifactsSheet'
import type { SessionArtifact } from './session-artifacts'

const NOW = Date.parse('2026-10-16T15:00:00Z')
const MINE_UUID = 'a0000000-0000-4000-8000-000000000001'
const SHARED_UUID = 'a0000000-0000-4000-8000-000000000002'
const OLDER_UUID = 'a0000000-0000-4000-8000-000000000003'
const LIST = {
  frames: [
    // The session's own page is in the account's list too, under its real title.
    { slug: PUBLISHED_UUID, title: PUBLISHED_TITLE, rel: 'mine', updatedAt: '2026-10-16T14:59:00Z' },
    { slug: OLDER_UUID, title: 'Older page', rel: 'mine', updatedAt: '2026-10-14T15:00:00Z' },
    { slug: MINE_UUID, title: 'Release dashboard', rel: 'mine', updatedAt: '2026-10-16T12:00:00Z' },
    { slug: SHARED_UUID, title: 'Team roadmap', rel: 'shared', updatedAt: '2026-10-15T15:00:00Z' }
  ]
}
const SESSION: SessionArtifact[] = [{ uuid: PUBLISHED_UUID, url: PUBLISHED_LINK, title: 'code-ui-artifact-check.html' }]

function pipeline(fetchImpl: CcrFetch): CcrPipelineDeps {
  return {
    fetch: fetchImpl,
    accounts: {
      list: async () => [{ id: 'acct', label: 'Personal', accessToken: 'tok', organizationUuid: 'org', error: null }],
      rememberProfile: async () => null,
      forgetOrganization: async () => undefined
    }
  } as unknown as CcrPipelineDeps
}
const answers = (body: unknown): CcrFetch => vi.fn<CcrFetch>(async () => ({ ok: true, status: 200, json: async () => body }))

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  setClaudeArtifactListDepsForTests(null)
  opened.mockReset()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount(props: { artifacts?: readonly SessionArtifact[]; accountId?: string | null; scheme?: 'light' | 'dark'; onClose?: () => void }) {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={props.scheme ?? 'light'}>
        <MobileSessionArtifactsSheet
          visible
          onClose={props.onClose ?? vi.fn()}
          artifacts={props.artifacts ?? SESSION}
          accountId={props.accountId === undefined ? 'acct' : props.accountId}
        />
      </ThemeProvider>
    )
  })
}

const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
function flat(style: unknown): Record<string, unknown> {
  const value = typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style
  return Object.assign({}, ...[value].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}

describe("the session's Artifacts sheet", () => {
  // Reported 2026-10-16 (on the phone): the sheet of a session that had made no page listed all 8
  // of the account's artifacts under "Your artifacts". The Claude app lists only the session's own
  // (m74.java:179-190); the account's others belong in the gallery, not here.
  it("lists only this session's pages, never the account's others or the shared ones", async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount({})
    expect(renderer!.root.find((node) => (node.type as unknown) === 'TitleBar').props.title).toBe('Artifacts')
    expect(texts(host('artifacts-section-session')!)).toEqual(['This session (1)', PUBLISHED_TITLE, 'Artifact · claude.ai'])
    expect(host('artifacts-section-mine')).toBeUndefined()
    expect(host('artifacts-section-shared')).toBeUndefined()
    expect(host(`artifact-row-${MINE_UUID}`)).toBeUndefined()
    expect(host(`artifact-row-${SHARED_UUID}`)).toBeUndefined()
  })

  it('names the account the session belongs to', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount({})
    expect(texts(host('artifacts-account')!)).toEqual(['Account: Personal'])
  })

  it('says the account is not known rather than guessing one, and reads no list', async () => {
    const fetchImpl = answers(LIST)
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    await mount({ accountId: null })
    expect(texts(host('artifacts-account')!)).toEqual(['Account not known'])
    expect(texts(host('artifacts-section-session')!)[1]).toBe('code-ui-artifact-check.html')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('lists the session newest made first', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers({ frames: [] })) })
    await mount({
      artifacts: [
        { uuid: MINE_UUID, url: 'https://claude.ai/artifact/a', title: 'first.html' },
        { uuid: SHARED_UUID, url: 'https://claude.ai/artifact/b', title: 'second.html' }
      ]
    })
    expect(texts(host('artifacts-section-session')!).filter((text) => text.endsWith('.html'))).toEqual(['second.html', 'first.html'])
  })

  it("keeps the call's own title, with no error row, when the account's list cannot be read", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchImpl = vi.fn<CcrFetch>(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    await mount({})
    expect(texts(host('artifacts-section-session')!)).toEqual(['This session (1)', 'code-ui-artifact-check.html', 'Artifact · claude.ai'])
    expect(host('artifacts-list-failed')).toBeUndefined()
  })

  it('reads the list again each time it opens, for the titles', async () => {
    const fetchImpl = answers(LIST)
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    await mount({})
    await act(async () => renderer!.unmount())
    await mount({})
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('opens a tapped page in the viewer under its title, and closes', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    const onClose = vi.fn()
    await mount({ onClose })
    act(() => host(`artifact-row-${PUBLISHED_UUID}`)!.props.onPress())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith({ url: PUBLISHED_LINK, title: PUBLISHED_TITLE })
  })
})

describe.each(['light', 'dark'] as const)('the sheet’s rows in %s mode', (scheme) => {
  const colors = scheme === 'light' ? lightColors : darkColors
  it('draw on the scheme’s raised surface with the violet glyph', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers({ frames: [] })) })
    await mount({ scheme })
    const row = host(`artifact-row-${PUBLISHED_UUID}`)!
    expect(flat(row.props.style)).toMatchObject({ backgroundColor: colors.bgRaised, borderColor: colors.border })
    expect(row.find((node) => (node.type as unknown) === 'Path').props.fill).toBe(colors.mergedPurple)
    const [title, subtitle] = row.findAll((node) => (node.type as unknown) === 'Text')
    expect(flat(title!.props.style).color).toBe(colors.text)
    expect(flat(subtitle!.props.style).color).toBe(colors.textSecondary)
  })
})
