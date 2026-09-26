// A cut create's count is read back from the file only when the chat holds the
// whole session, settled: every call that could have changed the file since
// is then in hand. Review of 8b2ef369 (2026-09-26), both drawing +125 on the
// 93-line create:
// - a re-subscribe that came back empty kept the last settled tail
//   (`baseRetained`), which lacks what was written in between, and the store
//   was told it was live;
// - the chat opens on the last 40 rows and live appends trim at 150, so a
//   background agent launched before the window was not seen at all, and a
//   count refused while its launch was in the window was read once it left.
// The phone cannot ask when the file last changed: `files.stat` is not on
// Orca's mobile allowlist (origin/main 8d6fec59).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import {
  createCreatedFileCountStore,
  type CreatedFileCountStore
} from './mobile-native-chat-created-file-count-store'
import { cutCreateOf } from './mobile-native-chat-created-file-count'
import type { NativeChatToolCallBlock, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'
import {
  CLAUDE_EDIT_RUN_ROWS,
  CREATED_A_FILE_RUN,
  CREATED_FILE_ON_DISK
} from './fixtures/claude-edit-runs-2.1.282'

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
    currentState: 'active'
  },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View'
}))

vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return { MobileNativeChatView: (props: Record<string, unknown>) => h('ChatView', props) }
})

type Window = { baseRetained: boolean; wholeSession: boolean }

function overlay(
  messages: NativeChatMessage[],
  store: CreatedFileCountStore,
  window: Window
): ReturnType<typeof createElement> {
  const controller = {
    showNativeChat: true,
    activeChatEligible: true,
    viewResolved: true,
    terminalPeekActive: false,
    nativeChatSession: { messages, status: 'ready', ...window },
    nativeChatAgent: 'claude',
    nativeChatAgentWorking: false,
    nativeChatStreamLive: false,
    nativeChatStreamScopeKey: 'tab-a',
    chatPending: [],
    chatImagePreviewsByMessageId: {},
    chatComposerText: '',
    setChatComposerText: vi.fn()
  } as unknown as MobileNativeChatController
  return createElement(MobileNativeChatOverlay, {
    controller,
    hasTerminalUnderneath: true,
    hostAllowsRewind: true,
    images: {} as never,
    onMicPress: vi.fn(),
    micActive: false,
    dictationMode: 'toggle',
    onMicPressIn: vi.fn(),
    onMicPressOut: vi.fn(),
    inputLockReason: null,
    sendErrorMessage: null,
    onClearSendError: vi.fn(),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    keyboardInset: 0,
    createdFileCounts: store
  } as never)
}

const WORKTREE_ROOT = '/Users/dev/Desktop/Project/Sample'
const THE_CREATE = cutCreateOf(
  CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock,
  CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
)!

/** A host whose file is `content`, at the Write's path in this worktree. */
function host(content: string) {
  return vi.fn(async (method: string, params?: unknown) => {
    if (method === 'files.resolveTerminalPath') {
      const relativePath = (params as { pathText: string }).pathText.slice(WORKTREE_ROOT.length + 1)
      return {
        id: 'rpc',
        ok: true,
        result: { worktree: 'wt-1', exists: true, isDirectory: false, openTarget: { kind: 'worktree-file', relativePath } },
        _meta: { runtimeId: 'r' }
      }
    }
    return { id: 'rpc', ok: true, result: { content, truncated: false }, _meta: { runtimeId: 'r' } }
  })
}

/** A background agent appended 32 lines after the create. */
const APPENDED = `${CREATED_FILE_ON_DISK}${'echo "appended by the agent"\n'.repeat(32)}`

describe('a created file counted only from the whole settled session', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function countWith(content: string, window: Window): Promise<{ count: number | null; reads: number }> {
    const sendRequest = host(content)
    const store = createCreatedFileCountStore()
    store.configure({ client: { sendRequest } as never, hostId: 'h', worktreeId: 'wt-1', lastConnectedAt: 1 })
    await act(async () => {
      renderer = create(overlay(CLAUDE_EDIT_RUN_ROWS, store, window))
    })
    store.want(THE_CREATE)
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    return {
      count: store.countFor(THE_CREATE.key),
      reads: sendRequest.mock.calls.filter(([method]) => method === 'files.read').length
    }
  }

  it.each([
    ['a kept tail, which lacks what was written while the chat was away', { baseRetained: true, wholeSession: true }],
    ['a window that starts after the session’s first row', { baseRetained: false, wholeSession: false }]
  ])('draws no count, and reads nothing, from %s', async (_, window) => {
    expect(await countWith(APPENDED, window)).toEqual({ count: null, reads: 0 })
  })

  it('tells the store a kept tail is not the chat’s own read', async () => {
    const setTranscript = vi.fn()
    const store = {
      configure: vi.fn(),
      setTranscript,
      want: vi.fn(() => () => {}),
      countFor: vi.fn(() => null),
      subscribe: vi.fn(() => () => {})
    } as unknown as CreatedFileCountStore
    await act(async () => {
      renderer = create(overlay(CLAUDE_EDIT_RUN_ROWS, store, { baseRetained: true, wholeSession: true }))
    })
    expect(setTranscript.mock.calls.at(-1)?.[1]).toBe(false)
  })

  it('counts +93 from the file when the chat holds the whole session, settled', async () => {
    expect(await countWith(CREATED_FILE_ON_DISK, { baseRetained: false, wholeSession: true })).toEqual({ count: 93, reads: 1 })
  })
})
