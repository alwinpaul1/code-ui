import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Discussion section of a Linear issue's detail sheet, when the desktop refused the comment
 * read. `linear.issueComments` is a skip read, so a refusal used to reach the sheet as an empty
 * list, and the section said "No comments." with a "No comments yet" count over an issue that may
 * have many (review, 2026-09-30). The round-2 fix took the same false claim out of the Linear state
 * list ("No states available"); this one was left.
 *
 * Rendered through the detail content itself, in both themes, with the colours and styles the live
 * theme gives the Tasks surface.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { addListener: () => ({ remove: () => undefined }), dismiss: () => undefined },
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  Linking: { openURL: async () => undefined },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => String(name) }))
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'host-1' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() })
}))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() })
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: null, state: 'disconnected' })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null,
  useReconnectAttempt: () => 0,
  useRelayRecoveryStatus: () => ({})
}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn(), triggerSelection: vi.fn() }))
vi.mock('../platform/external-link', () => ({ openExternalLink: vi.fn() }))
vi.mock('../platform/clipboard', () => ({
  useClipboardWriter: () => ({ writeText: async () => undefined }),
  useClipboardReader: () => ({})
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: ReactNode }) => children
}))
vi.mock('../components/PickerModal', () => ({ PickerModal: () => null }))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: () => null }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../components/TaskProviderLogo', () => ({ TaskProviderLogo: () => null }))

import { ThemeProvider, useTheme, useThemedStyles } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { mobileTasksStyles } from './mobile-tasks-legacy-styles'
import { renderMobileTasksItemDetailContent } from './mobile-tasks-item-detail-content'
import {
  detailCommentGroupId,
  detailCommentGroupRoot,
  groupDetailComments
} from './mobile-tasks-item-comments'
import type { DetailCommentGroup } from './mobile-tasks-view-state-types'

const LINEAR_ITEM = {
  key: 'linear:ENG-1',
  provider: 'linear',
  title: 'Fix it',
  subtitle: 'ENG-1',
  status: 'Todo',
  updatedAt: '2026-09-30T00:00:00Z',
  source: {
    id: 'issue-1',
    identifier: 'ENG-1',
    title: 'Fix it',
    workspaceId: 'ws-1',
    team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
    state: { name: 'Todo', type: 'unstarted', color: '#000000' }
  }
}

const LINEAR_PAYLOAD = {
  provider: 'linear',
  description: 'the description',
  comments: [],
  labels: [],
  children: []
}

