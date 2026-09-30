import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useProjectConfigFile, type ProjectConfigFileState } from './use-project-config-file'

// Which connection the host is on: moves each time it connects (useLastConnectedAt).
const connection = vi.hoisted(() => ({ lastConnectedAt: 1000 as number | null }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: (hostId: string | undefined) => (hostId ? connection.lastConnectedAt : null)
}))

function harness(client: RpcClient, worktreeId = 'w1', relativePath = '.mcp.json') {
  let latest!: ReturnType<typeof useProjectConfigFile>
  function Harness(): null {
    latest = useProjectConfigFile({ client, hostId: 'h1', worktreeId, relativePath })
    return null
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Harness))
  })
  return {
    get: () => latest,
    /** A render with nothing changed but what the test changed (the connection, say). */
    rerender: async () => {
      await act(async () => {
        renderer.update(createElement(Harness))
        await Promise.resolve()
        await Promise.resolve()
      })
    },
    unmount: () => act(() => renderer.unmount())
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useProjectConfigFile', () => {
  let cleanup: (() => void) | null = null
  beforeEach(() => {
    connection.lastConnectedAt = 1000
  })
  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  // Opened before the relay was up, the read failed ('Not connected', or 'relay session not
  // connected') and the screen sat on the error with a Retry for as long as the connection then
  // stayed healthy: the client object is the same across reconnects, so nothing re-read
  // (review, 2026-09-30).
  describe('after a failed read, when the relay connects', () => {
    const notConnected = () => Promise.reject(new Error('Not connected'))
    const file = { ok: true, result: { content: '{"mcpServers":{}}', truncated: false, byteLength: 18 } }

    it('reads again by itself, once, and lands ready', async () => {
      const sendRequest = vi.fn().mockImplementationOnce(notConnected).mockResolvedValue(file)
      const h = harness({ sendRequest } as unknown as RpcClient)
      cleanup = h.unmount
      await settle()
      expect(h.get().state.status).toBe('error')

      await h.rerender()
      expect(sendRequest).toHaveBeenCalledTimes(1)

      connection.lastConnectedAt = 2000
      await h.rerender()
      expect(sendRequest).toHaveBeenCalledTimes(2)
      expect(h.get().state.status).toBe('ready')
      await h.rerender()
      expect(sendRequest).toHaveBeenCalledTimes(2)
    })

    it('does not loop while the read keeps failing: one read per new connection', async () => {
      const sendRequest = vi.fn().mockImplementation(notConnected)
      const h = harness({ sendRequest } as unknown as RpcClient)
      cleanup = h.unmount
      await settle()

      connection.lastConnectedAt = 2000
      await h.rerender()
      await h.rerender()
      await h.rerender()
      expect(sendRequest).toHaveBeenCalledTimes(2)
      expect(h.get().state.status).toBe('error')

      connection.lastConnectedAt = 3000
      await h.rerender()
      expect(sendRequest).toHaveBeenCalledTimes(3)
    })

    it('never re-reads a ready draft, dirty or not, on a new connection', async () => {
      const sendRequest = vi.fn().mockResolvedValue(file)
      const h = harness({ sendRequest } as unknown as RpcClient)
      cleanup = h.unmount
      await settle()
      act(() => h.get().setContent('{"mcpServers":{"x":{"command":"npx"}}}'))

      connection.lastConnectedAt = 2000
      await h.rerender()
      expect(sendRequest).toHaveBeenCalledTimes(1)
      const state = h.get().state
      expect(state.status === 'ready' && state.isDirty).toBe(true)
      expect(state.status === 'ready' && state.content).toBe('{"mcpServers":{"x":{"command":"npx"}}}')
    })

    it('does not re-read a file the host said is missing', async () => {
      const sendRequest = vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'runtime_error', message: "ENOENT: no such file or directory, open '.mcp.json'" }
      })
      const h = harness({ sendRequest } as unknown as RpcClient)
      cleanup = h.unmount
      await settle()
      expect(h.get().state).toEqual({ status: 'missing' })

      connection.lastConnectedAt = 2000
      await h.rerender()
      expect(sendRequest).toHaveBeenCalledTimes(1)
    })

    it('reads again after a failed Create, so the next connection offers Create again', async () => {
      const sendRequest = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          error: { code: 'runtime_error', message: "ENOENT: no such file or directory, open 'CLAUDE.md'" }
        })
        .mockImplementationOnce(notConnected)
        .mockResolvedValueOnce({
          ok: false,
          error: { code: 'runtime_error', message: "ENOENT: no such file or directory, open 'CLAUDE.md'" }
        })
      const h = harness({ sendRequest } as unknown as RpcClient, 'w1', 'CLAUDE.md')
      cleanup = h.unmount
      await settle()
      await act(async () => {
        await h.get().create()
      })
      expect(h.get().state.status).toBe('error')

      connection.lastConnectedAt = 2000
      await h.rerender()
      expect(sendRequest).toHaveBeenLastCalledWith('files.read', {
        worktree: 'id:w1',
        relativePath: 'CLAUDE.md'
      })
      expect(h.get().state).toEqual({ status: 'missing' })
    })
  })

  it('reads the file and lands ready with the host content', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { content: '{"mcpServers":{}}', truncated: false, byteLength: 18 }
    })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const state = h.get().state
    expect(state.status).toBe('ready')
    expect(state.status === 'ready' && state.content).toBe('{"mcpServers":{}}')
    expect(sendRequest).toHaveBeenCalledWith('files.read', { worktree: 'id:w1', relativePath: '.mcp.json' })
  })

  it('missing file (the host’s real ENOENT text) lands on "missing", not a generic error', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'runtime_error', message: "ENOENT: no such file or directory, open '.mcp.json'" }
    })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(h.get().state).toEqual({ status: 'missing' })
  })

  it('a jailed path (the host’s real invalid_relative_path throw) lands on "error"', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'runtime_error', message: 'invalid_relative_path' }
    })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const state = h.get().state
    expect(state.status).toBe('error')
    expect(state.status === 'error' && state.message).toMatch(/outside the project/i)
  })

  it('a truncated read lands on "too-large" instead of offering to edit a partial file', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { content: 'part', truncated: true, byteLength: 999_999 }
    })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(h.get().state).toEqual({ status: 'too-large', byteLength: 999_999 })
  })

  it('setContent marks the draft dirty against what was actually loaded', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { content: 'a', truncated: false, byteLength: 1 }
    })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => h.get().setContent('b'))
    const state = h.get().state
    expect(state.status === 'ready' && state.isDirty).toBe(true)
    act(() => h.get().setContent('a'))
    expect((h.get().state as { isDirty: boolean }).isDirty).toBe(false)
  })

  // The load-bearing failure path: `files.write` is refused by the host for
  // every mobile client (see project-config-file-error.ts). Saving must keep
  // the user's draft on screen and show the real refusal, not lose the edit.
  it('a refused save keeps the draft content and reports the real refusal, reverting nothing', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { content: 'original', truncated: false, byteLength: 8 } })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'forbidden', message: "Method 'files.write' is not available to mobile clients" }
      })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => h.get().setContent('edited by the user'))
    await act(async () => {
      await h.get().save()
    })
    const state = h.get().state
    expect(state.status).toBe('ready')
    expect(state.status === 'ready' && state.content).toBe('edited by the user')
    expect(state.status === 'ready' && state.isDirty).toBe(true)
    expect(state.status === 'ready' && state.saveError).toMatch(/can't save/i)
  })

  it('a successful save (hypothetically) clears dirty and adopts the new saved content', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { content: 'original', truncated: false, byteLength: 8 } })
      .mockResolvedValueOnce({ ok: true, result: {} })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => h.get().setContent('changed'))
    await act(async () => {
      await h.get().save()
    })
    const state = h.get().state
    expect(state.status === 'ready' && state.isDirty).toBe(false)
    expect(state.status === 'ready' && state.saveError).toBeNull()
  })

  // The write carries the draft as it was when Save was tapped. An edit made while it is on the
  // wire never reached the host, so it must stay unsaved (review, 2026-09-30).
  it('keeps an edit made while a save is in flight unsaved, with Save live again', async () => {
    let releaseWrite!: (reply: unknown) => void
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { content: 'A', truncated: false, byteLength: 1 } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseWrite = resolve
          })
      )
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => h.get().setContent('B'))
    let saved!: Promise<void>
    act(() => {
      saved = h.get().save()
    })
    act(() => h.get().setContent('C'))
    await act(async () => {
      releaseWrite({ ok: true, result: {} })
      await saved
    })

    expect(sendRequest).toHaveBeenLastCalledWith('files.write', {
      worktree: 'id:w1',
      relativePath: '.mcp.json',
      content: 'B'
    })
    const state = h.get().state
    expect(state.status === 'ready' && state.content).toBe('C')
    expect(state.status === 'ready' && state.savedContent).toBe('B')
    expect(state.status === 'ready' && state.isDirty).toBe(true)
    expect(state.status === 'ready' && state.saving).toBe(false)
  })

  it('is clean after a save when the draft was edited back to what was written', async () => {
    let releaseWrite!: (reply: unknown) => void
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { content: 'A', truncated: false, byteLength: 1 } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseWrite = resolve
          })
      )
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client)
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => h.get().setContent('B'))
    let saved!: Promise<void>
    act(() => {
      saved = h.get().save()
    })
    act(() => h.get().setContent('BX'))
    act(() => h.get().setContent('B'))
    await act(async () => {
      releaseWrite({ ok: true, result: {} })
      await saved
    })

    const state = h.get().state
    expect(state.status === 'ready' && state.savedContent).toBe('B')
    expect(state.status === 'ready' && state.isDirty).toBe(false)
  })

  it('create() re-reads after a successful files.createFile, landing on "ready" with empty content', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'runtime_error', message: "ENOENT: no such file or directory, open 'CLAUDE.md'" }
      })
      .mockResolvedValueOnce({ ok: true, result: { ok: true } })
      .mockResolvedValueOnce({ ok: true, result: { content: '', truncated: false, byteLength: 0 } })
    const client = { sendRequest } as unknown as RpcClient
    const h = harness(client, 'w1', 'CLAUDE.md')
    cleanup = h.unmount
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(h.get().state).toEqual({ status: 'missing' })
    await act(async () => {
      await h.get().create()
    })
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'files.createFile', {
      worktree: 'id:w1',
      relativePath: 'CLAUDE.md'
    })
    const state = h.get().state
    expect(state.status).toBe('ready')
    expect(state.status === 'ready' && state.content).toBe('')
  })
})

// Referenced only for the type-check that ProjectConfigFileState's discriminant covers the switch below.
function _assertExhaustive(state: ProjectConfigFileState): string {
  switch (state.status) {
    case 'loading':
      return 'loading'
    case 'missing':
      return 'missing'
    case 'too-large':
      return 'too-large'
    case 'error':
      return 'error'
    case 'ready':
      return 'ready'
    default: {
      const _never: never = state
      return _never
    }
  }
}
