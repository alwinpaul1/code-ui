// The host round trip behind "Revert this hunk": resolve the card's path inside
// the worktree, read the file as it is NOW, plan against that, and write back
// through the same ownership-checked path the markdown editor uses. Every
// failure here is a real refusal from a fake host — a jail, a missing file, a
// clipped read, a reply the reader cannot read — never a stub returning empty.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEditFile, type NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import { FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import type { RpcResponse } from '../transport/types'
import { resetHunkRevertMarksForTests } from './mobile-diff-hunk-revert-marks'
import { revertDiffCardHunk } from './mobile-diff-hunk-revert-request'

function success(result: unknown): RpcResponse {
  return { id: 'rpc', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function failure(code: string, message: string): RpcResponse {
  return { id: 'rpc', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

type Replies = Partial<Record<string, RpcResponse | (() => Promise<RpcResponse>)>>

/** A host that answers by method. Anything unlisted is a bug in the test. */
function host(replies: Replies) {
  const calls: { method: string; params: unknown }[] = []
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params })
    const reply = replies[method]
    if (!reply) {
      throw new Error(`unexpected ${method}`)
    }
    return typeof reply === 'function' ? reply() : reply
  })
  return { client: { sendRequest }, calls }
}

const resolvedInWorktree = success({
  worktree: 'wt-1',
  relativePath: 'src/app.ts',
  absolutePath: '/w/src/app.ts',
  exists: true,
  isDirectory: false,
  openTarget: {
    kind: 'worktree-file',
    provider: 'local',
    relativePath: 'src/app.ts',
    absolutePath: '/w/src/app.ts'
  }
})

const ownershipReplies: Replies = {
  'status.get': success({ capabilities: [FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY] }),
  'worktree.show': success({ worktree: { hostId: 'local' } })
}

/** `const b = 2` became `const b = 9` at line 41, as the structured lane
 *  reports it (numbered rows). */
const card: NativeChatEditFile = finalizeEditFile({
  path: '/w/src/app.ts',
  oldPath: null,
  changeKind: 'edited',
  lineNumbersKnown: true,
  lines: [
    { kind: 'context', text: 'const a = 1', oldLineNumber: 40, newLineNumber: 40 },
    { kind: 'del', text: 'const b = 2', oldLineNumber: 41, newLineNumber: null },
    { kind: 'add', text: 'const b = 9', oldLineNumber: null, newLineNumber: 41 },
    { kind: 'context', text: 'const c = 3', oldLineNumber: 42, newLineNumber: 42 }
  ]
})

const fileNow = [
  ...Array.from({ length: 39 }, (_, i) => `line ${i + 1}`),
  'const a = 1',
  'const b = 9',
  'const c = 3',
  ''
].join('\n')

function revert(client: { sendRequest: ReturnType<typeof vi.fn> }, file = card) {
  return revertDiffCardHunk({
    client,
    worktreeId: 'wt-1',
    nativeChatContext: { tabId: 'tab-1', sessionId: 'sess-1' },
    file,
    hunkIndex: 0,
    cardScope: 'msg-1:0:0'
  })
}

