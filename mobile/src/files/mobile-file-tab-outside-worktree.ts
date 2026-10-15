import type { RuntimeNativeChatFileContext } from '../../../src/shared/runtime-types'
import { terminalArtifactPathResolve } from './mobile-file-preview-operations'
import type { MobileFileTabDocRpcSender } from './mobile-file-tab-doc-operations'

/** An absolute path: a desktop-opened tab publishes one as `relativePath`
 *  when the file sits outside the worktree. */
export function isAbsoluteTabPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * A file the desktop opened from outside the worktree (an agent printed a
 * path under /tmp, the user clicked it) arrives as a tab whose `relativePath`
 * is absolute, and `files.readPreview` refuses that; the tab said "Couldn't
 * load file preview" (device, 2026-09-19). Such a path is a terminal
 * artifact: the host resolves it against the terminal that printed it and
 * mints a read grant, the same way a path tapped in the terminal is opened.
 * A file that turns out to live in another worktree is read through that
 * worktree. Nothing vouching for the path is `outside_worktree`.
 *
 * A terminal vouches only for a path under the temp dir (Orca's
 * localTerminalArtifactRoots), so a file the agent wrote about anywhere else,
 * a PDF on the Desktop say, needs the session's own transcript instead: each
 * of `nativeChatContexts` is asked after the terminals (2026-10-15, a Desktop
 * PDF tab said "File on Desktop" over a session that had named it).
 *
 * Its own module so the tab's save (mobile-file-save.ts) resolves a path the
 * same way the tab's read does, without taking the PDF cache's file system
 * along with it.
 */
export async function resolveOutsideWorktree(
  client: MobileFileTabDocRpcSender,
  worktree: string,
  absolutePath: string,
  terminalHandles: readonly string[],
  nativeChatContexts: readonly RuntimeNativeChatFileContext[] = []
): Promise<
  | { kind: 'grant'; worktree: string; grantId: string }
  | { kind: 'worktree'; worktree: string; relativePath: string }
> {
  const attempts: ({ terminal: string } | { nativeChatContext: RuntimeNativeChatFileContext } | null)[] = [
    ...terminalHandles.map((terminal) => ({ terminal })),
    ...nativeChatContexts.map((nativeChatContext) => ({ nativeChatContext })),
    null
  ]
  for (const evidence of attempts) {
    const reply = await terminalArtifactPathResolve.request(client, {
      worktree,
      pathText: absolutePath,
      crossWorkspace: true,
      ...evidence
    })
    const outcome = terminalArtifactPathResolve.interpret(reply)
    if (!outcome.accepted) {
      continue
    }
    const resolved = outcome.value as {
      worktree?: string
      relativePath?: string | null
      openTarget?: { kind?: string; absolutePath?: string; grantId?: string; relativePath?: string }
    }
    const target = resolved.openTarget
    const resolvedWorktree = resolved.worktree ? `id:${resolved.worktree}` : worktree
    if (target?.kind === 'absolute-file' && target.grantId) {
      return { kind: 'grant', worktree: resolvedWorktree, grantId: target.grantId }
    }
    const relative =
      target?.kind === 'worktree-file' ? (target.relativePath ?? resolved.relativePath) : null
    if (typeof relative === 'string' && relative.length > 0) {
      return { kind: 'worktree', worktree: resolvedWorktree, relativePath: relative }
    }
  }
  throw new Error('outside_worktree')
}
