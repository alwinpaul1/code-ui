import { RpcIncompatibleReplyError } from '../transport/rpc-incompatible-reply-error'
import type { RpcResponse } from '../transport/types'

/**
 * Why a tapped path opened nothing, as far as the phone can tell.
 *
 * Every arm is something a reply (or the lack of one) actually said. The chat used to report all
 * of them as a bare "Couldn't open X" (2026-09-25): a file in a subfolder, a folder, a refused
 * request and a dead link all read the same, so the user could not tell a typo from an outage.
 */
export type FileTapOpenFailure =
  /** The desktop looked inside this workspace and found nothing at that path. */
  | { kind: 'not-found' }
  /** The same, in the sibling workspace an absolute path points into. */
  | { kind: 'not-found-elsewhere' }
  /** The desktop placed the path nowhere and did not look: `~` on an SSH workspace, for one. */
  | { kind: 'unreachable' }
  /** A bare name the workspace lookup found nowhere. `partial`: its answer did not cover the
   *  whole workspace, so the file may still exist. */
  | { kind: 'no-file-named'; name: string; partial: boolean }
  | { kind: 'folder' }
  /** Outside the workspace, and not a file the desktop let this chat open. */
  | { kind: 'outside-workspace' }
  | { kind: 'refused'; message: string | null }
  /** `files.open` answered `opened: false`; `fileKind` is the kind it named. */
  | { kind: 'not-openable'; fileKind: string | null }
  | { kind: 'unreadable-reply' }
  /** The request itself failed: a timeout, a dropped link, a closed client. */
  | { kind: 'no-answer' }
  /** Something in the phone's own flow threw. Named as it is, not dressed as the desktop's fault. */
  | { kind: 'unexpected'; message: string }

export function refusalFailure(response: RpcResponse): FileTapOpenFailure {
  const message = response.ok ? '' : response.error.message.trim()
  return { kind: 'refused', message: message || null }
}

/**
 * A throw that was not a request's own rejection (those are caught where they are sent, as
 * 'no-answer'): a reply the operation's reader could not read, or a fault on the phone.
 */
export function thrownFailure(error: unknown): FileTapOpenFailure {
  if (error instanceof RpcIncompatibleReplyError) {
    return { kind: 'unreadable-reply' }
  }
  return { kind: 'unexpected', message: error instanceof Error ? error.message : String(error) }
}

/**
 * The line a failed chat tap leaves in the composer banner.
 *
 * `connected` is the client's state when the failure lands. It is what separates "not connected"
 * from "did not answer": a send waits for the link and gives up with its own error, and a timeout
 * on a live link is the desktop's silence. Unknown (null) reads as connected, the milder claim.
 */
export function describeFileTapOpenFailure(
  pathText: string,
  failure: FileTapOpenFailure,
  context: { worktreeName?: string; connected: boolean | null }
): string {
  const workspace = context.worktreeName?.trim() || 'this workspace'
  return `Couldn't open ${pathText}: ${failureReason(failure, workspace, context.connected)}`
}

function failureReason(
  failure: FileTapOpenFailure,
  workspace: string,
  connected: boolean | null
): string {
  switch (failure.kind) {
    case 'not-found':
      return `no such file in ${workspace}`
    case 'not-found-elsewhere':
      return 'no such file in the workspace it points into'
    case 'unreachable':
      return `the desktop can't reach that path from ${workspace}`
    case 'no-file-named':
      return failure.partial
        ? `no file named ${failure.name} in ${workspace} (the desktop searched only part of it)`
        : `no file named ${failure.name} in ${workspace}`
    case 'folder':
      return 'it is a folder'
    case 'outside-workspace':
      return `it is outside ${workspace}`
    case 'refused':
      return failure.message
        ? `the desktop refused it (${failure.message})`
        : 'the desktop refused it'
    case 'not-openable':
      return failure.fileKind === 'binary'
        ? "binary files don't open on the phone"
        : 'the desktop would not open it on the phone'
    case 'unreadable-reply':
      return "the desktop's reply could not be read"
    case 'no-answer':
      return connected === false ? 'not connected to your desktop' : 'your desktop did not answer'
    case 'unexpected':
      return failure.message || 'something went wrong on the phone'
    default: {
      const unhandled: never = failure
      return String(unhandled)
    }
  }
}
