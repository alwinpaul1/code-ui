import { readFileSync } from 'node:fs'
import { createElement, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A task's detail sheet opened while the relay was still dialling, or one whose link dropped under
 * the read. The read failed and the sheet said so, and then it kept saying so over a connection
 * that had come back: the effects are keyed on the client object, which is the same across
 * reconnects, so only the small refresh icon read again (review, 2026-09-30). The labels and
 * assignee pickers had the same gap. CLAUDE.md "Nothing stays stale once the relay connects".
 *
 * Each stage is mounted the way MobileTasksScreen mounts it: the model it reads, and the host's
 * `lastConnectedAt` as its second input.
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
import { useMobileTasksItemDetailMetadataEffects } from './use-mobile-tasks-item-detail-metadata-effects'
import { useMobileTasksProjectDetailLoading } from './use-mobile-tasks-project-detail-loading'

const LINEAR_ISSUE = {
  id: 'issue-1',
  identifier: 'ENG-1',
  title: 'Fix it',
  url: 'https://linear.app/acme/issue/ENG-1',
  updatedAt: '2026-09-30T00:00:00Z',
  priority: 0,
  labels: [],
  state: { name: 'Todo', type: 'unstarted', color: '#000000' },
  team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
  workspaceId: 'ws-1',
  subIssues: []
}

const LINEAR_ITEM = {
  key: 'linear:ENG-1',
  provider: 'linear',
  title: 'Fix it',
  subtitle: 'ENG-1',
  status: 'Todo',
  updatedAt: '2026-09-30T00:00:00Z',
  source: LINEAR_ISSUE
}

const GITHUB_PR_ITEM = {
  key: 'github:pr:12',
  provider: 'github',
  title: 'A pull request',
  subtitle: 'owner/repo#12',
  status: 'open',
  updatedAt: '2026-09-30T00:00:00Z',
  source: {
    id: 'github:pr:12',
    repoId: 'repo-1',
    number: 12,
    type: 'pr',
    state: 'open',
    labels: ['bug'],
    reviewRequests: [],
    latestReviews: [],
    reviewDecision: null
  }
}

const GITHUB_ISSUE_ITEM = {
  ...GITHUB_PR_ITEM,
  key: 'github:issue:9',
  source: { ...GITHUB_PR_ITEM.source, id: 'github:issue:9', number: 9, type: 'issue' }
}

const PROJECT_ROW = {
  id: 'item-1',
  itemType: 'ISSUE',
  content: {
    title: 'A board issue',
    body: 'body',
    repository: 'owner/repo',
    number: 1,
    url: 'https://github.com/owner/repo/issues/1',
    state: 'OPEN',
    labels: [],
    assignees: [],
    issueType: null
  },
  fieldValuesByFieldId: { 'field-notes': { kind: 'text', text: 'old note' } }
}

/** A board whose view has one editable text field, which the row sheet draws above its detail. */
const NOTES_TABLE = {
  project: { id: 'project-1', title: 'Board', number: 3 },
  selectedView: {
    id: 'view-1',
    number: 1,
    name: 'Table',
    filter: '',
    layout: 'TABLE_LAYOUT',
    fields: [{ id: 'field-notes', name: 'Notes', dataType: 'TEXT' }]
  },
  fields: [],
  rows: [PROJECT_ROW]
}

type Reply = { throw: string } | { ok: boolean; result?: unknown; error?: unknown }

const host = { replies: new Map<string, Reply[]>(), requests: [] as string[] }

function script(method: string, ...replies: Reply[]): void {
  host.replies.set(method, [...(host.replies.get(method) ?? []), ...replies])
}

const reads = (method: string): number => host.requests.filter((sent) => sent === method).length

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

/**
 * The stage's model, strict the way the RPC recorder's is (observable-model.ts): a member the stage
 * reads that is neither fixed here nor held as state throws. State lives in one useState record, so
 * a setter the stage calls re-renders it the way MobileTasksScreen's own state does.
 */
type Held = {
  state: Record<string, unknown>
  write: (field: string, value: unknown) => void
}

function useStrictModel(
  fixed: Record<string, unknown>,
  initial: Record<string, unknown>,
  held: Held
): Record<string, unknown> {
  const [state, setState] = useState(initial)
  held.state = state
  held.write = (field, value) => setState((previous) => ({ ...previous, [field]: value }))
  const setters = useRef(new Map<string, (value: unknown) => void>()).current
  return new Proxy(
    {},
    {
      get(_target, key: string) {
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

type Stage = (model: never, lastConnectedAt?: number | null) => unknown

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

let mounted: ReactTestRenderer | null = null

async function mountStage(
  useStage: Stage,
  fixed: Record<string, unknown>,
  initial: Record<string, unknown>,
  lastConnectedAt: number | null
) {
  const held: Held = { state: {}, write: () => undefined }
  function Probe({ at }: { at: number | null }): null {
    useStage(useStrictModel(fixed, initial, held) as never, at)
    return null
  }
  await act(async () => {
    mounted = create(createElement(Probe, { at: lastConnectedAt }))
  })
  await settle()
  return {
    held,
    /** What the user does to the model between renders, such as typing into a draft. */
    edit: async (field: string, value: unknown) => {
      await act(async () => {
        held.write(field, value)
      })
    },
    /** The host's `lastConnectedAt` as MobileTasksScreen hands it down: new on a NEW connection. */
    connectedAt: async (at: number | null) => {
      await act(async () => {
        mounted!.update(createElement(Probe, { at }))
      })
      await settle()
    }
  }
}

function mountItemDetail(item: unknown, lastConnectedAt: number | null) {
  return mountStage(
    useMobileTasksItemDetailLoading as Stage,
    { client, tasksSupported: true },
    {
      actionItem: item,
      items: [item],
      detailPayload: null,
      detailError: '',
      detailLoading: false,
      detailRefreshSeq: 0
    },
    lastConnectedAt
  )
}

function mountProjectRowDetail(lastConnectedAt: number | null, githubProjectTable: unknown = null) {
  return mountStage(
    useMobileTasksProjectDetailLoading as Stage,
    {
      client,
      tasksSupported: true,
      activeGitHubProjectHost: 'github.com',
      githubProjectTable,
      projectRowItem: PROJECT_ROW
    },
    {
      projectRowDetail: null,
      projectRowDetailError: '',
      projectRowDetailLoading: false,
      projectRowDetailRefreshSeq: 0
    },
    lastConnectedAt
  )
}

function mountItemMetadata(lastConnectedAt: number | null) {
  return mountStage(
    useMobileTasksItemDetailMetadataEffects as Stage,
    { client, tasksSupported: true, actionItem: GITHUB_ISSUE_ITEM, detailPayload: null },
    {
      itemAvailableLabels: [],
      itemLabelsError: '',
      itemLabelsLoading: false,
      itemAssignableUsers: [],
      itemAssignableUsersError: '',
      itemAssignableUsersLoading: false
    },
    lastConnectedAt
  )
}

const OCTOCAT = { login: 'octocat', name: null, avatarUrl: null }

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

describe('an item detail sheet whose read failed, once the host reconnects', () => {
  it('reads a Linear issue again instead of keeping the error the dropped link left', async () => {
    script('linear.getIssue', { throw: 'relay down' }, { ok: true, result: LINEAR_ISSUE })
    script('linear.issueComments', { ok: true, result: [] }, { ok: true, result: [] })
    const sheet = await mountItemDetail(LINEAR_ITEM, 1)
    expect(sheet.held.state.detailError).toBe('relay down')
    expect(reads('linear.getIssue')).toBe(1)

    await sheet.connectedAt(2)
    expect(reads('linear.getIssue')).toBe(2)
    expect(sheet.held.state.detailError).toBe('')
    expect(sheet.held.state.detailPayload).toMatchObject({ provider: 'linear', comments: [] })
  })

  it('reads a GitHub item again instead of keeping the error the dropped link left', async () => {
    script(
      'github.workItemDetails',
      { throw: 'relay down' },
      { ok: true, result: { body: 'the body', comments: [], assignees: [] } }
    )
    const sheet = await mountItemDetail(GITHUB_PR_ITEM, 1)
    expect(sheet.held.state.detailError).toBe('relay down')

    await sheet.connectedAt(2)
    expect(reads('github.workItemDetails')).toBe(2)
    expect(sheet.held.state.detailError).toBe('')
    expect(sheet.held.state.detailPayload).toMatchObject({ provider: 'github', body: 'the body' })
  })

  it('reads once per new connection, never per render, while the host stays down', async () => {
    script('github.workItemDetails', { throw: 'relay down' }, { throw: 'relay down' })
    script('github.workItemDetails', { throw: 'relay down' })
    const sheet = await mountItemDetail(GITHUB_PR_ITEM, null)
    expect(reads('github.workItemDetails')).toBe(1)
    // Renders with no new connection behind them: the relay still dialling.
    await sheet.connectedAt(null)
    await sheet.connectedAt(null)
    expect(reads('github.workItemDetails')).toBe(1)
    await sheet.connectedAt(5)
    expect(reads('github.workItemDetails')).toBe(2)
    // The read failed again on that connection; it waits for the next one.
    await sheet.connectedAt(5)
    expect(reads('github.workItemDetails')).toBe(2)
    await sheet.connectedAt(9)
    expect(reads('github.workItemDetails')).toBe(3)
    expect(sheet.held.state.detailError).toBe('relay down')
  })

  it('leaves a detail that loaded alone when the host reconnects', async () => {
    script('github.workItemDetails', { ok: true, result: { body: 'the body' } })
    const sheet = await mountItemDetail(GITHUB_PR_ITEM, 1)
    await sheet.connectedAt(2)
    await sheet.connectedAt(3)
    expect(reads('github.workItemDetails')).toBe(1)
    expect(sheet.held.state.detailPayload).toMatchObject({ body: 'the body' })
  })
})

describe("a board row's detail whose read failed, once the host reconnects", () => {
  const DETAILS = { ok: true, result: { ok: true, details: { body: 'row body' } } }

  it('reads the row again instead of keeping the error the dropped link left', async () => {
    script('github.project.workItemDetailsBySlug', { throw: 'relay down' }, DETAILS)
    const row = await mountProjectRowDetail(1)
    expect(row.held.state.projectRowDetailError).toBe('relay down')

    await row.connectedAt(2)
    expect(reads('github.project.workItemDetailsBySlug')).toBe(2)
    expect(row.held.state.projectRowDetailError).toBe('')
    expect(row.held.state.projectRowDetail).toMatchObject({ body: 'row body' })
  })

  it('reads a row the host refused again on the next connection, once', async () => {
    script(
      'github.project.workItemDetailsBySlug',
      { ok: false, error: { code: 'internal', message: 'boom' } },
      DETAILS
    )
    const row = await mountProjectRowDetail(1)
    expect(row.held.state.projectRowDetailError).toBe('boom')
    await row.connectedAt(1)
    expect(reads('github.project.workItemDetailsBySlug')).toBe(1)
    await row.connectedAt(2)
    await row.connectedAt(3)
    expect(reads('github.project.workItemDetailsBySlug')).toBe(2)
    expect(row.held.state.projectRowDetail).toMatchObject({ body: 'row body' })
  })

  it('keeps the project field the user was typing when it reads the row again', async () => {
    script('github.project.workItemDetailsBySlug', { throw: 'relay down' }, DETAILS)
    const row = await mountProjectRowDetail(1, NOTES_TABLE)
    expect(row.held.state.projectFieldDrafts).toEqual({ 'field-notes': 'old note' })
    // The field editors draw from the board table, so they stay open under the error.
    await row.edit('projectFieldDrafts', { 'field-notes': 'a new note, half typed' })

    await row.connectedAt(2)
    expect(reads('github.project.workItemDetailsBySlug')).toBe(2)
    expect(row.held.state.projectRowDetail).toMatchObject({ body: 'row body' })
    expect(row.held.state.projectFieldDrafts).toEqual({ 'field-notes': 'a new note, half typed' })
  })

  it("reads the row again after one of the row's actions wrote over the read's error", async () => {
    script('github.project.workItemDetailsBySlug', { ok: false, error: { code: 'x', message: 'boom' } })
    script('github.project.workItemDetailsBySlug', DETAILS)
    const row = await mountProjectRowDetail(1, NOTES_TABLE)
    expect(row.held.state.projectRowDetailError).toBe('boom')
    // A field saved from the editors above the detail clears the shared error line when it starts.
    await row.edit('projectRowDetailError', '')

    await row.connectedAt(2)
    expect(reads('github.project.workItemDetailsBySlug')).toBe(2)
    expect(row.held.state.projectRowDetail).toMatchObject({ body: 'row body' })
  })

  it('leaves a row that loaded alone when the host reconnects', async () => {
    script('github.project.workItemDetailsBySlug', DETAILS)
    const row = await mountProjectRowDetail(1)
    await row.connectedAt(2)
    expect(reads('github.project.workItemDetailsBySlug')).toBe(1)
  })
})

describe('the label and assignee pickers, once the host reconnects', () => {
  it('reads the labels again after a failed read, and not the assignees that loaded', async () => {
    script('github.listLabels', { throw: 'relay down' }, { ok: true, result: ['bug', 'docs'] })
    script('github.listAssignableUsers', { ok: true, result: [OCTOCAT] })
    const pickers = await mountItemMetadata(1)
    expect(pickers.held.state.itemLabelsError).toBe('relay down')

    await pickers.connectedAt(2)
    expect(reads('github.listLabels')).toBe(2)
    expect(reads('github.listAssignableUsers')).toBe(1)
    expect(pickers.held.state.itemLabelsError).toBe('')
    expect(pickers.held.state.itemAvailableLabels).toEqual(['bug', 'docs'])
    expect(pickers.held.state.itemAssignableUsers).toEqual([OCTOCAT])
  })

  it('reads the assignees again after a failed read, and not the labels that loaded', async () => {
    script('github.listLabels', { ok: true, result: ['bug'] })
    script('github.listAssignableUsers', { throw: 'relay down' }, { ok: true, result: [OCTOCAT] })
    const pickers = await mountItemMetadata(1)
    expect(pickers.held.state.itemAssignableUsersError).toBe('relay down')

    await pickers.connectedAt(2)
    expect(reads('github.listAssignableUsers')).toBe(2)
    expect(reads('github.listLabels')).toBe(1)
    expect(pickers.held.state.itemAssignableUsersError).toBe('')
    expect(pickers.held.state.itemAssignableUsers).toEqual([OCTOCAT])
  })

  it('reads a failed picker once per new connection while the host stays down', async () => {
    script('github.listLabels', { throw: 'relay down' }, { throw: 'relay down' })
    script('github.listAssignableUsers', { throw: 'relay down' }, { throw: 'relay down' })
    const pickers = await mountItemMetadata(1)
    await pickers.connectedAt(1)
    expect([reads('github.listLabels'), reads('github.listAssignableUsers')]).toEqual([1, 1])
    await pickers.connectedAt(2)
    await pickers.connectedAt(2)
    expect([reads('github.listLabels'), reads('github.listAssignableUsers')]).toEqual([2, 2])
  })
})

describe("the Tasks screen's detail stages", () => {
  // Each stage takes the host's connection time as an input that defaults to null, which is what
  // keeps the RPC recordings' mounts unchanged. The same default makes a screen that forgets to pass
  // it compile and read nothing on reconnect, with every test above still green. So the wiring is
  // pinned in the source, comments stripped so the prose above a call cannot stand in for it.
  const screen = readFileSync(new URL('./MobileTasksScreen.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it.each([
    'useMobileTasksItemDetailMetadataEffects',
    'useMobileTasksItemDetailLoading',
    'useMobileTasksProjectDetailLoading'
  ])('hands %s the host connection time, so a failed read is read again', (stage) => {
    const call = new RegExp(`=\\s*${stage}\\(\\s*stage\\d+\\s*,\\s*([^)]*?)\\s*\\)`).exec(screen)
    expect(call?.[1]).toBe('lastConnectedAt')
    // Stage 1 is where the screen reads it, as useLastConnectedAt(hostId).
    expect(screen).toMatch(/const \{ lastConnectedAt \} = stage1\b/)
  })
})
