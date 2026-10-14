// Delete on a saved comment's card (the Claude app's `diff_remove_comment`, com.anthropic.claude
// 1.261009.20): the card's own button removes that comment, with no editor open first.
//
// `deleteComment` read the comment from the open editor, so it could only delete the note being
// edited. A card's Delete has no editor behind it, and the click would have done nothing.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import type { RpcResponse } from '../transport/types'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'
import { useMobileDiffReviewController } from './use-mobile-diff-review-controller'

const review = vi.hoisted(() => ({ snapshot: null as unknown }))
vi.mock('./mobile-diff-review-loaders', () => ({
  loadMobileDiffReviewSnapshot: vi.fn(async () => review.snapshot),
  loadMobileDiffReviewDiff: vi.fn(async () => ({ kind: 'idle' }))
}))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('../platform/haptics', () => ({
  triggerError: vi.fn(),
  triggerImpact: vi.fn(),
  triggerSelection: vi.fn(),
  triggerSuccess: vi.fn(),
  triggerWarning: vi.fn()
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))

function note(id: string, lineNumber: number, body: string): DiffComment {
  return { id, worktreeId: 'wt-1', filePath: 'src/a.ts', lineNumber, body, createdAt: 1, side: 'modified' }
}

const FIRST = note('first', 4, 'needs a test')
const SECOND = note('second', 9, 'rename this')

const ok = (result: unknown): RpcResponse => ({ id: 'reply', ok: true, result })

let controller: ReturnType<typeof useMobileDiffReviewController> | null = null
let tree: ReactTestRenderer | null = null
let saved: DiffComment[][] = []
let saveReply: () => RpcResponse | Promise<RpcResponse>
let warn: ReturnType<typeof vi.spyOn>

function Probe({ client }: { client: ReturnType<typeof createFakeRpcClient> }): null {
  controller = useMobileDiffReviewController({
    client,
    connState: 'connected',
    hostId: 'host-1',
    worktreeId: 'wt-1',
    name: 'review',
    initialFilter: 'all',
    initialTarget: null,
    onOpenSession: () => {},
    onReconnect: null
  })
  return null
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function mount(): Promise<void> {
  const client = createFakeRpcClient({}, async (method, params) => {
    if (method === 'worktree.set') {
      saved.push((params as { diffComments: DiffComment[] }).diffComments)
      return saveReply()
    }
    return new Promise<RpcResponse>(() => {})
  })
  await act(async () => {
    tree = create(createElement(Probe, { client }))
    await settle()
  })
}

function commentsOnScreen(): string[] {
  const state = controller!.screenState
  return state.kind === 'ready' ? state.comments.map((comment) => comment.id) : []
}

beforeEach(() => {
  review.snapshot = {
    kind: 'ready',
    status: {
      entries: [],
      conflictOperation: undefined,
      branch: undefined,
      head: undefined,
      upstreamStatus: undefined
    },
    branchCompare: null,
    comments: [FIRST, SECOND],
    reviewState: { version: 1, files: {} }
  } satisfies Partial<ReviewScreenState>
  saved = []
  saveReply = () => ok({ updated: true })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  controller = null
  warn.mockRestore()
})

describe('deleting a comment from its card', () => {
  it('removes that comment and saves the rest, with no editor open', async () => {
    await mount()
    expect(commentsOnScreen()).toEqual(['first', 'second'])

    await act(async () => {
      await controller!.deleteComment(FIRST)
    })

    expect(commentsOnScreen()).toEqual(['second'])
    expect(saved.map((list) => list.map((comment) => comment.id))).toEqual([['second']])
    expect(controller!.composer).toBeNull()
  })

  it('leaves an editor open on another comment alone', async () => {
    await mount()
    act(() => controller!.openEditComposer(SECOND))
    expect(controller!.composer).toMatchObject({ mode: 'edit', comment: { id: 'second' } })

    await act(async () => {
      await controller!.deleteComment(FIRST)
    })

    expect(commentsOnScreen()).toEqual(['second'])
    expect(controller!.composer).toMatchObject({ mode: 'edit', comment: { id: 'second' } })
    expect(controller!.composerBody).toBe('rename this')
  })

  it('closes the editor when it was the open comment that went', async () => {
    await mount()
    act(() => controller!.openEditComposer(FIRST))

    await act(async () => {
      await controller!.deleteComment(FIRST)
    })

    expect(commentsOnScreen()).toEqual(['second'])
    expect(controller!.composer).toBeNull()
  })

  it('still deletes the comment open in the editor when it is given none', async () => {
    await mount()
    act(() => controller!.openEditComposer(SECOND))

    await act(async () => {
      await controller!.deleteComment()
    })

    expect(commentsOnScreen()).toEqual(['first'])
    expect(controller!.composer).toBeNull()
  })

  it('does nothing with no comment and no editor', async () => {
    await mount()
    await act(async () => {
      await controller!.deleteComment()
    })
    expect(saved).toEqual([])
    expect(commentsOnScreen()).toEqual(['first', 'second'])
  })

  it('puts the comment back and says why when the save is refused', async () => {
    saveReply = () => ({ id: 'reply', ok: false, error: { code: 'refused', message: 'disk full' } })
    await mount()

    await act(async () => {
      await controller!.deleteComment(FIRST)
    })

    expect(commentsOnScreen()).toEqual(['first', 'second'])
    expect(controller!.actionError).toBe('disk full')
  })
})
