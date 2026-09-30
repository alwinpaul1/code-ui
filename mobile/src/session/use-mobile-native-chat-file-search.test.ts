import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatFileSearch } from './use-mobile-native-chat-file-search'

type SearchState = ReturnType<typeof useMobileNativeChatFileSearch>

function rpcSuccess(files: string[]): Awaited<ReturnType<RpcClient['sendRequest']>> {
  return {
    id: 'files',
    ok: true,
    result: { files: files.map((relativePath) => ({ relativePath })) },
    _meta: { runtimeId: 'runtime-1' }
  }
}

/** The hook reaches only the members each case supplies, so the rest of the client is a fake. */
type FileSearchClientParts = {
  sendRequest: unknown
  getGeneration?: () => number
  getLastConnectedAt?: () => number | null
}

function fakeClient(parts: FileSearchClientParts): RpcClient {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The hook calls `sendRequest`, `getGeneration` and `getLastConnectedAt` and nothing else on the client; every other member is unreachable from it.
  return parts as RpcClient
}

describe('useMobileNativeChatFileSearch', () => {
  let renderer: ReactTestRenderer | null = null
  let state: SearchState | null = null

  async function mount(client: RpcClient): Promise<void> {
    function Harness(): null {
      state = useMobileNativeChatFileSearch({ client, worktreeId: 'wt-1' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    state = null
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('coalesces rapid queries and retains only the bounded host result', async () => {
    const sendRequest = vi.fn().mockResolvedValue(rpcSuccess(['src/app.ts', 'src/app.test.ts']))
    await mount(fakeClient({ sendRequest }))

    act(() => {
      state?.loadNativeChatFiles('a')
      state?.loadNativeChatFiles('app')
    })
    await act(async () => vi.advanceTimersByTimeAsync(119))
    expect(sendRequest).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest).toHaveBeenCalledWith('files.searchPaths', {
      worktree: 'id:wt-1',
      query: 'app',
      limit: 16
    })
    expect(state?.nativeChatFilePaths).toEqual(['src/app.ts', 'src/app.test.ts'])
  })

  it('loads the legacy inventory once when an older host lacks searchPaths', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'files.searchPaths') {
        return {
          id: 'missing',
          ok: false as const,
          error: { code: 'method_not_found', message: 'Unknown method' },
          _meta: { runtimeId: 'runtime-1' }
        }
      }
      return rpcSuccess(['src/apple.ts', 'docs/readme.md'])
    })
    await mount(fakeClient({ sendRequest }))

    act(() => state?.loadNativeChatFiles('apple'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state?.nativeChatFilePaths).toEqual(['src/apple.ts'])

    act(() => state?.loadNativeChatFiles('readme'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state?.nativeChatFilePaths).toEqual(['docs/readme.md'])
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'files.searchPaths',
      'files.list'
    ])
  })

  it('cancels an in-flight query on a cache hit so a stale result cannot clobber it', async () => {
    const sendRequest = vi.fn(async (_method: string, params: { query: string }) =>
      rpcSuccess(params.query === 'app' ? ['src/app.ts'] : ['src/beta.ts'])
    )
    await mount(fakeClient({ sendRequest }))

    // Populate the cache for 'app'.
    act(() => state?.loadNativeChatFiles('app'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])

    // Schedule 'beta' (debounced, unresolved), then hit the cache for 'app'.
    act(() => {
      state?.loadNativeChatFiles('beta')
      state?.loadNativeChatFiles('app')
    })
    expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])

    // The cancelled 'beta' request must never fire and overwrite the cached result.
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])
    expect(
      sendRequest.mock.calls.filter(([, params]) => (params as { query: string }).query === 'beta')
    ).toHaveLength(0)
  })

  it('reloads the legacy inventory when the logical authority epoch advances', async () => {
    let generation = 1
    const inventories = [['src/apple.ts', 'docs/readme.md'], ['docs/guide.md']]
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'files.searchPaths') {
        return {
          id: 'missing',
          ok: false as const,
          error: { code: 'method_not_found', message: 'Unknown method' },
          _meta: { runtimeId: 'runtime-1' }
        }
      }
      return rpcSuccess(inventories.shift() ?? [])
    })
    await mount(fakeClient({ sendRequest, getGeneration: () => generation }))

    const listCalls = (): number =>
      sendRequest.mock.calls.filter(([method]) => method === 'files.list').length
    act(() => state?.loadNativeChatFiles('apple'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state?.nativeChatFilePaths).toEqual(['src/apple.ts'])
    expect(listCalls()).toBe(1)

    // Control: a fresh query under the same epoch is answered from the inventory already held.
    act(() => state?.loadNativeChatFiles('readme'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(listCalls()).toBe(1)

    // `migrateTo` advanced the logical authority epoch. The client is the same object and the
    // workspace did not change, so the epoch in the scope is the only thing that can retire the
    // inventory the host under the old authority gave us.
    generation = 2
    act(() => state?.loadNativeChatFiles('guide'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(listCalls()).toBe(2)
    expect(state?.nativeChatFilePaths).toEqual(['docs/guide.md'])
  })

  it('coalesces overlapping legacy inventory requests on a slow host', async () => {
    let resolveList: (value: Awaited<ReturnType<RpcClient['sendRequest']>>) => void = () => {}
    const listResponse = new Promise<Awaited<ReturnType<RpcClient['sendRequest']>>>((resolve) => {
      resolveList = resolve
    })
    const sendRequest = vi.fn((method: string) => {
      if (method === 'files.searchPaths') {
        return Promise.resolve({
          id: 'missing',
          ok: false as const,
          error: { code: 'method_not_found', message: 'Unknown method' },
          _meta: { runtimeId: 'runtime-1' }
        })
      }
      return listResponse
    })
    await mount(fakeClient({ sendRequest }))

    act(() => state?.loadNativeChatFiles('apple'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    act(() => state?.loadNativeChatFiles('readme'))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(sendRequest.mock.calls.filter(([method]) => method === 'files.list')).toHaveLength(1)

    await act(async () => {
      resolveList(rpcSuccess(['src/apple.ts', 'docs/readme.md']))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(state?.nativeChatFilePaths).toEqual(['docs/readme.md'])
  })

  // The `@` picker served a query from a cache that never expired, so a file
  // the agent wrote after the first search never appeared in it: search 'n'
  // (the host has src/app.ts), the agent writes src/new.ts, and a minute later
  // 'n' still offered only src/app.ts.
  describe('a file the agent created after the first search', () => {
    const searchMissing = {
      id: 'missing',
      ok: false as const,
      error: { code: 'method_not_found', message: 'Unknown method' },
      _meta: { runtimeId: 'runtime-1' }
    }
    const searches = (sendRequest: ReturnType<typeof vi.fn>, method = 'files.searchPaths'): number =>
      sendRequest.mock.calls.filter(([called]) => called === method).length
    const search = async (query: string): Promise<void> => {
      act(() => state?.loadNativeChatFiles(query))
      await act(async () => vi.advanceTimersByTimeAsync(120))
    }

    it('is offered once the cached list is older than 10 s, which shows at once meanwhile', async () => {
      let files = ['src/app.ts']
      const sendRequest = vi.fn(async () => rpcSuccess(files))
      await mount(fakeClient({ sendRequest }))
      await search('n')
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])

      files = ['src/app.ts', 'src/new.ts']
      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      act(() => state?.loadNativeChatFiles('n'))
      // The cached list at once, not an empty "still looking" menu.
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])
      expect(state?.nativeChatFileSearchPending).toBe(false)
      await act(async () => vi.advanceTimersByTimeAsync(120))
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts', 'src/new.ts'])
      expect(searches(sendRequest)).toBe(2)
    })

    it('does not ask the host again for a search repeated within 10 s', async () => {
      const sendRequest = vi.fn(async (_method: string, params: { query: string }) =>
        rpcSuccess(params.query === 'n' ? ['src/app.ts'] : ['src/app.ts', 'src/nav.ts'])
      )
      await mount(fakeClient({ sendRequest }))
      await search('n')
      await search('na')
      await act(async () => vi.advanceTimersByTimeAsync(9_000))
      await search('n')
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])
      expect(searches(sendRequest)).toBe(2)
    })

    it('is offered for a search that first found nothing, without waiting out the 10 s', async () => {
      let files: string[] = []
      const sendRequest = vi.fn(async () => rpcSuccess(files))
      await mount(fakeClient({ sendRequest }))
      await search('n')
      expect(state?.nativeChatFilePaths).toEqual([])

      files = ['src/new.ts']
      await act(async () => vi.advanceTimersByTimeAsync(1_000))
      await search('n')
      expect(state?.nativeChatFilePaths).toEqual(['src/new.ts'])
      expect(searches(sendRequest)).toBe(2)
    })

    it('keeps the cached list when asking the host again fails', async () => {
      const sendRequest = vi.fn().mockResolvedValueOnce(rpcSuccess(['src/app.ts']))
      await mount(fakeClient({ sendRequest }))
      await search('n')

      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      sendRequest.mockRejectedValueOnce(new Error('socket closed'))
      await search('n')
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])
      expect(state?.nativeChatFileSearchPending).toBe(false)

      // A refusal that is not method_not_found keeps it too.
      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      sendRequest.mockResolvedValueOnce({
        id: 'files',
        ok: false as const,
        error: { code: 'internal_error', message: 'boom' },
        _meta: { runtimeId: 'runtime-1' }
      })
      await search('n')
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])
      expect(searches(sendRequest)).toBe(3)
    })

    it('is looked up afresh after the host reconnects, even within 10 s', async () => {
      let connectedAt = 1_000
      let files = ['src/app.ts']
      const sendRequest = vi.fn(async () => rpcSuccess(files))
      await mount(fakeClient({ sendRequest, getLastConnectedAt: () => connectedAt }))
      await search('n')

      files = ['src/app.ts', 'src/new.ts']
      connectedAt = 2_000
      act(() => state?.loadNativeChatFiles('n'))
      // The old connection's answer is not shown as current.
      expect(state?.nativeChatFilePaths).toEqual([])
      expect(state?.nativeChatFileSearchPending).toBe(true)
      await act(async () => vi.advanceTimersByTimeAsync(120))
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts', 'src/new.ts'])
      expect(searches(sendRequest)).toBe(2)
    })

    it('is offered by an older host once its whole-workspace list is older than 10 s', async () => {
      let files = ['src/app.ts', 'docs/readme.md']
      const sendRequest = vi.fn(async (method: string) =>
        method === 'files.searchPaths' ? searchMissing : rpcSuccess(files)
      )
      await mount(fakeClient({ sendRequest }))
      await search('ap')
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])

      // Within 10 s a new query is answered from the list already held.
      await search('read')
      expect(searches(sendRequest, 'files.list')).toBe(1)

      files = ['src/app.ts', 'src/apple.ts', 'docs/readme.md']
      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      await search('app')
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts', 'src/apple.ts'])
      expect(searches(sendRequest, 'files.list')).toBe(2)
    })

    it('keeps an older host’s list when reading it again fails', async () => {
      const sendRequest = vi.fn(async (method: string) =>
        method === 'files.searchPaths' ? searchMissing : rpcSuccess(['src/app.ts'])
      )
      await mount(fakeClient({ sendRequest }))
      await search('ap')

      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      sendRequest.mockImplementation(async (method: string) => {
        if (method === 'files.searchPaths') {
          return searchMissing
        }
        throw new Error('socket closed')
      })
      await search('app')
      expect(state?.nativeChatFilePaths).toEqual(['src/app.ts'])
      expect(searches(sendRequest, 'files.list')).toBe(2)
    })
  })
})
