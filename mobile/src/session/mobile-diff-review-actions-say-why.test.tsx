import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: ({ data, renderItem }: { data: string[]; renderItem: (info: { item: string }) => ReactElement }) =>
    createElement(
      'FlatList',
      null,
      data.map((item) => createElement('Row', { key: item }, renderItem({ item })))
    ),
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default }
}))
vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Edit3: 'Edit3',
  FileText: 'FileText',
  ListChecks: 'ListChecks',
  MoreHorizontal: 'MoreHorizontal',
  Plus: 'Plus',
  Send: 'Send',
  Trash2: 'Trash2',
  Undo2: 'Undo2',
  X: 'X'
}))
// A phone-width review: the PR sidebar and the diff body are not what these
// tests are about, and the drawers draw their content while open.
vi.mock('../layout/responsive-layout', () => ({ useResponsiveLayout: () => ({ isWideLayout: false }) }))
vi.mock('../components/MobilePRSidebar', () => ({ MobilePRSidebar: () => null }))
vi.mock('../components/RightDrawer', () => ({ RightDrawer: () => null }))
vi.mock('../components/MobileDiffReviewBody', () => ({ MobileDiffReviewBody: () => null }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null)
}))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('../platform/haptics', () => ({
  triggerError: vi.fn(),
  triggerImpact: vi.fn(),
  triggerSelection: vi.fn(),
  triggerSuccess: vi.fn(),
  triggerWarning: vi.fn()
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
const review = vi.hoisted(() => ({ snapshot: null as unknown }))
vi.mock('./mobile-diff-review-loaders', () => ({
  loadMobileDiffReviewSnapshot: vi.fn(async () => review.snapshot),
  loadMobileDiffReviewDiff: vi.fn(async () => ({ kind: 'idle' }))
}))

import type { DiffComment, MobileDiffReviewState } from '../../../src/shared/diff-comment-types'
import { MobileDiffReviewScreenView } from '../components/MobileDiffReviewScreenView'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { RpcResponse } from '../transport/types'
import { buildMobileDiffReviewQueue } from './mobile-diff-review-queue'
import { reviewDescriptorFromItem, type ReviewScreenState } from './mobile-diff-review-screen-model'
import { markMobileDiffReviewFileReviewed } from './mobile-diff-review-state'
import { useMobileDiffReviewController } from './use-mobile-diff-review-controller'

const NOTE: DiffComment = {
  id: 'note-1',
  worktreeId: 'wt-1',
  filePath: 'src/a.ts',
  lineNumber: 4,
  body: 'needs a test',
  createdAt: 1,
  side: 'modified'
}

/** A ready review of `paths`, each an unstaged edit already marked reviewed. */
function reviewedSnapshot(paths: string[]): ReviewScreenState {
  const entries = paths.map((path) => ({ path, status: 'modified' as const, area: 'unstaged' as const }))
  let reviewState: MobileDiffReviewState = { version: 1, files: {} }
  for (const item of buildMobileDiffReviewQueue({
    worktreeId: 'wt-1',
    statusEntries: entries,
    branchEntries: [],
    comments: [NOTE],
    reviewState
  })) {
    reviewState = markMobileDiffReviewFileReviewed(reviewState, reviewDescriptorFromItem(item), 1)
  }
  return {
    kind: 'ready',
    status: { entries, conflictOperation: undefined, branch: undefined, head: undefined, upstreamStatus: undefined },
    branchCompare: null,
    comments: [NOTE],
    reviewState
  }
}

/** A lost send whose error carries no message, the recorder's
 *  "transport-rejection-no-message" partition. */
function messageless(): Error {
  const error = new Error('lost')
  error.message = ''
  return error
}

const ok = (result: unknown): RpcResponse => ({ id: 'reply', ok: true, result })
const refused = (message: string): RpcResponse => ({ id: 'reply', ok: false, error: { code: 'refused', message } })

type Answer = (params: Record<string, unknown>) => RpcResponse | Promise<RpcResponse>

/** A connected host that answers the methods in `answers` and leaves every
 *  other request (the PR sidebar's) unanswered. */
function host(answers: Record<string, Answer>) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const client = createFakeRpcClient({}, async (method, params) => {
    calls.push({ method, params: params as Record<string, unknown> })
    const answer = answers[method]
    return answer ? answer(params as Record<string, unknown>) : new Promise<RpcResponse>(() => {})
  })
  return { client, calls: (method: string) => calls.filter((call) => call.method === method) }
}

let controller: ReturnType<typeof useMobileDiffReviewController> | null = null
let openedSession = 0

function Review({ client }: { client: ReturnType<typeof host>['client'] }) {
  controller = useMobileDiffReviewController({
    client,
    connState: 'connected',
    hostId: 'host-1',
    worktreeId: 'wt-1',
    name: 'review',
    initialFilter: 'all',
    initialTarget: null,
    onOpenSession: () => {
      openedSession += 1
    },
    onReconnect: null
  })
  return <MobileDiffReviewScreenView controller={controller} onBack={() => {}} />
}

/** Lets a tap's requests, their replies and the state they set all land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let tree: ReactTestRenderer | null = null
let warn: MockInstance<(...args: unknown[]) => void>
let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason)
}

async function render(tab: ReturnType<typeof host>, scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <Review client={tab.client} />
      </ThemeProvider>
    )
    await settle()
  })
  return tree!
}

function pressable(rendered: ReactTestRenderer, match: (node: ReactTestInstance) => boolean): ReactTestInstance {
  const [node] = rendered.root.findAll((candidate) => String(candidate.type) === 'Pressable' && match(candidate))
  if (!node) {
    throw new Error('no such control on the review screen')
  }
  return node
}

const labelled = (label: string) => (node: ReactTestInstance) => node.props.accessibilityLabel === label
const titled = (text: string) => (node: ReactTestInstance) =>
  node.findAll((child) => String(child.type) === 'Text' && child.props.children === text).length > 0

async function press(rendered: ReactTestRenderer, match: (node: ReactTestInstance) => boolean): Promise<void> {
  await act(async () => {
    pressable(rendered, match).props.onPress()
    await settle()
  })
}

/** Taps a row of the header's Review Actions sheet. */
async function reviewAction(rendered: ReactTestRenderer, row: string): Promise<void> {
  await press(rendered, labelled('Open review actions'))
  await press(rendered, titled(row))
}

/** `text` as the review screen's outcome banner draws it (the Text under the
 *  warning-bordered View), or null when the screen does not show it. */
function banner(rendered: ReactTestRenderer, text: string): { textColor: unknown; border: unknown } | null {
  const [node] = rendered.root.findAll(
    (candidate) =>
      String(candidate.type) === 'Text' &&
      candidate.props.children === text &&
      String(candidate.parent?.type) === 'View' &&
      flat(candidate.parent?.props.style).borderColor !== undefined
  )
  return node ? { textColor: flat(node.props.style).color, border: flat(node.parent!.props.style).borderColor } : null
}

function flat(style: unknown): Record<string, unknown> {
  const entries = (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...entries)
}

function logged(tag: string): string[] {
  return warn.mock.calls.map((args) => args.map(String).join(' ')).filter((line) => line.startsWith(tag))
}

beforeEach(() => {
  review.snapshot = reviewedSnapshot(['src/a.ts'])
  openedSession = 0
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  controller = null
  process.off('unhandledRejection', onUnhandled)
  warn.mockRestore()
})

// Stage Reviewed Files had no catch and cleared its busy mark only on
// success: a send the link lost left `stage-reviewed` set, every Stage,
// Unstage and Discard button disabled until the screen was left, and no word
// of why.
describe('Stage Reviewed Files when the send is lost', () => {
  const lost = () => Promise.reject(new Error('Connection closed'))

  it('says why the reviewed files were not staged, and frees the buttons', async () => {
    const tab = host({ 'git.stage': lost })
    const rendered = await render(tab)
    await reviewAction(rendered, 'Stage Reviewed Files')
    expect(tab.calls('git.stage')).toHaveLength(1)
    expect(banner(rendered, 'Connection closed')).not.toBeNull()
    expect(controller!.busyAction).toBeNull()
    expect(pressable(rendered, labelled('Stage file')).props.disabled).toBe(false)
    expect(logged('[review-git]')).toEqual([expect.stringContaining('Connection closed')])
    expect(unhandled).toEqual([])
  })

  it('still says something when the lost send carries no message', async () => {
    const tab = host({ 'git.stage': () => Promise.reject(messageless()) })
    const rendered = await render(tab)
    await reviewAction(rendered, 'Stage Reviewed Files')
    expect(banner(rendered, "Couldn't stage the reviewed files")).not.toBeNull()
    expect(controller!.busyAction).toBeNull()
  })

  // The loop stops at the lost send; the files before it did stage, and the
  // screen says so and reloads to show them.
  it('says how many staged before the send was lost', async () => {
    review.snapshot = reviewedSnapshot(['src/a.ts', 'src/b.ts'])
    let sent = 0
    const tab = host({ 'git.stage': () => (++sent === 1 ? ok({ staged: true }) : lost()) })
    const rendered = await render(tab)
    await reviewAction(rendered, 'Stage Reviewed Files')
    expect(tab.calls('git.stage')).toHaveLength(2)
    expect(banner(rendered, '1 staged, then: Connection closed')).not.toBeNull()
    expect(controller!.busyAction).toBeNull()
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws why in the %s theme', async (scheme, colors) => {
    const tab = host({ 'git.stage': lost })
    const rendered = await render(tab, scheme)
    await reviewAction(rendered, 'Stage Reviewed Files')
    expect(banner(rendered, 'Connection closed')).toEqual({ textColor: colors.text, border: colors.warning })
  })
})

// Open in Session awaited its request outside its try: only a refusal was
// caught, and a lost send left nothing on the screen at all.
describe('Open in Session when the send is lost', () => {
  it('says why the file did not open', async () => {
    const tab = host({ 'files.openDiff': () => Promise.reject(new Error('Connection closed')) })
    const rendered = await render(tab)
    await reviewAction(rendered, 'Open in Session')
    expect(tab.calls('files.openDiff')).toHaveLength(1)
    expect(banner(rendered, 'Connection closed')).not.toBeNull()
    expect(openedSession).toBe(0)
    expect(logged('[review-open]')).toEqual([expect.stringContaining('Connection closed')])
    expect(unhandled).toEqual([])
  })

  it('still says something when the lost send carries no message', async () => {
    const tab = host({ 'files.openDiff': () => Promise.reject(messageless()) })
    const rendered = await render(tab)
    await reviewAction(rendered, 'Open in Session')
    expect(banner(rendered, 'Unable to open in session')).not.toBeNull()
  })

  it('still opens the session when the desktop takes it', async () => {
    const tab = host({ 'files.openDiff': () => ok({ tab: { id: 'tab-9' } }) })
    const rendered = await render(tab)
    await reviewAction(rendered, 'Open in Session')
    expect(openedSession).toBe(1)
    expect(controller!.actionError).toBeNull()
  })
})

// A failed save already says why on the banner, then rethrew into a `void`
// tap with nowhere to go. The rejection is gone; the reason, the rollback and
// the one log line stay.
describe('a review save that fails', () => {
  it('says why Mark Reviewed failed, and leaves no rejection behind', async () => {
    review.snapshot = { ...(reviewedSnapshot(['src/a.ts']) as object), reviewState: { version: 1, files: {} } }
    const tab = host({ 'worktree.set': () => refused('Workspace is locked') })
    const rendered = await render(tab)
    await press(rendered, labelled('Mark file reviewed'))
    expect(tab.calls('worktree.set')).toHaveLength(1)
    expect(banner(rendered, 'Workspace is locked')).not.toBeNull()
    expect(controller!.showCompletion).toBe(false)
    expect(unhandled).toEqual([])
    expect(logged('[review-save]')).toEqual([expect.stringContaining('Workspace is locked')])
  })

  it.each([
    ['Mark Unreviewed', null, () => controller!.markUnreviewed()],
    ['Clear Sent Notes', null, () => controller!.clearSentNotes()],
    [
      'Save on a note',
      () => {
        controller!.openComposer(4)
        controller!.setComposerBody('rename this')
      },
      () => controller!.saveComposer()
    ],
    ['Delete on a note', () => controller!.openEditComposer(NOTE), () => controller!.deleteComment()]
  ] as const)('does not reject %s into its tap when the save fails', async (_name, prepare, run) => {
    const tab = host({ 'worktree.set': () => refused('Workspace is locked') })
    await render(tab)
    if (prepare) {
      act(() => prepare())
    }
    let outcome: unknown = 'not run'
    await act(async () => {
      outcome = await run().then(
        () => 'resolved',
        (error: unknown) => error
      )
      await settle()
    })
    expect(outcome).toBe('resolved')
    expect(tab.calls('worktree.set')).toHaveLength(1)
    expect(controller!.actionError).toBe('Workspace is locked')
    expect(logged('[review-save]')).toEqual([expect.stringContaining('Workspace is locked')])
    // A note whose save failed stays in its composer, text and all.
    if (prepare) {
      expect(controller!.composer).not.toBeNull()
    }
    expect(unhandled).toEqual([])
  })
})
