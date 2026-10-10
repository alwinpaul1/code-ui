import { MEDIA_FILE_MIME_TYPES } from '../../../src/shared/media-file-extensions'

export type MobileFileMedia = {
  worktreeId: string
  relativePath: string
  mimeType: string
}

export function mobileFileMedia(worktreeId: string, relativePath?: string): MobileFileMedia | null {
  const mimeType = relativePath ? mobileFileMediaMime(relativePath) : null
  return relativePath && mimeType ? { worktreeId, relativePath, mimeType } : null
}

/** The media a preview request names, if any: a worktree path by id and path, or by a worktree source.
 *  A terminal artifact is never media here (its bytes arrive through a grant, not the chunked read). */
export function mobileFileMediaOfRequest(
  source: string | { source: 'worktree'; worktreeId: string; relativePath: string } | { source: 'terminalArtifact' },
  relativePath?: string
): MobileFileMedia | null {
  if (typeof source === 'string') {
    return mobileFileMedia(source, relativePath)
  }
  return source.source === 'worktree' ? mobileFileMedia(source.worktreeId, source.relativePath) : null
}

export function mobileFileMediaMime(path: string): string | null {
  const name = path.split(/[/\\]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (MEDIA_FILE_MIME_TYPES[name.slice(dot).toLowerCase()] ?? null) : null
}
