import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { createElement, Fragment } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { claudeArtifactUrl } from './claude-artifacts'

// The account's Artifacts gallery (the Claude app's Artifacts tab, xo30.java / jbh.java) as drawn:
// its states, the dropdowns and search, each row, a tap, and both themes. Every read goes through
// the real list store with only the network and the sign-ins stood in for.

// Every row count the list was ever drawn with, so a frame drawn between two reads is seen too.
const listDraws = vi.hoisted(() => [] as number[])
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: (props: {
    testID: string
    data: readonly { uuid: string }[]
    renderItem: (info: { item: unknown; index: number }) => unknown
    keyExtractor: (item: never) => string
    ListHeaderComponent: unknown
    ListEmptyComponent: unknown
    refreshControl: unknown
  }) => {
    listDraws.push(props.data.length)
    return createElement(
      'FlatList',
      { testID: props.testID, refreshControl: props.refreshControl },
      props.ListHeaderComponent as never,
      props.data.length === 0
        ? (props.ListEmptyComponent as never)
        : props.data.map((item, index) => createElement(Fragment, { key: props.keyExtractor(item as never) }, props.renderItem({ item, index }) as never))
    )
  },
  Image: 'Image',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('../ui/ScreenHeader', () => ({
  ScreenHeader: (props: { title: string; onBack: () => void }) => createElement('ScreenHeader', { title: props.title, onBack: props.onBack })
}))
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: { visible: boolean; actions: { label: string; selected?: boolean; onPress: () => void }[]; onClose: () => void }) =>
    props.visible
      ? createElement(
          'Sheet',
          null,
          props.actions.map((action) =>
            createElement('SheetAction', {
              key: action.label,
              label: action.label,
              selected: action.selected === true,
              onPress: () => {
                action.onPress()
                props.onClose()
              }
            })
          )
        )
      : null
}))
const opened = vi.hoisted(() => vi.fn())
vi.mock('./open-claude-artifact', () => ({ openClaudeArtifact: opened }))

import { ThemeProvider } from '../theme/theme-context'
import { setClaudeArtifactListDepsForTests } from './claude-artifact-list-store'
import { ClaudeArtifactGallery } from './ClaudeArtifactGallery'

const NOW = Date.parse('2026-10-16T15:00:00Z')
const MINE = 'a0000000-0000-4000-8000-000000000001'
const PINNED = 'a0000000-0000-4000-8000-000000000002'
const SHARED = 'a0000000-0000-4000-8000-000000000003'
const THUMB = `https://${MINE}.frame.claudeusercontent.com/_f/3/_thumb.img?__frame_t=TOKEN`
// Shaped as the live list answered on 2026-10-16 (P18): audiences `owner` and `public`, one
// `type_title` "Design" beside rows with none, a thumbnail on some rows only.
const LIST = {
  frames: [
    { slug: MINE, title: 'Release dashboard', rel: 'mine', updatedAt: '2026-10-16T12:00:00Z', audience: 'owner', thumbImgURL: THUMB, type_title: 'Design' },
    { slug: PINNED, title: 'Pinned notes', rel: 'mine', updatedAt: '2026-10-14T15:00:00Z', audience: 'public', starred: true, type_title: null },
    { slug: SHARED, title: 'Team roadmap', rel: 'shared', created_at: '2026-10-15T15:00:00Z', owner_email: 'ada@example.com' }
  ],
  starsEnabled: true,
  thumbsEnabled: true
}

type Account = { id: string; label: string }
function pipeline(fetchImpl: CcrFetch, accounts: Account[] = [{ id: 'acct', label: 'Personal' }]): CcrPipelineDeps {
  return {
    fetch: fetchImpl,
    accounts: {
      list: async (only?: string) =>
        accounts
          .filter((account) => only === undefined || account.id === only)
          .map((account) => ({ ...account, accessToken: `tok-${account.id}`, organizationUuid: 'org', error: undefined })),
      rememberProfile: async () => '',
      forgetOrganization: async () => undefined
    }
  } as unknown as CcrPipelineDeps
}
const answers = (body: unknown) => vi.fn<CcrFetch>(async () => ({ ok: true, status: 200, json: async () => body }))

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  setClaudeArtifactListDepsForTests(null)
  opened.mockReset()
  listDraws.length = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function mount(scheme: 'light' | 'dark' = 'light', onBack = vi.fn()) {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <ClaudeArtifactGallery onBack={onBack} />
      </ThemeProvider>
    )
  })
  await settle()
}

