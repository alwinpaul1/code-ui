// The session's own PR repo probe (useMobilePrBranchContext) after the probe FAILED.
//
// It folded a failed `github.repoSlug` into "loaded, not a GitHub repo", the same as the PR
// segment's controller did. The session reads that pair to close a docked PR panel
// (use-mobile-session-foundation.ts: `repoLoaded && !isGithubRepo`), so one relay timeout closed
// the panel the user had open on a GitHub repo. A failed probe is "not known yet": repoLoaded stays
// false, and the probe runs again on the next connection. The bounded retries while a connection
// stays up are in pr-branch-context-probe-retry.test.ts.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import {
  loadMobilePrBranchContext,
  loadMobilePrRepoContext,
  useMobilePrBranchContext,
  type MobilePrBranchContext
} from './use-mobile-pr-branch-context'

let captured: MobilePrBranchContext | null = null

function Harness(props: { client: RpcClient; connState: ConnectionState }) {
  captured = useMobilePrBranchContext({
    ...props,
    worktreeId: 'repo::/wt',
    includeBranchIdentity: false
  })
  return null
}

describe('the session PR repo probe after a failed github.repoSlug', () => {
  let renderer: ReactTestRenderer | null = null
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    captured = null
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockRestore()
  })

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve()
      }
    })
  }

  it('does not claim the repo has no GitHub remote when the probe times out', async () => {
    const sendRequest = vi.fn(() => Promise.reject(new Error('Request timed out: github.repoSlug')))
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Harness, { client, connState: 'connected' }))
    })
    await flush()

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(captured?.repoLoaded).toBe(false)
    expect(captured?.isGithubRepo).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('Request timed out: github.repoSlug')
  })

  it('probes again on the next connection and then answers', async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValue({ ok: true, result: { owner: 'o', repo: 'r' } })
    const client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Harness, { client, connState: 'connected' }))
    })
    await flush()
    await act(async () => {
      renderer?.update(createElement(Harness, { client, connState: 'reconnecting' }))
    })
    await flush()
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer?.update(createElement(Harness, { client, connState: 'connected' }))
    })
    await flush()
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(captured?.repoLoaded).toBe(true)
    expect(captured?.isGithubRepo).toBe(true)
  })

  it('rejects loadMobilePrRepoContext with the cause instead of answering "not GitHub"', async () => {
    const sendRequest = vi.fn(async () => ({ ok: false, error: { message: 'runtime_timeout' } }))
    await expect(loadMobilePrRepoContext({ sendRequest } as never, 'repo::/wt')).rejects.toThrow(
      'runtime_timeout'
    )
  })

  it('keeps a real "no GitHub remote" answer as loaded and not GitHub', async () => {
    const sendRequest = vi.fn(async () => ({ ok: true, result: null }))
    await expect(loadMobilePrRepoContext({ sendRequest } as never, 'repo::/wt')).resolves.toEqual({
      isGithubRepo: false
    })
  })

  it('keeps the branch identity from loadMobilePrBranchContext and marks the repo unknown when only the probe failed', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'git.status') {
        return {
          ok: true,
          result: { entries: [], conflictOperation: 'unknown', branch: 'feat', head: 'sha-status' }
        }
      }
      if (method === 'github.repoSlug') {
        return { ok: false, error: { message: 'runtime_timeout' } }
      }
      return { ok: false, error: { message: `unexpected ${method}` } }
    })
    const out = await loadMobilePrBranchContext({ sendRequest } as never, 'repo::/wt')
    expect(out).toMatchObject({
      branch: 'feat',
      headSha: 'sha-status',
      isGithubRepo: false,
      repoLoaded: false,
      loaded: true
    })
  })
})
