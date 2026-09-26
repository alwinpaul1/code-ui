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
  const readOnlyReason = args.truncated
    ? 'File too large for mobile preview'
    : args.tabIsDirty
      ? 'Desktop has unsaved changes. Showing disk content.'
      : args.desktopRefusal
        ? `The desktop could not read this tab (${args.desktopRefusal}). Showing the file on disk.`
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
