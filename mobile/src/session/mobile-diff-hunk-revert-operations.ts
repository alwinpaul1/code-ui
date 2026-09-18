import { z } from 'zod'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'
import { rpcUncheckedPayloadReader } from '../transport/rpc-reader-payload'

/**
 * The three host calls behind "Revert this hunk" on a landed-edit card.
 *
 * All three throw the host's own message on refusal: a jail, a missing file or a
 * declined write is exactly the text the card should show, and the request
 * module turns each throw into a plain outcome. The two reads are decoded, not
 * re-typed — a `files.read` whose `content` is not a string must read as
 * incompatible, because the planner would otherwise anchor on nothing and the
 * write would land an empty file.
 */

/** The part of `RuntimeTerminalPathResolution` a revert needs: whether the path
 *  is a file inside this worktree, and what it is called there. */
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

export type HunkRevertPathResolution = z.output<typeof PathResolution>

export const hunkRevertPathResolve = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.hunk-revert-path',
    method: 'files.resolveTerminalPath',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('hunk-revert-path', PathResolution)
  })
)

/** `RuntimeFileReadResult`, down to the two fields that decide a write. Both
 *  are required: a read that does not say whether it was clipped is not one
 *  to write back. */
const FileText = z.object({
  content: z.string(),
  truncated: z.boolean()
})

export type HunkRevertFileText = z.output<typeof FileText>

export const hunkRevertFileRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.hunk-revert-read',
    method: 'files.read',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('hunk-revert-text', FileText)
  })
)

/** The write. Its reply body is never read: a success is the whole answer. */
export const hunkRevertFileWrite = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.hunk-revert-write',
    method: 'files.write',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcUncheckedPayloadReader('hunk-revert-written')
  })
)

/** What a revert sends with, named from an operation so no module names the raw port. */
export type MobileDiffHunkRevertRpcSender = Parameters<typeof hunkRevertFileRead.request>[0]
