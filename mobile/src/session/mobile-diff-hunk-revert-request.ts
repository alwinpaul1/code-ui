// The host round trip behind "Revert this hunk". Resolves the card's path to a
// file inside this worktree, reads the file as it is NOW, plans the revert
// against that, and only then writes — through the same ownership capture the
// markdown editor and file creation use, so a write can never land on a host
// other than the one the worktree lives on.
//
// Nothing here throws at the card. Every failure comes back as a plain outcome
// with a message the card can show as-is, and the message names the step and
// the file so the one line left behind says where to look.

import type { NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import type { RuntimeNativeChatFileContext } from '../../../src/shared/runtime-file-contracts'
import { captureMobileFileMutationOwnership } from '../files/mobile-file-mutation-ownership'
import { hunkRevertPrecheck, numberedHunkPosition, planHunkRevert } from './mobile-diff-hunk-revert'
import {
  cardRevertKey,
  cardRevertShiftBefore,
  recordCardRevertShift
} from './mobile-diff-hunk-revert-marks'
import {
  hunkRevertFileRead,
  hunkRevertFileWrite,
  hunkRevertPathResolve,
  type MobileDiffHunkRevertRpcSender
} from './mobile-diff-hunk-revert-operations'

const REVERT_RPC_TIMEOUT_MS = 15_000

export type HunkRevertOutcome =
  /** The file was written with the hunk undone. */
  | { status: 'reverted'; removed: number; restored: number }
  /** The phone declined to write; nothing changed. The message says why. */
  | { status: 'refused'; message: string }
  /** The host declined, or could not be reached; nothing is known to have changed. */
  | { status: 'failed'; message: string }

/** The shape the chat view threads down to the diff card. `cardScope` says
 *  which card asked — the message and the place in it — so a later card for
 *  the same edit is not mistaken for this one. */
export type MobileNativeChatRevertHunk = (
  file: NativeChatEditFile,
  hunkIndex: number,
  cardScope: string
) => Promise<HunkRevertOutcome>

const OUTSIDE_WORKSPACE_MESSAGE =
  'This file is outside the workspace; open it on the desktop to revert by hand.'
const MISSING_FILE_MESSAGE = 'This file no longer exists in the workspace.'
const CLIPPED_READ_MESSAGE =
  'This file is too large to rewrite from the phone; open the diff to revert by hand.'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function refused(message: string): HunkRevertOutcome {
  return { status: 'refused', message }
}

function failed(step: string, subject: string, error: unknown): HunkRevertOutcome {
  return { status: 'failed', message: `Couldn't ${step} ${subject}: ${describe(error)}` }
}

export async function revertDiffCardHunk(input: {
  client: MobileDiffHunkRevertRpcSender
  worktreeId: string
  /** The chat tab and session the card came from — the provenance the host
   *  accepts for a path an agent printed, as the tap-to-open flow sends it. */
  nativeChatContext: RuntimeNativeChatFileContext | null
  file: NativeChatEditFile
  hunkIndex: number
  /** The card's identity beyond its content: message id and ordinal. */
  cardScope: string
}): Promise<HunkRevertOutcome> {
  const { client, worktreeId, nativeChatContext, file, hunkIndex, cardScope } = input
  const precheck = hunkRevertPrecheck(file, hunkIndex)
  if (!precheck.ok) {
    return refused(precheck.message)
  }
  const worktree = `id:${worktreeId}`

  // 1. Where the card's path lives. No cwd and no terminal: a chat path is
  //    worktree-relative or absolute, and a terminal's cwd would misplace it.
  let relativePath: string
  try {
    const reply = await hunkRevertPathResolve.request(
      client,
      {
        worktree,
        pathText: file.path,
        ...(nativeChatContext ? { nativeChatContext } : {})
      },
      { timeoutMs: REVERT_RPC_TIMEOUT_MS }
    )
    const resolved = hunkRevertPathResolve.interpret(reply)
    if (!resolved.exists || resolved.isDirectory) {
      return refused(MISSING_FILE_MESSAGE)
    }
    const target = resolved.openTarget
    if (
      target?.kind !== 'worktree-file' ||
      !target.relativePath ||
      (resolved.worktree !== undefined && resolved.worktree !== '' && resolved.worktree !== worktreeId)
    ) {
      return refused(OUTSIDE_WORKSPACE_MESSAGE)
    }
    relativePath = target.relativePath
  } catch (error) {
    return failed('resolve', file.path, error)
  }

  // 2. The file as it is now — never the card's snapshot.
  let content: string
  try {
    const reply = await hunkRevertFileRead.request(
      client,
      { worktree, relativePath },
      { timeoutMs: REVERT_RPC_TIMEOUT_MS }
    )
    const text = hunkRevertFileRead.interpret(reply)
    if (text.truncated) {
      return refused(CLIPPED_READ_MESSAGE)
    }
    content = text.content
  } catch (error) {
    return failed('read', relativePath, error)
  }

  // 3. The plan, which refuses on drift, ambiguity, or a file it cannot anchor
  //    in. A numbered hunk is looked for where the card says plus whatever the
  //    phone's own earlier reverts on this card moved it by.
  const cardKey = cardRevertKey(cardScope, file)
  const position = numberedHunkPosition(file, precheck.hunk)
  const shift = position === null ? 0 : cardRevertShiftBefore(cardKey, position)
  const plan = planHunkRevert(file, hunkIndex, content, shift)
  if (!plan.ok) {
    return refused(plan.message)
  }

  // 4. The write, bound to the host the worktree is on.
  try {
    const ownership = await captureMobileFileMutationOwnership(client, worktree)
    const reply = await hunkRevertFileWrite.request(
      client,
      { worktree, relativePath, content: plan.content, ...ownership },
      { timeoutMs: REVERT_RPC_TIMEOUT_MS }
    )
    hunkRevertFileWrite.interpret(reply)
  } catch (error) {
    return failed('write', relativePath, error)
  }
  if (position !== null) {
    recordCardRevertShift(cardKey, position, plan.restored - plan.removed)
  }
  return { status: 'reverted', removed: plan.removed, restored: plan.restored }
}
