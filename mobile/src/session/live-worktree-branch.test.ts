import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useLiveWorktreeName } from './use-live-worktree-name'

vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(effect, [effect])
    }
  }
})

// The header menu's Copy branch (parity gap G35) takes the branch from the same
// `worktree.show` record the title already comes from: Orca's record is a Worktree & GitWorktreeInfo,
// so `branch` is the full ref, refreshed on the same `worktreesChanged` event as the name.

let renderer: ReactTestRenderer | null = null
let listener: ((payload: unknown) => void) | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  listener = null
})

function showReply(worktree: Record<string, unknown>) {
  return { id: 'worktree-show', ok: true, result: { worktree }, _meta: { runtimeId: 'runtime-1' } }
}

async function mount(sendRequest: ReturnType<typeof vi.fn>, worktreeId = 'repo-1::/worktree') {
  const client = {
    sendRequest,
    subscribe: (_method: string, _params: unknown, next: (payload: unknown) => void) => {
      listener = next
      return () => {}
    }
  } as unknown as RpcClient
  const seen: { branch: string | null }[] = []
  function Harness(): null {
    const { branch } = useLiveWorktreeName({ client, connState: 'connected', routeName: 'Route', worktreeId })
    seen.push({ branch })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
    await Promise.resolve()
    await Promise.resolve()
  })
  return seen
}

describe('the live worktree record carries the branch for the header menu', () => {
  it('reads the branch off the worktree.show record', async () => {
    const seen = await mount(vi.fn().mockResolvedValue(showReply({ id: 'repo-1::/worktree', displayName: 'Header', branch: 'refs/heads/feature/header' })))
    expect(seen.at(-1)?.branch).toBe('refs/heads/feature/header')
  })

  it('follows a branch switch the host announces', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(showReply({ id: 'repo-1::/worktree', branch: 'refs/heads/main' }))
      .mockResolvedValue(showReply({ id: 'repo-1::/worktree', branch: 'refs/heads/next' }))
    const seen = await mount(sendRequest)
    expect(seen.at(-1)?.branch).toBe('refs/heads/main')
    await act(async () => {
      listener?.({ type: 'worktreesChanged', repoId: 'repo-1' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(seen.at(-1)?.branch).toBe('refs/heads/next')
  })

  it('is null, not a stale or invented branch, when the record has none or the read is refused', async () => {
    const none = await mount(vi.fn().mockResolvedValue(showReply({ id: 'repo-1::/worktree' })))
    expect(none.at(-1)?.branch).toBeNull()
    act(() => renderer?.unmount())
    const refused = await mount(
      vi.fn().mockResolvedValue({ id: 'x', ok: false, error: { code: 'selector_not_found', message: 'gone' }, _meta: { runtimeId: 'r' } })
    )
    expect(refused.at(-1)?.branch).toBeNull()
  })

  it('has no branch on the floating workspace, which has no record', async () => {
    const sendRequest = vi.fn()
    const seen = await mount(sendRequest, 'global-floating-terminal')
    expect(sendRequest).not.toHaveBeenCalled()
    expect(seen.at(-1)?.branch).toBeNull()
  })
})
