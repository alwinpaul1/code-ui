import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useProjectConfigFile, type ProjectConfigFileState } from './use-project-config-file'

function harness(client: RpcClient, worktreeId = 'w1', relativePath = '.mcp.json') {
  let latest!: ReturnType<typeof useProjectConfigFile>
  function Harness(): null {
    latest = useProjectConfigFile({ client, worktreeId, relativePath })
    return null
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Harness))
  })
  return {
    get: () => latest,
    rerender: () => act(() => {}),
    unmount: () => act(() => renderer.unmount())
  }
}

describe('useProjectConfigFile', () => {
  let cleanup: (() => void) | null = null
  afterEach(() => {
    cleanup?.()
    cleanup = null
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