function flat(style: unknown): Record<string, unknown> {
  const raw = typeof style === 'function' ? style({ pressed: false }) : style
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

const textOf = (node: ReactTestInstance): string => [node.props.children].flat().join('')

const texts = (root: ReactTestInstance, children: string): ReactTestInstance[] =>
  root.findAll((node) => String(node.type) === 'Text' && textOf(node) === children)

function Sheet(props: { payload: Record<string, unknown>; refresh: (next: unknown) => void }) {
  const theme = useTheme()
  const styles = useThemedStyles(mobileTasksStyles)
  // The members the detail content reads for a Linear issue whose detail loaded. Anything else it
  // reads is behind a flag that is off, or belongs to another provider.
  const model = {
    actionItem: LINEAR_ITEM,
    colors: theme.colors,
    styles,
    detailLoading: false,
    detailError: '',
    detailPayload: props.payload,
    // The groups the screen memoizes from the payload's comments (use-mobile-tasks-item-state.tsx),
    // drawn as one line each naming the group and its body, so a test can see which were drawn.
    detailCommentGroups: groupDetailComments(
      (props.payload.comments ?? []) as Parameters<typeof groupDetailComments>[0]
    ),
    linearCommentDraft: '',
    linearSubIssueTitle: '',
    mutatingStatus: false,
    renderCommentComposer: () => null,
    renderDetailCommentGroup: (group: DetailCommentGroup) =>
      createElement(
        'Text',
        { key: detailCommentGroupId(group) },
        `${detailCommentGroupId(group)}: ${detailCommentGroupRoot(group).body}`
      ),
    setDetailRefreshSeq: props.refresh
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the members above are the ones this render path reads.
  return renderMobileTasksItemDetailContent(model as never)
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function renderSheet(
  scheme: string,
  payload: Record<string, unknown>,
  refresh: (next: unknown) => void = () => undefined
): Promise<ReactTestInstance> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme as 'light' | 'dark'}>
        <Sheet payload={payload} refresh={refresh} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])('the Discussion section in a %s session', (scheme, palette) => {
  it('says the comments could not be loaded, not "No comments.", when the desktop refused them', async () => {
    const refresh = vi.fn()
    const root = await renderSheet(scheme, { ...LINEAR_PAYLOAD, commentsFailed: true }, refresh)

    const failure = texts(root, "Couldn't load comments")
    expect(failure).toHaveLength(1)
    expect(flat(failure[0]!.props.style).color).toBe(palette.danger)
    // No claim about the issue's comments at all: neither the empty line nor a zero count.
    expect(texts(root, 'No comments.')).toHaveLength(0)
    expect(texts(root, 'No comments yet')).toHaveLength(0)
    expect(texts(root, 'Discussion')).toHaveLength(1)

    const retry = root.find((node) => node.props.accessibilityLabel === 'Retry loading comments')
    expect(flat(retry.props.style).borderColor).toBe(palette.border)
    expect(flat(texts(retry, 'Retry')[0]!.props.style).color).toBe(palette.text)
    act(() => retry.props.onPress())
    // Retry asks for the detail again, as the refresh icon does, which reads the comments with it.
    expect(refresh).toHaveBeenCalledTimes(1)
    const step = refresh.mock.calls[0]![0] as (current: number) => number
    expect(step(4)).toBe(5)
  })

  // Posting on an issue whose list the desktop refused worked on the desktop and cleared the
  // draft, but the section kept drawing only "Couldn't load comments", so the comment never
  // appeared: it seemed to vanish, and posting it again made a duplicate (review, 2026-09-30).
  it('shows the comment just posted while the earlier ones could not be read', async () => {
    const refresh = vi.fn()
    const posted = {
      id: 'comment-9',
      body: 'the comment I just posted',
      createdAt: '2026-09-30T12:00:00Z',
      user: { displayName: 'You' }
    }
    const root = await renderSheet(
      scheme,
      { ...LINEAR_PAYLOAD, comments: [posted], commentsFailed: true },
      refresh
    )

    // Drawn through the list's own groups and group renderer, under a line that says the rest
    // could not be read.
    const comment = texts(root, 'comment:comment-9: the comment I just posted')
    expect(comment).toHaveLength(1)
    const note = texts(root, "Couldn't load the earlier comments")
    expect(note).toHaveLength(1)
    expect(flat(note[0]!.props.style).color).toBe(palette.danger)
    const drawn = root.findAll((node) => String(node.type) === 'Text').map(textOf)
    expect(drawn.indexOf("Couldn't load the earlier comments")).toBeLessThan(
      drawn.indexOf('comment:comment-9: the comment I just posted')
    )
    // Not the no-list line, and no count: one comment on screen is not the issue's total.
    expect(texts(root, "Couldn't load comments")).toHaveLength(0)
    expect(texts(root, '1 comment')).toHaveLength(0)
    expect(texts(root, 'No comments.')).toHaveLength(0)

    const retry = root.find((node) => node.props.accessibilityLabel === 'Retry loading comments')
    expect(flat(retry.props.style).borderColor).toBe(palette.border)
    expect(flat(texts(retry, 'Retry')[0]!.props.style).color).toBe(palette.text)
    act(() => retry.props.onPress())
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('still says "No comments." for an issue whose list came back empty', async () => {
    const root = await renderSheet(scheme, LINEAR_PAYLOAD)

    const empty = texts(root, 'No comments.')
    expect(empty).toHaveLength(1)
    expect(flat(empty[0]!.props.style).color).toBe(palette.textSecondary)
    expect(texts(root, 'No comments yet')).toHaveLength(1)
    expect(texts(root, "Couldn't load comments")).toHaveLength(0)
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Retry loading comments')).toEqual(
      []
    )
  })
})