const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const all = (prefix: string): ReactTestInstance[] =>
  renderer!.root.findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith(prefix))
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
const rowTitles = () => all('artifact-gallery-row-').map((row) => texts(row)[0])
function flat(style: unknown): Record<string, unknown> {
  const value = typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style
  return Object.assign({}, ...[value].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
async function pick(dropdownTestID: string, label: string) {
  await act(async () => host(dropdownTestID)!.props.onPress())
  const action = renderer!.root.findAll((node) => (node.type as unknown) === 'SheetAction' && node.props.label === label)[0]
  if (!action) {
    throw new Error(`no "${label}" in the picker`)
  }
  await act(async () => action.props.onPress())
}
const sheetLabels = () => renderer!.root.findAll((node) => (node.type as unknown) === 'SheetAction').map((node) => node.props.label as string)

describe('the Artifacts gallery', () => {
  it('is titled Artifacts, goes back from its bar, and lists every row newest first', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    const onBack = vi.fn()
    await mount('light', onBack)
    const header = renderer!.root.find((node) => (node.type as unknown) === 'ScreenHeader')
    expect(header.props.title).toBe('Artifacts')
    header.props.onBack()
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(rowTitles()).toEqual(['Release dashboard', 'Team roadmap', 'Pinned notes'])
    expect(host('artifact-gallery-search')!.props.placeholder).toBe('Search artifacts')
  })

  it('draws an own row as title, who can open it, and when it was edited', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount()
    expect(texts(host(`artifact-gallery-row-${MINE}`)!)).toEqual(['Release dashboard', 'Only you', 'Edited 3h ago'])
    expect(texts(host(`artifact-gallery-row-${PINNED}`)!)).toEqual(['Pinned notes', 'Anyone with link', 'Edited 2d ago'])
    expect(texts(host(`artifact-gallery-row-${SHARED}`)!)).toEqual(['Team roadmap', 'By ada@example.com', 'Created 1d ago'])
    expect(host(`artifact-gallery-row-${MINE}`)!.props.accessibilityHint).toBe('Open artifact')
  })

  it('loads a thumbnail with no headers, and draws the artifacts glyph for a row without one or one that fails', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount()
    const image = host(`artifact-gallery-row-${MINE}`)!.findAll((node) => (node.type as unknown) === 'Image')[0]!
    expect(image.props.source).toEqual({ uri: THUMB })
    expect(image.props.source.headers).toBeUndefined()
    expect(host(`artifact-gallery-row-${SHARED}`)!.findAll((node) => node.props.testID === 'artifact-gallery-thumb-glyph')).not.toHaveLength(0)
    await act(async () => image.props.onError())
    const mine = host(`artifact-gallery-row-${MINE}`)!
    expect(mine.findAll((node) => (node.type as unknown) === 'Image')).toHaveLength(0)
    expect(mine.findAll((node) => node.props.testID === 'artifact-gallery-thumb-glyph')).not.toHaveLength(0)
  })

  it('puts the pin badge on a starred row only', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount()
    expect(host(`artifact-gallery-row-${PINNED}`)!.findAll((node) => node.props.testID === 'artifact-gallery-pinned')).not.toHaveLength(0)
    expect(host(`artifact-gallery-row-${MINE}`)!.findAll((node) => node.props.testID === 'artifact-gallery-pinned')).toHaveLength(0)
    const badge = flat(host(`artifact-gallery-row-${PINNED}`)!.findAll((node) => node.props.testID === 'artifact-gallery-pinned')[0]!.props.style)
    expect(badge).toMatchObject({ position: 'absolute', top: -4, right: -4, width: 24, height: 24 })
  })

  it('opens the artifact in the viewer on a tap', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount()
    host(`artifact-gallery-row-${SHARED}`)!.props.onPress()
    expect(opened).toHaveBeenCalledWith({ url: claudeArtifactUrl(SHARED), title: 'Team roadmap' })
  })

  it('lists by the list dropdown, in the app’s order, and says No artifacts match under an empty Pinned', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount()
    expect(host('artifact-gallery-list-filter')!.props.accessibilityLabel).toBe('Choose artifacts to list')
    await act(async () => host('artifact-gallery-list-filter')!.props.onPress())
    expect(sheetLabels()).toEqual(['All', 'Pinned', 'Yours', 'Shared with you'])
    await act(async () => renderer!.root.findAll((node) => (node.type as unknown) === 'SheetAction' && node.props.label === 'Pinned')[0]!.props.onPress())
    expect(rowTitles()).toEqual(['Pinned notes'])
    await pick('artifact-gallery-list-filter', 'Yours')
    expect(rowTitles()).toEqual(['Release dashboard', 'Pinned notes'])
    await pick('artifact-gallery-list-filter', 'Shared with you')
    expect(rowTitles()).toEqual(['Team roadmap'])

    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers({ frames: [LIST.frames[0]] })) })
    act(() => renderer?.unmount())
    await mount()
    await pick('artifact-gallery-list-filter', 'Pinned')
    expect(rowTitles()).toEqual([])
    expect(texts(host('artifact-gallery-empty')!)).toEqual(['No artifacts match'])
  })

  it('offers a type dropdown with Other when a row names a type, and none when no row does', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount()
    await act(async () => host('artifact-gallery-type-filter')!.props.onPress())
    expect(sheetLabels()).toEqual(['All types', 'Design', 'Other'])
    await act(async () => renderer!.root.findAll((node) => (node.type as unknown) === 'SheetAction' && node.props.label === 'Other')[0]!.props.onPress())
    expect(rowTitles()).toEqual(['Team roadmap', 'Pinned notes'])
    await pick('artifact-gallery-type-filter', 'Design')
    expect(rowTitles()).toEqual(['Release dashboard'])

    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers({ frames: [LIST.frames[2]] })) })
    act(() => renderer?.unmount())
    await mount()
    expect(host('artifact-gallery-type-filter')).toBeUndefined()
    expect(rowTitles()).toEqual(['Team roadmap'])
  })

  // A type is matched by what it is, not by the words it is drawn with: a type that is literally
  // titled "Other" or "All types" is not the built-in choice of that name (review 2026-10-16).
  it('keeps a type titled "Other" apart from the rows with no type', async () => {
    const frames = [
      { ...LIST.frames[0], title: 'Typed other', type_title: 'Other' },
      { ...LIST.frames[1], title: 'No type', type_title: null }
    ]
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers({ frames })) })
    await mount()
    await act(async () => host('artifact-gallery-type-filter')!.props.onPress())
    const others = () => renderer!.root.findAll((node) => (node.type as unknown) === 'SheetAction' && node.props.label === 'Other')
    expect(others()).toHaveLength(2)
    // The last "Other" is the built-in one: the rows with no type.
    await act(async () => others()[1]!.props.onPress())
    expect(rowTitles()).toEqual(['No type'])
    await act(async () => host('artifact-gallery-type-filter')!.props.onPress())
    expect(others().map((action) => action.props.selected)).toEqual([false, true])
    await act(async () => others()[0]!.props.onPress())
    expect(rowTitles()).toEqual(['Typed other'])
    await act(async () => host('artifact-gallery-type-filter')!.props.onPress())
    expect(others().map((action) => action.props.selected)).toEqual([true, false])
  })

  it('keeps a type titled "All types" from being taken for every type', async () => {
    const frames = [
      { ...LIST.frames[0], title: 'Typed all', type_title: 'All types' },
      { ...LIST.frames[1], title: 'A design', type_title: 'Design' }
    ]
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers({ frames })) })
    await mount()
    await act(async () => host('artifact-gallery-type-filter')!.props.onPress())
    const allTypes = () => renderer!.root.findAll((node) => (node.type as unknown) === 'SheetAction' && node.props.label === 'All types')
    expect(allTypes().map((action) => action.props.selected)).toEqual([true, false])
    await act(async () => allTypes()[1]!.props.onPress())
    expect(rowTitles()).toEqual(['Typed all'])
  })

  it('searches the titles 300 ms after the typing stops', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount()
    await act(async () => host('artifact-gallery-search')!.props.onChangeText('road'))
    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(rowTitles()).toHaveLength(3)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(rowTitles()).toEqual(['Team roadmap'])
    await act(async () => host('artifact-gallery-search')!.props.onChangeText('nothing like it'))
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(texts(host('artifact-gallery-empty')!)).toEqual(['No artifacts match'])
  })

  it('welcomes an account with no artifacts, with the artifacts glyph', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers({ frames: [] })) })
    await mount()
    expect(texts(host('artifact-gallery-empty')!)).toEqual(['Artifacts you’ve had with Claude will show up here.'])
    expect(host('artifact-gallery-empty')!.findAll((node) => (node.type as unknown) === 'Svg')).toHaveLength(1)
    expect(host('artifact-gallery-type-filter')).toBeUndefined()
  })

  it('shows a large spinner until the first read answers, never the empty welcome', async () => {
    let answer: (value: { ok: true; status: number; json: () => Promise<unknown> }) => void = () => undefined
    const fetchImpl = vi.fn<CcrFetch>(() => new Promise((resolve) => (answer = resolve)))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    await mount()
    expect(host('artifact-gallery-loading')!.findAll((node) => (node.type as unknown) === 'ActivityIndicator')[0]!.props.size).toBe('large')
    expect(host('artifact-gallery-empty')).toBeUndefined()
    // Not for one frame either: the store starts its read only after the account's first draw.
    expect(listDraws).toEqual([])
    await act(async () => answer({ ok: true, status: 200, json: async () => ({ frames: [LIST.frames[0]] }) }))
    await settle()
    expect(host('artifact-gallery-loading')).toBeUndefined()
    expect(rowTitles()).toEqual(['Release dashboard'])
  })

  it('says why a refused read failed beside a Retry that reads again even though one just ran', async () => {
    let fail = true
    const fetchImpl = vi.fn<CcrFetch>(async () => (fail ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => LIST }))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await mount()
    const error = host('artifact-gallery-error')!
    expect(texts(error)).toEqual(['artifacts: http (HTTP 503)', 'Retry'])
    expect(error.findAll((node) => (node.type as unknown) === 'Svg')).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fail = false
    await act(async () => host('artifact-gallery-retry')!.props.onPress())
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(host('artifact-gallery-error')).toBeUndefined()
    expect(rowTitles()).toHaveLength(3)
  })

  it('keeps the rows it has when a pull to refresh fails, and says so above them', async () => {
    let fail = false
    const fetchImpl = vi.fn<CcrFetch>(async () => (fail ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => LIST }))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await mount()
    fail = true
    await act(async () => host('artifact-gallery-list')!.props.refreshControl.props.onRefresh())
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(rowTitles()).toHaveLength(3)
    expect(texts(host('artifact-gallery-stale')!)).toEqual(['artifacts: http (HTTP 500)', 'Retry'])
    expect(host('artifact-gallery-list')!.props.refreshControl.props.refreshing).toBe(false)
  })

  it('offers no account picker with one account, and lists the chosen account’s artifacts with several', async () => {
    const lists: Record<string, unknown> = { personal: LIST, work: { frames: [{ slug: SHARED, title: 'Work board', rel: 'mine', audience: 'owner' }] } }
    const fetchImpl = vi.fn<CcrFetch>(async (_url, init) => ({ ok: true, status: 200, json: async () => lists[init.headers.Authorization!.replace('Bearer tok-', '')] }))
    setClaudeArtifactListDepsForTests({
      load: async () =>
        pipeline(fetchImpl, [
          { id: 'personal', label: 'Personal' },
          { id: 'work', label: 'Acme' }
        ])
    })
    await mount()
    expect(host('artifact-gallery-account')!.props.accessibilityValue).toEqual({ text: 'Personal' })
    expect(rowTitles()).toHaveLength(3)
    await pick('artifact-gallery-account', 'Acme')
    await settle()
    expect(rowTitles()).toEqual(['Work board'])
    expect(host('artifact-gallery-account')!.props.accessibilityValue).toEqual({ text: 'Acme' })

    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    act(() => renderer?.unmount())
    await mount()
    expect(host('artifact-gallery-account')).toBeUndefined()
  })

  it('says to sign in when no account is signed in, and reads no list', async () => {
    const fetchImpl = answers(LIST)
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl, []) })
    await mount()
    expect(texts(host('artifact-gallery-no-account')!)).toEqual(['Sign in to an Anthropic account in Settings to see your artifacts.'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('says why the sign-ins could not be read, and Retry reads them again', async () => {
    let refuse = true
    const fetchImpl = answers(LIST)
    const base = pipeline(fetchImpl)
    const list = base.accounts.list
    base.accounts.list = async (only?: string) => {
      if (refuse) {
        throw new Error('the stored value is not a list of accounts')
      }
      return list(only)
    }
    setClaudeArtifactListDepsForTests({ load: async () => base })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await mount()
    expect(texts(host('artifact-gallery-error')!)).toEqual(['the stored value is not a list of accounts', 'Retry'])
    expect(fetchImpl).not.toHaveBeenCalled()
    refuse = false
    await act(async () => host('artifact-gallery-retry')!.props.onPress())
    await settle()
    expect(rowTitles()).toHaveLength(3)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws its surfaces from the %s theme', async (scheme, colors) => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(answers(LIST)) })
    await mount(scheme)
    expect(flat(host('artifact-gallery')!.props.style).backgroundColor).toBe(colors.bg)
    expect(flat(host(`artifact-gallery-row-${PINNED}`)!.props.style)).toMatchObject({ backgroundColor: colors.bgPanel, borderColor: colors.border })
    expect(flat(host(`artifact-gallery-row-${PINNED}`)!.findAll((node) => node.props.testID === 'artifact-gallery-thumb')[0]!.props.style).backgroundColor).toBe(colors.bgRaised)
    expect(host('artifact-gallery-search')!.props.placeholderTextColor).toBe(colors.textMuted)
    expect(flat(host('artifact-gallery-search')!.props.style).color).toBe(colors.text)
    const title = host(`artifact-gallery-row-${PINNED}`)!.findAll((node) => (node.type as unknown) === 'Text')[0]!
    expect(flat(title.props.style).color).toBe(colors.text)
  })
})
