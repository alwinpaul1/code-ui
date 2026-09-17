import { classifyMobileArtifact } from '../session/mobile-artifact-kind'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { previewError, type MobileFilePreviewResult } from './mobile-file-preview-response'
import { resolveMobilePdfUri } from './mobile-pdf-cache'

/** What the loader knows about a source before it picks a read: an id and path, or a typed source. */
type MobileFilePreviewPdfCandidate =
  | string
  | { source: 'worktree'; worktreeId: string; relativePath: string }
  | { source: 'terminalArtifact' }

/**
 * CODE UI: the worktree PDF path, kept out of the preview loader so the loader stays the shape
 * upstream ships. The host's preview read is capped and refuses ordinary PDFs as
 * `file_too_large`, so a worktree PDF pages over in chunks instead; terminal artifacts keep the
 * grant-scoped preview path. Returns null when the source is not a worktree PDF, so the loader
 * carries on to its own read.
 */
export async function loadMobileWorktreePdfPreview(
  client: MobileFilePreviewRpcSender,
  worktreeIdOrSource: MobileFilePreviewPdfCandidate,
  relativePath?: string
): Promise<MobileFilePreviewResult | null> {
  const worktreePdf =
    typeof worktreeIdOrSource === 'string'
      ? { worktreeId: worktreeIdOrSource, relativePath: relativePath! }
      : worktreeIdOrSource.source === 'worktree'
        ? {
            worktreeId: worktreeIdOrSource.worktreeId,
            relativePath: worktreeIdOrSource.relativePath
          }
        : null
  if (!worktreePdf || classifyMobileArtifact(worktreePdf.relativePath) !== 'pdf') {
    return null
  }
  try {
    const { uri } = await resolveMobilePdfUri(
      client,
      `id:${worktreePdf.worktreeId}`,
      worktreePdf.relativePath
    )
    return { status: 'ready', kind: 'pdf', uri }
  } catch (error) {
    return previewError(error instanceof Error ? error.message : 'Unable to load preview')
  }
}
