import { buildImageDataUri } from '../../../src/shared/image-data-uri'
import { classifyMobileArtifact } from '../session/mobile-artifact-kind'
import { buildMobileDiffLines, type MobileDiffLine } from '../session/mobile-diff-lines'
import { mobileDiffImageDataUri } from './mobile-diff-image-preview'
import {
  fileTabDiffRead,
  fileTabImageRead,
  fileTabTextRead,
  type MobileFileTabDocRpcSender
} from './mobile-file-tab-doc-operations'
import {
  terminalArtifactImageRead,
  terminalArtifactPathResolve,
  terminalArtifactTextRead
} from './mobile-file-preview-operations'
import { resolveMobilePdfUri } from './mobile-pdf-cache'

// The ready doc a session file tab renders. Mirrors the ready arm of the route's
// FileDocState; kept in src so the loader stays testable without the route.
export type MobileFileTabDoc =
  | { status: 'ready'; kind: 'file'; content: string; truncated: boolean; byteLength: number }
  | { status: 'ready'; kind: 'diff'; lines: MobileDiffLine[]; truncated: boolean }
  | { status: 'ready'; kind: 'image'; dataUri: string }
  | { status: 'ready'; kind: 'pdf'; uri: string }
  | { status: 'ready'; kind: 'html'; content: string }
  | {
      status: 'ready'
      kind: 'markdown'
      content: string
      truncated: boolean
      byteLength: number
    }

export type MobileFileTabDocRequest = {
  worktreeId: string
  relativePath: string
  diffSource?: 'staged' | 'unstaged' | 'branch' | 'commit'
  /** The worktree's terminals, most likely first: a path outside the
   *  worktree is readable only through a grant the host mints for the
   *  terminal that printed it. */
  terminalHandles?: readonly string[]
}

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
 */
async function resolveOutsideWorktree(
  client: MobileFileTabDocRpcSender,
  worktree: string,
  absolutePath: string,
  terminalHandles: readonly string[]
): Promise<
  | { kind: 'grant'; worktree: string; grantId: string }
  | { kind: 'worktree'; worktree: string; relativePath: string }
> {
  const attempts: (string | null)[] = [...terminalHandles, null]
  for (const terminal of attempts) {
    const reply = await terminalArtifactPathResolve.request(client, {
      worktree,
      pathText: absolutePath,
      crossWorkspace: true,
      ...(terminal ? { terminal } : {})
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

// Throws 'binary_file'/'file_too_large'/'outside_worktree'/the RPC error
// message; callers map those to error docs.
export async function resolveMobileFileTabDoc(
  client: MobileFileTabDocRpcSender,
  request: MobileFileTabDocRequest
): Promise<MobileFileTabDoc> {
  let worktree = `id:${request.worktreeId}`
  let { relativePath } = request
  const outside =
    request.diffSource === 'staged' ||
    request.diffSource === 'unstaged' ||
    !isAbsoluteTabPath(relativePath)
      ? null
      : await resolveOutsideWorktree(client, worktree, relativePath, request.terminalHandles ?? [])
  if (outside?.kind === 'worktree') {
    worktree = outside.worktree
    relativePath = outside.relativePath
  }
  if (outside?.kind === 'grant') {
    return readTerminalArtifactDoc(client, outside.worktree, relativePath, outside.grantId)
  }
  if (request.diffSource === 'staged' || request.diffSource === 'unstaged') {
    const reply = await fileTabDiffRead.request(client, {
      worktree,
      filePath: relativePath,
      staged: request.diffSource === 'staged'
    })
    const result = fileTabDiffRead.interpret(reply)
    if (result.kind !== 'text') {
      // Render image diffs (add/modify/delete) from the base64 the host already
      // sends; only non-previewable binaries stay unavailable.
      const dataUri = mobileDiffImageDataUri(result)
      if (!dataUri) {
        throw new Error('binary_file')
      }
      return { status: 'ready', kind: 'image', dataUri }
    }
    const diff = buildMobileDiffLines(result.originalContent, result.modifiedContent)
    return { status: 'ready', kind: 'diff', lines: diff.lines, truncated: diff.truncated }
  }

  const artifactKind = classifyMobileArtifact(relativePath)
  if (artifactKind === 'image') {
    const preview = await fileTabImageRead.request(client, { worktree, relativePath })
    const result = fileTabImageRead.interpret(preview)
    const dataUri = result.isImage ? buildImageDataUri(result.mimeType, result.content) : null
    if (!dataUri) {
      throw new Error('binary_file')
    }
    return { status: 'ready', kind: 'image', dataUri }
  }

  if (artifactKind === 'pdf') {
    // Chunked: the preview read is capped on the host and refuses ordinary PDFs.
    const { uri } = await resolveMobilePdfUri(client, worktree, relativePath)
    return { status: 'ready', kind: 'pdf', uri }
  }

  const reply = await fileTabTextRead.request(client, { worktree, relativePath })
  const result = fileTabTextRead.interpret(reply)
  if (artifactKind === 'html') {
    return { status: 'ready', kind: 'html', content: result.content }
  }
  if (artifactKind === 'markdown') {
    // Why truncation travels with it: markdown renders as a document, which
    // hides where the text stops. A cut-off CLAUDE.md would otherwise read as
    // the whole file.
    return {
      status: 'ready',
      kind: 'markdown',
      content: result.content,
      truncated: result.truncated,
      byteLength: result.byteLength
    }
  }
  return {
    status: 'ready',
    kind: 'file',
    content: result.content,
    truncated: result.truncated,
    byteLength: result.byteLength
  }
}

async function readTerminalArtifactDoc(
  client: MobileFileTabDocRpcSender,
  worktree: string,
  absolutePath: string,
  grantId: string
): Promise<MobileFileTabDoc> {
  const artifactKind = classifyMobileArtifact(absolutePath)
  const params = { worktree, absolutePath, grantId }
  if (artifactKind === 'image') {
    const outcome = terminalArtifactImageRead.interpret(
      await terminalArtifactImageRead.request(client, params)
    )
    const dataUri =
      outcome.accepted && outcome.value.isImage === true && typeof outcome.value.mimeType === 'string'
        ? buildImageDataUri(outcome.value.mimeType, outcome.value.content ?? '')
        : null
    if (!dataUri) {
      throw new Error('binary_file')
    }
    return { status: 'ready', kind: 'image', dataUri }
  }
  if (artifactKind === 'pdf') {
    // The chunked worktree read has no grant form; a PDF outside the
    // worktree stays out of reach on the phone.
    throw new Error('outside_worktree')
  }
  const outcome = terminalArtifactTextRead.interpret(
    await terminalArtifactTextRead.request(client, params)
  )
  if (!outcome.accepted) {
    throw new Error('outside_worktree')
  }
  const result = outcome.value
  const doc = {
    content: result.content,
    truncated: result.truncated === true,
    byteLength: result.byteLength ?? result.content.length
  }
  if (artifactKind === 'html') {
    return { status: 'ready', kind: 'html', content: result.content }
  }
  if (artifactKind === 'markdown') {
    return { status: 'ready', kind: 'markdown', ...doc }
  }
  return { status: 'ready', kind: 'file', ...doc }
}
