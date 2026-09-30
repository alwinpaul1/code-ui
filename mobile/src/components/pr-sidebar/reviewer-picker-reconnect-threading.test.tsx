// The connection the reviewer picker's re-read is keyed on, carried from the hub's PR controller
// through the PR body to the picker. The picker only had the RPC client, which is the same object
// across reconnects, so nothing told it the link was back (review round 3, 2026-09-30). This mounts
// the REAL panel body, sidebar, Reviewers section and picker, and moves only the controller's
// `prSidebarLastConnectedAt`.
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobilePrSidebarController } from '../../session/use-mobile-pr-sidebar-controller'
import type { RpcClient } from '../../transport/rpc-client'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  RotateCw: 'RotateCw',
  UserPlus: 'UserPlus',
  X: 'X'
}))
vi.mock('../BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))
// The rest of the PR body is not under test.
vi.mock('./PRSidebarHeader', () => ({ PRSidebarHeader: () => null }))
vi.mock('./PRConflictingFilesSection', () => ({ PRConflictingFilesSection: () => null }))
vi.mock('./PRActionsSection', () => ({ PRActionsSection: () => null }))
vi.mock('./PRChecksSection', () => ({ PRChecksSection: () => null }))
vi.mock('./PRCommentsSection', () => ({ PRCommentsSection: () => null }))
vi.mock('./PrSidebarCreateEmptyState', () => ({ PrSidebarCreateEmptyState: () => null }))
vi.mock('../../session/use-mobile-pr-actions', () => ({
  useMobilePrActions: () => ({
    blocked: null,
    isBusy: () => false,
    resolveReviewerRequested: (_login: string, authoritative: boolean) => authoritative,
    requestReviewer: vi.fn(),
    removeReviewer: vi.fn()
  })
}))
vi.mock('../../session/use-mobile-pr-comment-actions', () => ({
  useMobilePrCommentActions: () => ({})
}))
vi.mock('../../session/use-mobile-pr-title-action', () => ({ useMobilePrTitleAction: () => ({}) }))
vi.mock('../../session/use-mobile-pr-ai-triage', () => ({
  useMobilePrAiTriage: () => ({ launch: vi.fn(), isBusy: () => false, error: null })
}))
vi.mock('../../session/use-pr-bot-author-overrides', () => ({
  usePRBotAuthorOverrides: () => new Set<string>()
}))

const { ThemeProvider } = await import('../../theme/theme-context')
const { MobilePrViewPanelBody } = await import('./MobilePrViewPanel')

const PEOPLE = [{ login: 'alice', name: 'Alice', avatarUrl: 'https://example.invalid/a.png' }]

function controller(lastConnectedAt: number | null): MobilePrSidebarController {
  return {
    prSidebarState: {
      kind: 'ready',
      data: {
        pr: { number: 7, title: 'Seven', url: 'https://example.invalid/pr/7', state: 'open' },
        details: null,
        checks: [],
        checksError: null
      }
    },
    prSidebarRepoProbeFailed: false,
    prSidebarLastConnectedAt: lastConnectedAt,
    retryPRSidebar: () => undefined,
    refetchPRSidebar: () => undefined
  } as unknown as MobilePrSidebarController
}

let renderer: ReactTestRenderer | null = null

function body(client: RpcClient, lastConnectedAt: number | null) {
  return (
    <ThemeProvider initialPreference="light">
      <MobilePrViewPanelBody
        client={client}
        connState="connected"
        worktreeId="repo::/wt"
        branch="feature"
        headSha="sha-1"
        gitStatus={null}
        controller={controller(lastConnectedAt)}
      />
    </ThemeProvider>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
  })
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('the reviewer picker inside the PR body', () => {
  it('reads the people again when the controller reports a new connection after a failed read', async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValue({ id: 'r', ok: true, result: PEOPLE })
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(body(client, 1))
    })
    await act(async () => {
      renderer!.root
        .find(
          (node) =>
            String(node.type) === 'Pressable' &&
            node.props.accessibilityLabel === 'Add or remove reviewers'
        )
        .props.onPress()
    })
    await settle()
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer!.update(body(client, 2))
    })
    await settle()
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(
      renderer!.root.findAll(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Request alice'
      )
    ).toHaveLength(1)
  })
})
