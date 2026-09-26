// The host round trip behind a created file's read-back count: resolve the
// Write's path to a file inside this worktree, then read it with `files.read`.
// Both are on the mobile allowlist and neither changes anything on the host.
//
// The resolve sends no chat provenance, so a path outside the worktree comes
// back as nothing rather than as a read grant the host would mint for it: a
// count is not worth a grant. The host caps the read at 512 KiB and says when
// it did, which the judge refuses.

import { z } from 'zod'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

const READ_RPC_TIMEOUT_MS = 15_000

/** Host answers that will not change on a new connection. */
const SETTLED_READ_ERRORS = new Set(['binary_file', 'file_too_large', 'invalid_relative_path'])

const PathResolution = z.object({
  worktree: z.string().optional(),
  exists: z.boolean(),
  isDirectory: z.boolean(),
  openTarget: z
    .object({
      kind: z.string(),
      relativePath: z.string().optional()
    })
    .optional()
})

export const createdFilePathResolve = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.created-file-path',
    method: 'files.resolveTerminalPath',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('created-file-path', PathResolution)
  })
)

const FileText = z.object({
  content: z.string(),
  truncated: z.boolean()
})

export const createdFileRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.created-file-read',
    method: 'files.read',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('created-file-text', FileText)
  })
)

/** What a created-file read sends with, named from an operation so no module
 *  names the raw port. */
export type CreatedFileReadSender = Parameters<typeof createdFileRead.request>[0]

export type CreatedFileReadOutcome =
  | { kind: 'read'; content: string; truncated: boolean }
  /** The host answered, and asking again will not change the answer. */
  | { kind: 'refused'; reason: string }
  /** The host could not be reached, or answered with an error that may pass. */
  | { kind: 'failed'; reason: string }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Never held for the next connection: a direct client waits out a drop and
 *  sends a held request on the new link, where the host answers with the file
 *  as the calls made while the phone was away left it, before the replay that
 *  carries those calls has landed (third verification of the line count,
 *  2026-09-26: +125 on the 93-line create). Failing instead leaves the count
 *  to its once-per-connection retry, which waits for that transcript. */
const READ_OPTIONS = { timeoutMs: READ_RPC_TIMEOUT_MS, failWhenDisconnected: true } as const

export async function readCreatedFile(input: {
  client: CreatedFileReadSender
  worktreeId: string
  path: string
}): Promise<CreatedFileReadOutcome> {
  const { client, worktreeId, path } = input
  const worktree = `id:${worktreeId}`
  let relativePath: string
  try {
    const reply = await createdFilePathResolve.request(
      client,
      { worktree, pathText: path },
      READ_OPTIONS
    )
    const resolved = createdFilePathResolve.interpret(reply)
    if (!resolved.exists || resolved.isDirectory) {
      return { kind: 'refused', reason: 'no such file in the workspace' }
    }
    const target = resolved.openTarget
    if (
      target?.kind !== 'worktree-file' ||
      !target.relativePath ||
      (resolved.worktree !== undefined &&
        resolved.worktree !== '' &&
        resolved.worktree !== worktreeId)
    ) {
      return { kind: 'refused', reason: 'outside the workspace' }
    }
    relativePath = target.relativePath
  } catch (error) {
    return { kind: 'failed', reason: `couldn't resolve: ${describe(error)}` }
  }
  try {
    const reply = await createdFileRead.request(
      client,
      { worktree, relativePath },
      READ_OPTIONS
    )
    const text = createdFileRead.interpret(reply)
    return { kind: 'read', content: text.content, truncated: text.truncated }
  } catch (error) {
    const message = describe(error)
    return SETTLED_READ_ERRORS.has(message)
      ? { kind: 'refused', reason: message }
      : { kind: 'failed', reason: `couldn't read: ${message}` }
  }
}
