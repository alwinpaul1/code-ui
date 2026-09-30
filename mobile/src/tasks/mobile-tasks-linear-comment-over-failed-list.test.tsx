import { createElement, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Posting a comment on a Linear issue whose comment list the desktop refused. The post worked on
 * the desktop and cleared the draft, and the comment never appeared: the Discussion section drew
 * only "Couldn't load comments" over it, so the user saw it vanish and could post it again, which
 * made a duplicate (review, 2026-09-30). mobile-tasks-item-discussion.test.tsx pins how the
 * section draws such a list; this file pins what the detail read and the post leave in it.
 *
 * The two stages are mounted the way MobileTasksScreen mounts them, over one model: the detail
 * read (with the host's `lastConnectedAt`) and the Linear item actions.
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
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))
vi.mock('../components/PickerModal', () => ({ PickerModal: () => null }))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: () => null }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../components/TaskProviderLogo', () => ({ TaskProviderLogo: () => null }))

import { useMobileTasksItemDetailLoading } from './use-mobile-tasks-item-detail-loading'
import { useMobileTasksLinearItemActions } from './use-mobile-tasks-linear-item-actions'

function linearIssue(id: string, identifier: string) {
  return {
    id,
    identifier,
    title: 'Fix it',
    url: `https://linear.app/acme/issue/${identifier}`,
    updatedAt: '2026-09-30T00:00:00Z',
    priority: 0,
    labels: [],
    state: { name: 'Todo', type: 'unstarted', color: '#000000' },
    team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
    workspaceId: 'ws-1',
    subIssues: []
  }
}

function linearItem(issue: ReturnType<typeof linearIssue>) {
  return {
    key: `linear:${issue.identifier}`,
    provider: 'linear',
    title: issue.title,
    subtitle: issue.identifier,
    status: 'Todo',
    updatedAt: issue.updatedAt,
    source: issue
  }
}

const ISSUE = linearIssue('issue-1', 'ENG-1')
const ITEM = linearItem(ISSUE)
const OTHER_ISSUE = linearIssue('issue-2', 'ENG-2')
const OTHER_ITEM = linearItem(OTHER_ISSUE)

/** The desktop's refusal of the comment read (a skip read: the issue itself still loads). */
const REFUSED = { ok: false, error: { code: 'internal', message: 'boom' } }
const EARLIER = { id: 'c-1', author: 'ada', body: 'an earlier comment', createdAt: '2026-09-29T00:00:00Z' }
/** The posted comment as the desktop lists it once its read works again. */
const POSTED_ON_HOST = { id: 'comment-9', author: 'me', body: 'looks good', createdAt: '2026-09-30T12:00:00Z' }

type Reply = { throw: string } | { ok: boolean; result?: unknown; error?: unknown }

const host = { replies: new Map<string, Reply[]>(), requests: [] as string[] }

function script(method: string, ...replies: Reply[]): void {
  host.replies.set(method, [...(host.replies.get(method) ?? []), ...replies])
}

const client = {
  sendRequest: vi.fn(async (method: string) => {
    host.requests.push(method)
    const next = host.replies.get(method)?.shift()
    if (!next) {
      throw new Error(`no reply scripted for ${method}`)
    }
    if ('throw' in next) {
      throw new Error(next.throw)
    }
    return { id: method, ...next }
  })
}

type Held = {
  state: Record<string, unknown>
  write: (field: string, value: unknown) => void
  addLinearComment: (item: unknown) => Promise<void>
}

/**
 * The model, strict the way the RPC recorder's is: a member a stage reads that is neither fixed
 * here, held as state, nor added by a stage (`Object.assign(model, …)`) throws. State lives in one
 * useState record, so a setter a stage calls re-renders it the way MobileTasksScreen's own does.
 */
