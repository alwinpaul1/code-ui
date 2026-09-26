import type { RpcFailure } from '../transport/types'

const RENDERER_UNAVAILABLE = 'renderer_unavailable'

export function shouldReadMarkdownFromDiskAfterReadTabFailure(response: RpcFailure): boolean {
  return (
    response.error.code === RENDERER_UNAVAILABLE ||
    (response.error.code === 'runtime_error' && response.error.message === RENDERER_UNAVAILABLE)
  )
}

// `truncated` is optional because the preview reader salvages it: an absent flag reads as not
// truncated here, which is the branch main took for a reply that omitted it.
export function buildMarkdownDiskFallbackDoc(args: {
  content: string
  truncated: boolean | undefined
  tabIsDirty: boolean
  /** Why the desktop would not read its tab, when it has a window to ask. */
  desktopRefusal?: string
}) {
  // Every reason that applies, most pressing first: unsaved changes on the
  // desktop mean the copy shown is old; a cut-short copy is not all of it; and
  // the desktop's refusal says why Refresh will not bring its copy back. One
  // of them alone dropped the others (second review of the file-open fix).
  const showing = args.truncated ? 'Showing the start of the file on disk, too large to show in full' : 'Showing the file on disk'
  const refused = args.desktopRefusal ? ` (${args.desktopRefusal})` : ''
  const readOnlyReason = args.tabIsDirty
    ? args.truncated || args.desktopRefusal
      ? `Desktop has unsaved changes. ${showing}${refused}.`
      : 'Desktop has unsaved changes. Showing disk content.'
    : args.desktopRefusal
      ? `The desktop could not read this tab${refused}. ${showing}.`
      : args.truncated
        ? 'File too large for mobile preview'
        : 'Editing needs Orca desktop running.'
  return {
    status: 'ready' as const,
    content: args.content,
    localContent: args.content,
    baseVersion: '',
    isDirty: false,
    editable: false,
    stale: args.tabIsDirty,
    readOnlyReason
  }
}

/** Why the desktop keeps its own read-only tabs read-only, in words
 *  (getReadOnlyReason in Orca's mobile markdown bridge). */
const DESKTOP_READ_ONLY_REASONS: Readonly<Record<string, string>> = {
  unsupported_preview: 'Read only: a preview tab on the desktop',
  unsupported_untitled: 'Read only: an unsaved new file on the desktop',
  file_too_large: 'Read only: too large to edit on the phone'
}

/** The status line a read-only markdown tab shows: the reason itself, not
 *  "Read only" for every reason. The phone's own reasons are sentences; the
 *  desktop's are codes, named in words, or shown as they are when unknown
 *  (review of f9e2faf4, 2026-09-26: a tab showing its disk copy said only
 *  "Read only", even when the desktop held unsaved changes). */
export function markdownReadOnlyStatus(reason: string): string {
  // Own keys only: `__proto__` on a plain object is not a reason's words.
  if (Object.hasOwn(DESKTOP_READ_ONLY_REASONS, reason)) {
    return DESKTOP_READ_ONLY_REASONS[reason]!
  }
  return /^[a-z_]+$/.test(reason) ? `Read only (${reason})` : reason
}

/** A refused save's status line: the desktop's code in words, as a read's is. */
export function markdownSaveErrorStatus(error: string): string {
  if (Object.hasOwn(DESKTOP_READ_ONLY_REASONS, error)) {
    return `Couldn't save. ${DESKTOP_READ_ONLY_REASONS[error]!}`
  }
  if (error === 'conflict') {
    return "Couldn't save: the file changed on the desktop"
  }
  return /^[a-z_]+$/.test(error) ? `Couldn't save (${error})` : error
}

/** Refusals whose disk copy must not be drawn: the desktop read the file's
 *  bytes and found them not text, and files.read checks only the name, so
 *  it would hand back those bytes as if they were (review of f9e2faf4). */
export function refusalBarsDiskRead(refusal: { code: string; message: string }): boolean {
  // As the preview's own check reads it (mobile-file-preview-response.ts):
  // in either field, bare or wrapped.
  return refusal.code.includes('binary_file') || refusal.message.includes('binary_file')
}
