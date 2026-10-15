import type { RuntimeNativeChatFileContext } from '../../../src/shared/runtime-types'
import { terminalArtifactPathResolve } from './mobile-file-preview-operations'
import type { MobileFileTabDocRpcSender } from './mobile-file-tab-doc-operations'

/** An absolute path: a desktop-opened tab publishes one as `relativePath`
 *  when the file sits outside the worktree. */
export function isAbsoluteTabPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * `~/rest` for a path under `home`, the way an agent usually writes a path in
 * the user's home. Null for a path outside it, or for the home itself.
 */
export function homeRelativeSpelling(absolutePath: string, home: string): string | null {
  const root = home.replace(/[\\/]+$/, '')
  if (!root || !absolutePath.startsWith(root)) {
    return null
  }
  const separator = absolutePath[root.length]
  const rest = absolutePath.slice(root.length + 1)
  return (separator === '/' || separator === '\\') && rest ? `~${separator}${rest}` : null
}

type OutsideWorktreeTarget =
  | { kind: 'grant'; worktree: string; grantId: string }
  | { kind: 'worktree'; worktree: string; relativePath: string }

type Evidence = { terminal: string } | { nativeChatContext: RuntimeNativeChatFileContext } | null

type ResolvedPath = {
  worktree?: string
  relativePath?: string | null
  absolutePath?: string | null
  exists?: boolean
  openTarget?: { kind?: string; absolutePath?: string; grantId?: string; relativePath?: string }
}

async function askHost(
  client: MobileFileTabDocRpcSender,
  worktree: string,
  pathText: string,
  evidence: Evidence
): Promise<ResolvedPath | null> {
  const reply = await terminalArtifactPathResolve.request(client, {
    worktree,
    pathText,
    crossWorkspace: true,
    ...evidence
  })
  const outcome = terminalArtifactPathResolve.interpret(reply)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a loose object the schema already accepted; every member read here is optional and checked.
  return outcome.accepted ? (outcome.value as ResolvedPath) : null
}

function targetOf(resolved: ResolvedPath, worktree: string): OutsideWorktreeTarget | null {
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
  return null
}

function evidenceLabel(evidence: Evidence): string {
  if (!evidence) {
    return 'no evidence'
  }
  return 'terminal' in evidence
    ? `terminal ${evidence.terminal}`
    : `session ${evidence.nativeChatContext.sessionId}`
}

function answerLabel(resolved: ResolvedPath | null): string {
  if (!resolved) {
    return 'refused'
  }
  return resolved.openTarget?.kind ?? `exists:${String(resolved.exists ?? 'unknown')}`
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
 * Orca matches the transcript against the request's `pathText` word for word
 * (and against the path that expands to), so the path has to be asked in the
 * spelling the session wrote. Claude writes a file in the user's home as
 * `~/Downloads/…`, never the absolute path, so a session that named the PDF
 * ten times still vouched for nothing (device, 0.9.152). When the absolute
 * spelling finds nothing, the host is asked where `~/` lands, and each session
 * is asked again in the `~/` spelling. Only a grant for the tab's own path is
 * taken: the read that follows names that path, and Orca binds the grant to it.
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
): Promise<OutsideWorktreeTarget> {
  const answers: string[] = []
  const evidence: Evidence[] = [
    ...terminalHandles.map((terminal) => ({ terminal })),
    ...nativeChatContexts.map((nativeChatContext) => ({ nativeChatContext })),
    null
  ]
  for (const attempt of evidence) {
    const resolved = await askHost(client, worktree, absolutePath, attempt)
    answers.push(`${evidenceLabel(attempt)}: ${answerLabel(resolved)}`)
    const target = resolved ? targetOf(resolved, worktree) : null
    if (target) {
      return target
    }
  }

  if (nativeChatContexts.length > 0) {
    const home = (await askHost(client, worktree, '~/', null))?.absolutePath
    const spelling = typeof home === 'string' ? homeRelativeSpelling(absolutePath, home) : null
    answers.push(`~/ lands at ${home ?? 'nothing'}`)
    if (spelling) {
      for (const nativeChatContext of nativeChatContexts) {
        const attempt = { nativeChatContext }
        const resolved = await askHost(client, worktree, spelling, attempt)
        answers.push(`${evidenceLabel(attempt)} as ${spelling}: ${answerLabel(resolved)}`)
        const target = resolved ? targetOf(resolved, worktree) : null
        if (target?.kind === 'grant' && resolved?.openTarget?.absolutePath === absolutePath) {
          return target
        }
      }
    }
  }

  // The one line a refused tab leaves behind: who was asked, and what the host said.
  console.warn('[file-tab] nothing on the desktop vouched for a path outside the worktree', {
    path: absolutePath,
    answers
  })
  throw new Error('outside_worktree')
}
