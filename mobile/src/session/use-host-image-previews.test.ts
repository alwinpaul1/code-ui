import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  collectHostImagePaths,
  mergeImagePreviews,
  loadHostImage,
  resetHostImagePreviewCacheForTests
} from './use-host-image-previews'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }] } as NativeChatMessage
}

describe('collectHostImagePaths', () => {
  // 2026-09-13: the Read call lives in its own transcript record. Keyed by
  // that record, not a fold of this hook's own: the view folds with mid-turn
  // send boundaries this hook cannot see, and keying by the wrong fold left
  // the thumbnail off the row the view actually drew.
  it('keys an agent read image by its own record, for the view to remap', () => {
    const raw: NativeChatMessage[] = [
      { id: 'a1', role: 'assistant', blocks: [{ type: 'text', text: 'Looking.' }] } as NativeChatMessage,
      {
        id: 'a2',
        role: 'assistant',
        blocks: [{ type: 'tool-call', id: 'c1', name: 'Read', input: { file_path: '/repo/shot.png' } }]
      } as NativeChatMessage
    ]
    expect(collectHostImagePaths(raw, undefined)).toEqual({ a2: ['/repo/shot.png'] })
  })

  // Claude app, 2026-09-12: the screenshots an agent Read show as thumbnails
  // under its fold row. The transcript has no image block for a Read, so the
  // path from the tool call is what the phone can fetch a thumbnail of.
  it('lists the image files an agent message read, and only those', () => {
    const agent: NativeChatMessage = {
      id: 'a1',
      role: 'assistant',
      blocks: [
        { type: 'tool-call', id: 'c1', name: 'Read', input: { file_path: '/tmp/shot.png' } },
        { type: 'tool-call', id: 'c2', name: 'Read', input: { file_path: '/tmp/notes.md' } },
        { type: 'tool-call', id: 'c3', name: 'Bash', input: { command: 'cat /tmp/other.png' } },
        { type: 'tool-call', id: 'c4', name: 'Read', input: { file_path: '/tmp/second.JPG' } }
      ]
    } as NativeChatMessage
    expect(collectHostImagePaths([agent], undefined)).toEqual({ a1: ['/tmp/shot.png', '/tmp/second.JPG'] })
  })

  it('lists desktop-pasted image paths per user message, skipping phone sends', () => {
    const messages = [
      user('m1', 'look at this'),
      user('m2', '[Image: source: /var/folders/x/orca-paste-1.png]'),
      user('m3', '[Image: source: /var/folders/x/orca-paste-2.png]'),
      user('m4', '[Image: source: /tmp/phone.png]')
    ]
    const paths = collectHostImagePaths(messages, { m4: ['file:///local/phone.png'] })
    expect(paths.m1).toBeUndefined()
    expect(Object.values(paths).flat()).toEqual([
      '/var/folders/x/orca-paste-1.png',
      '/var/folders/x/orca-paste-2.png'
    ])
    expect(paths.m4).toBeUndefined()
  })
})

describe('mergeImagePreviews', () => {
  it('keeps local previews over host thumbnails for the same message', () => {
    expect(
      mergeImagePreviews(
        { a: ['file:///a.png'] },
        { a: ['data:image/png;base64,x'], b: ['data:b'] }
      )
    ).toEqual({ a: ['file:///a.png'], b: ['data:b'] })
  })
  it('returns the local map untouched when there is nothing from the host', () => {
    const local = { a: ['file:///a.png'] }
    expect(mergeImagePreviews(local, {})).toBe(local)
  })
})

describe('host image preview reads', () => {
  afterEach(() => {
    resetHostImagePreviewCacheForTests()
    vi.useRealTimers()
  })
  const args = {
    hostId: 'host',
    worktreeId: 'worktree',
    nativeChatContext: null,
    terminalHandle: 'term',
    path: '/tmp/a.png'
  }
  const preview = {
    ok: true,
    result: { isBinary: true, isImage: true, mimeType: 'image/png', content: 'AAAA' }
  }
  it('retries a failed resolution after the bounded cooldown', async () => {
    vi.useFakeTimers()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          openTarget: { kind: 'absolute-file', absolutePath: '/tmp/a.png', grantId: 'grant' }
        }
      })
      .mockResolvedValueOnce(preview)
    const client = { sendRequest } as unknown as import('../transport/rpc-client').RpcClient
    expect(await loadHostImage({ ...args, client })).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await loadHostImage({ ...args, client })).toBe('data:image/png;base64,AAAA')
    expect(sendRequest).toHaveBeenCalledTimes(3)
  })
  it('reads a resolved workspace image through its workspace preview endpoint', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: {
          worktree: 'sibling',
          openTarget: { kind: 'worktree-file', relativePath: 'a.png' }
        }
      })
      .mockResolvedValueOnce(preview)
    const client = { sendRequest } as unknown as import('../transport/rpc-client').RpcClient
    expect(await loadHostImage({ ...args, client })).toBe('data:image/png;base64,AAAA')
    expect(sendRequest).toHaveBeenLastCalledWith(
      'files.readPreview',
      { worktree: 'id:sibling', relativePath: 'a.png' },
      expect.any(Object)
    )
  })
})