describe('reverting a hunk against the host', () => {
  beforeEach(() => resetHunkRevertMarksForTests())

  it('reads the file as it is now, then writes it back with the hunk undone', async () => {
    const { client, calls } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': success({ content: fileNow, truncated: false, byteLength: fileNow.length }),
      ...ownershipReplies,
      'files.write': success({ ok: true })
    })
    await expect(revert(client)).resolves.toEqual({ status: 'reverted', removed: 1, restored: 1 })
    const write = calls.find((call) => call.method === 'files.write')
    expect(write?.params).toEqual({
      worktree: 'id:wt-1',
      relativePath: 'src/app.ts',
      expectedExecutionHostId: 'local',
      content: fileNow.replace('const b = 9', 'const b = 2')
    })
    // The card's absolute path went to the host for resolution, with the chat
    // provenance the tap-to-open flow sends — never a terminal cwd.
    expect(calls[0]).toEqual({
      method: 'files.resolveTerminalPath',
      params: {
        worktree: 'id:wt-1',
        pathText: '/w/src/app.ts',
        nativeChatContext: { tabId: 'tab-1', sessionId: 'sess-1' }
      }
    })
  })

  it('refuses without writing when the file drifted under the hunk', async () => {
    const { client, calls } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': success({ content: fileNow.replace('const b = 9', 'const b = 10'), truncated: false }),
      ...ownershipReplies,
      'files.write': success({ ok: true })
    })
    await expect(revert(client)).resolves.toEqual({
      status: 'refused',
      message: 'This part of the file changed since; open the diff to revert by hand.'
    })
    expect(calls.map((call) => call.method)).toEqual(['files.resolveTerminalPath', 'files.read'])
  })

  it('reports a write the host refused, in the host’s words', async () => {
    const { client } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': success({ content: fileNow, truncated: false }),
      ...ownershipReplies,
      'files.write': failure('EACCES', 'Path escapes the workspace')
    })
    await expect(revert(client)).resolves.toEqual({
      status: 'failed',
      message: "Couldn't write src/app.ts: Path escapes the workspace"
    })
  })

  it('reports a file the host can no longer find', async () => {
    const { client, calls } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': failure('ENOENT', 'ENOENT: no such file or directory')
    })
    await expect(revert(client)).resolves.toEqual({
      status: 'failed',
      message: "Couldn't read src/app.ts: ENOENT: no such file or directory"
    })
    expect(calls.some((call) => call.method === 'files.write')).toBe(false)
  })

  it('refuses a path the host resolves outside the worktree', async () => {
    const { client, calls } = host({
      'files.resolveTerminalPath': success({
        worktree: 'wt-1',
        relativePath: null,
        absolutePath: '/tmp/elsewhere.ts',
        exists: true,
        isDirectory: false,
        openTarget: { kind: 'absolute-file', provider: 'local', absolutePath: '/tmp/elsewhere.ts', grantId: 'g' }
      })
    })
    await expect(revert(client)).resolves.toEqual({
      status: 'refused',
      message: 'This file is outside the workspace; open it on the desktop to revert by hand.'
    })
    expect(calls.map((call) => call.method)).toEqual(['files.resolveTerminalPath'])
  })

  it('refuses a path the host says no longer exists', async () => {
    const { client } = host({
      'files.resolveTerminalPath': success({
        worktree: 'wt-1',
        relativePath: 'src/app.ts',
        absolutePath: '/w/src/app.ts',
        exists: false,
        isDirectory: false
      })
    })
    await expect(revert(client)).resolves.toEqual({
      status: 'refused',
      message: 'This file no longer exists in the workspace.'
    })
  })

  it('refuses a read the host clipped: writing it back would clip the file', async () => {
    const { client, calls } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': success({ content: fileNow, truncated: true, byteLength: 9_999_999 })
    })
    await expect(revert(client)).resolves.toEqual({
      status: 'refused',
      message: 'This file is too large to rewrite from the phone; open the diff to revert by hand.'
    })
    expect(calls.some((call) => call.method === 'files.write')).toBe(false)
  })

  it('reports a read reply that carries no text, naming the operation', async () => {
    const { client } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': success({ content: 42, truncated: false })
    })
    const outcome = await revert(client)
    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' ? outcome.message : '').toContain('files.read')
  })

  it('refuses a read that does not say whether it was clipped, rather than assuming it was not', async () => {
    const { client, calls } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': success({ content: fileNow })
    })
    const outcome = await revert(client)
    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' ? outcome.message : '').toContain('files.read')
    expect(calls.some((call) => call.method === 'files.write')).toBe(false)
  })

  it('reports a transport failure instead of throwing at the card', async () => {
    const { client } = host({
      'files.resolveTerminalPath': () => Promise.reject(new Error('socket closed'))
    })
    await expect(revert(client)).resolves.toEqual({
      status: 'failed',
      message: "Couldn't resolve /w/src/app.ts: socket closed"
    })
  })

  it('reverts a second hunk on the same card after the first one moved the lines below it', async () => {
    // Two numbered hunks: line 2 `b` became `B` and `B2` (one line longer),
    // line 11 `y` became `Y`. Reverting the top hunk shifts everything below
    // it up by one; the card's number for the bottom hunk is now stale by
    // exactly that — a shift the phone made itself, so it can account for it.
    const twoHunks: NativeChatEditFile = finalizeEditFile({
      path: '/w/src/app.ts',
      oldPath: null,
      changeKind: 'edited',
      lineNumbersKnown: true,
      lines: [
        { kind: 'context', text: 'a', oldLineNumber: 1, newLineNumber: 1 },
        { kind: 'del', text: 'b', oldLineNumber: 2, newLineNumber: null },
        { kind: 'add', text: 'B', oldLineNumber: null, newLineNumber: 2 },
        { kind: 'add', text: 'B2', oldLineNumber: null, newLineNumber: 3 },
        { kind: 'context', text: 'c', oldLineNumber: 3, newLineNumber: 4 },
        { kind: 'gap', text: '', oldLineNumber: null, newLineNumber: null },
        { kind: 'context', text: 'x', oldLineNumber: 10, newLineNumber: 11 },
        { kind: 'del', text: 'y', oldLineNumber: 11, newLineNumber: null },
        { kind: 'add', text: 'Y', oldLineNumber: null, newLineNumber: 12 },
        { kind: 'context', text: 'z', oldLineNumber: 12, newLineNumber: 13 }
      ]
    })
    let disk = 'a\nB\nB2\nc\n1\n2\n3\n4\n5\n6\nx\nY\nz\n'
    const { client } = host({
      'files.resolveTerminalPath': resolvedInWorktree,
      'files.read': () => Promise.resolve(success({ content: disk, truncated: false })),
      ...ownershipReplies,
      'files.write': success({ ok: true })
    })
    const written: string[] = []
    client.sendRequest.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'files.write') {
        disk = (params as { content: string }).content
        written.push(disk)
        return success({ ok: true })
      }
      if (method === 'files.read') {
        return success({ content: disk, truncated: false })
      }
      if (method === 'files.resolveTerminalPath') {
        return resolvedInWorktree
      }
      return ownershipReplies[method] as RpcResponse
    })
    const first = await revertDiffCardHunk({
      client,
      worktreeId: 'wt-1',
      nativeChatContext: null,
      file: twoHunks,
      hunkIndex: 0,
      cardScope: 'msg-1:0:0'
    })
    expect(first).toEqual({ status: 'reverted', removed: 2, restored: 1 })
    // Another card with the same rows (the agent re-applied the edit later)
    // knows nothing of this card's shift: its numbers are its own.
    const otherCard = await revertDiffCardHunk({
      client,
      worktreeId: 'wt-1',
      nativeChatContext: null,
      file: twoHunks,
      hunkIndex: 1,
      cardScope: 'msg-9:0:0'
    })
    expect(otherCard).toMatchObject({ status: 'refused' })
    const second = await revertDiffCardHunk({
      client,
      worktreeId: 'wt-1',
      nativeChatContext: null,
      file: twoHunks,
      hunkIndex: 1,
      cardScope: 'msg-1:0:0'
    })
    expect(second).toEqual({ status: 'reverted', removed: 1, restored: 1 })
    expect(written.at(-1)).toBe('a\nb\nc\n1\n2\n3\n4\n5\n6\nx\ny\nz\n')
  })

  it('still refuses the second hunk when something else moved the lines too', async () => {
    const card: NativeChatEditFile = finalizeEditFile({
      path: '/w/src/app.ts',
      oldPath: null,
      changeKind: 'edited',
      lineNumbersKnown: true,
      lines: [
        { kind: 'context', text: 'a', oldLineNumber: 1, newLineNumber: 1 },
        { kind: 'add', text: 'B', oldLineNumber: null, newLineNumber: 2 },
        { kind: 'context', text: 'c', oldLineNumber: 2, newLineNumber: 3 },
        { kind: 'gap', text: '', oldLineNumber: null, newLineNumber: null },
        { kind: 'context', text: 'x', oldLineNumber: 5, newLineNumber: 6 },
        { kind: 'add', text: 'Y', oldLineNumber: null, newLineNumber: 7 },
        { kind: 'context', text: 'z', oldLineNumber: 6, newLineNumber: 8 }
      ]
    })
    let disk = 'a\nB\nc\nd\ne\nx\nY\nz\n'
    const { client } = host({})
    client.sendRequest.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'files.write') {
        disk = (params as { content: string }).content
        return success({ ok: true })
      }
      if (method === 'files.read') {
        return success({ content: disk, truncated: false })
      }
      if (method === 'files.resolveTerminalPath') {
        return resolvedInWorktree
      }
      return ownershipReplies[method] as RpcResponse
    })
    await expect(
      revertDiffCardHunk({ client, worktreeId: 'wt-1', nativeChatContext: null, file: card, hunkIndex: 0, cardScope: 's' })
    ).resolves.toMatchObject({ status: 'reverted' })
    // The agent inserted a line above the second hunk in the meantime.
    disk = disk.replace('x\nY', 'new\nx\nY')
    await expect(
      revertDiffCardHunk({ client, worktreeId: 'wt-1', nativeChatContext: null, file: card, hunkIndex: 1, cardScope: 's' })
    ).resolves.toMatchObject({ status: 'refused' })
  })

  it('refuses before any RPC when the card itself cannot be reverted', async () => {
    const { client, calls } = host({})
    const created = finalizeEditFile({ ...card, changeKind: 'added' })
    await expect(revert(client, created)).resolves.toEqual({
      status: 'refused',
      message:
        'This card is a whole file being written; what it replaced is not on the card. Revert it from the file explorer or git.'
    })
    expect(calls).toEqual([])
  })
})