function useStrictModel(
  fixed: Record<string, unknown>,
  initial: Record<string, unknown>,
  held: Held
): Record<string, unknown> {
  const [state, setState] = useState(initial)
  held.state = state
  held.write = (field, value) => setState((previous) => ({ ...previous, [field]: value }))
  const setters = useRef(new Map<string, (value: unknown) => void>()).current
  return new Proxy<Record<string, unknown>>(
    {},
    {
      get(target, key: string) {
        if (key in target) {
          return target[key]
        }
        if (key in fixed) {
          return fixed[key]
        }
        if (key in state) {
          return state[key]
        }
        if (key.startsWith('set') && key.length > 3) {
          const field = key[3].toLowerCase() + key.slice(4)
          let setter = setters.get(field)
          if (!setter) {
            setter = (value: unknown) =>
              setState((previous) => ({
                ...previous,
                [field]:
                  typeof value === 'function'
                    ? (value as (current: unknown) => unknown)(previous[field])
                    : value
              }))
            setters.set(field, setter)
          }
          return setter
        }
        throw new Error(`Missing model fixture: ${key}`)
      }
    }
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

let mounted: ReactTestRenderer | null = null

async function openSheet(item: unknown = ITEM) {
  const held: Held = {
    state: {},
    write: () => undefined,
    addLinearComment: async () => undefined
  }
  function Probe({ at }: { at: number | null }): null {
    const model = useStrictModel(
      { client, tasksSupported: true },
      {
        actionItem: item,
        items: [item],
        detailPayload: null,
        detailError: '',
        detailLoading: false,
        detailRefreshSeq: 0,
        error: '',
        linearCommentDraft: '',
        linearSubIssueTitle: '',
        mutatingStatus: false
      },
      held
    )
    useMobileTasksItemDetailLoading(model as never, at)
    held.addLinearComment = useMobileTasksLinearItemActions(model as never).addLinearComment as (
      item: unknown
    ) => Promise<void>
    return null
  }
  await act(async () => {
    mounted = create(createElement(Probe, { at: 1 }))
  })
  await settle()
  return {
    held,
    /** What the user does to the model between renders: typing a draft, tapping Retry. */
    edit: async (field: string, value: unknown) => {
      await act(async () => {
        held.write(field, value)
      })
      await settle()
    },
    post: async (body: string) => {
      await act(async () => {
        held.write('linearCommentDraft', body)
      })
      await act(async () => {
        await held.addLinearComment(item)
      })
      await settle()
    },
    connectedAt: async (at: number) => {
      await act(async () => {
        mounted!.update(createElement(Probe, { at }))
      })
      await settle()
    }
  }
}

beforeEach(() => {
  host.replies = new Map()
  host.requests = []
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  act(() => mounted?.unmount())
  mounted = null
  vi.restoreAllMocks()
})

describe('a comment posted on a Linear issue whose comment list the desktop refused', () => {
  it('stays in the sheet, with the earlier comments still marked unread', async () => {
    script('linear.getIssue', { ok: true, result: ISSUE })
    script('linear.issueComments', REFUSED)
    script('linear.addIssueComment', { ok: true, result: { ok: true, id: 'comment-9' } })
    const sheet = await openSheet()
    expect(sheet.held.state.detailPayload).toMatchObject({ comments: [], commentsFailed: true })

    await sheet.post('looks good')
    expect(sheet.held.state.linearCommentDraft).toBe('')
    expect(sheet.held.state.error).toBe('')
    expect(sheet.held.state.detailPayload).toMatchObject({
      provider: 'linear',
      comments: [{ id: 'comment-9', body: 'looks good', user: { displayName: 'You' } }],
      // The list the desktop refused is still unread: only what was posted here is held.
      commentsFailed: true
    })
  })

  it("is replaced by the desktop's own list once Retry reads it, and the failure clears", async () => {
    script('linear.getIssue', { ok: true, result: ISSUE }, { ok: true, result: ISSUE })
    script('linear.issueComments', REFUSED, { ok: true, result: [EARLIER, POSTED_ON_HOST] })
    script('linear.addIssueComment', { ok: true, result: { ok: true, id: 'comment-9' } })
    const sheet = await openSheet()
    await sheet.post('looks good')

    // Retry bumps the detail's refresh sequence (mobile-tasks-item-discussion.tsx).
    await sheet.edit('detailRefreshSeq', 1)
    const payload = sheet.held.state.detailPayload as Record<string, unknown>
    // The host's list, which holds the posted comment once: nothing the phone held is added to it.
    expect(payload.comments).toEqual([EARLIER, POSTED_ON_HOST])
    expect(payload).not.toHaveProperty('commentsFailed')
  })

  it.each([
    ['the desktop refuses it', { ok: true, result: { ok: false, error: 'Linear said no' } }, 'Linear said no'],
    ['the request never lands', { throw: 'relay down' }, 'relay down']
  ] as [string, Reply, string][])(
    'keeps the draft, says why, and adds nothing when %s',
    async (_case, reply, message) => {
      script('linear.getIssue', { ok: true, result: ISSUE })
      script('linear.issueComments', REFUSED)
      script('linear.addIssueComment', reply)
      const sheet = await openSheet()

      await sheet.post('looks good')
      expect(sheet.held.state.linearCommentDraft).toBe('looks good')
      expect(sheet.held.state.error).toBe(message)
      expect(sheet.held.state.mutatingStatus).toBe(false)
      expect(sheet.held.state.detailPayload).toMatchObject({ comments: [], commentsFailed: true })
    }
  )
})

// Every read of the detail starts from no payload, and a refused comment read used to write an
// empty list. So a Retry, the refresh icon, or the re-read a new connection makes, refused again,
// dropped the comment posted here, and the sheet was back to "Couldn't load comments" over a
// comment the desktop holds: the same vanish, the same duplicate on a second post.
describe('a comment posted over a refused list, when the list is refused again', () => {
  const POSTED = { id: 'comment-9', body: 'looks good', user: { displayName: 'You' } }

  it('keeps the comment just posted when Retry is refused again', async () => {
    script('linear.getIssue', { ok: true, result: ISSUE }, { ok: true, result: ISSUE })
    script('linear.issueComments', REFUSED, REFUSED)
    script('linear.addIssueComment', { ok: true, result: { ok: true, id: 'comment-9' } })
    const sheet = await openSheet()
    await sheet.post('looks good')

    await sheet.edit('detailRefreshSeq', 1)
    expect(host.requests.filter((sent) => sent === 'linear.issueComments')).toHaveLength(2)
    expect(sheet.held.state.detailPayload).toMatchObject({
      provider: 'linear',
      comments: [POSTED],
      commentsFailed: true
    })
  })

  it('keeps it through the read a new connection makes, refused again', async () => {
    script('linear.getIssue', { ok: true, result: ISSUE }, { ok: true, result: ISSUE })
    script('linear.issueComments', REFUSED, REFUSED)
    script('linear.addIssueComment', { ok: true, result: { ok: true, id: 'comment-9' } })
    const sheet = await openSheet()
    await sheet.post('looks good')

    await sheet.connectedAt(2)
    expect(host.requests.filter((sent) => sent === 'linear.issueComments')).toHaveLength(2)
    expect(sheet.held.state.detailPayload).toMatchObject({ comments: [POSTED], commentsFailed: true })
  })

  it('does not carry it onto another issue whose list is refused', async () => {
    script('linear.getIssue', { ok: true, result: ISSUE }, { ok: true, result: OTHER_ISSUE })
    script('linear.issueComments', REFUSED, REFUSED)
    script('linear.addIssueComment', { ok: true, result: { ok: true, id: 'comment-9' } })
    const sheet = await openSheet()
    await sheet.post('looks good')

    await sheet.edit('actionItem', OTHER_ITEM)
    expect(host.requests.filter((sent) => sent === 'linear.getIssue')).toHaveLength(2)
    expect(sheet.held.state.detailPayload).toMatchObject({ comments: [], commentsFailed: true })
  })

  it('carries nothing onto a list that was read, which holds the posted comment itself', async () => {
    script('linear.getIssue', { ok: true, result: ISSUE }, { ok: true, result: ISSUE }, { ok: true, result: ISSUE })
    script('linear.issueComments', REFUSED, REFUSED, { ok: true, result: [POSTED_ON_HOST] })
    script('linear.addIssueComment', { ok: true, result: { ok: true, id: 'comment-9' } })
    const sheet = await openSheet()
    await sheet.post('looks good')
    await sheet.edit('detailRefreshSeq', 1)

    await sheet.edit('detailRefreshSeq', 2)
    const payload = sheet.held.state.detailPayload as Record<string, unknown>
    expect(payload.comments).toEqual([POSTED_ON_HOST])
    expect(payload).not.toHaveProperty('commentsFailed')
  })
})
