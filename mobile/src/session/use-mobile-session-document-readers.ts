import { useCallback, useEffect } from 'react'
import type { RpcFailure } from '../transport/types'
import { resolveMobileFileTabDoc } from '../files/mobile-file-tab-doc'
import { classifyMobileArtifact } from './mobile-artifact-kind'
import {
  prefetchOutsideWorktreeFileTabs,
  abandonFileTabRead,
  beginFileTabRead,
  prefetchedFileTabDoc,
  rememberFileTabDoc
} from '../files/mobile-file-tab-prefetch'
import { filePreviewTextRead } from '../files/mobile-file-preview-operations'
import { markdownTabRead } from './mobile-session-read-operations'
import {
  buildMarkdownDiskFallbackDoc,
  refusalBarsDiskRead,
  shouldReadMarkdownFromDiskAfterReadTabFailure
} from './mobile-markdown-disk-fallback'
import type { MobileSessionTab } from './mobile-session-route-types'
import type { MobileSessionTabApplicationModel } from './use-mobile-session-tab-application'

export function useMobileSessionDocumentReaders(scope: MobileSessionTabApplicationModel) {
  const { worktreeId, client, setMarkdownDocs, setFileDocs, terminalsRef, activeSessionTabId, sessionTabs } =
    scope
  // The worktree's terminal handles, the active tab's first: a file outside
  // the worktree is read through a grant the host mints for the terminal
  // that printed its path.
  const terminalHandlesFor = useCallback(() => {
    const terminals = terminalsRef.current.filter((terminal) => terminal.connected !== false)
    const active = terminals.find((terminal) => terminal.tabId === activeSessionTabId)
    return [
      ...(active ? [active.handle] : []),
      ...terminals.filter((terminal) => terminal !== active).map((terminal) => terminal.handle)
    ]
  }, [activeSessionTabId, terminalsRef])
  // Read a desktop-opened outside-the-worktree file as soon as its tab
  // appears, while a terminal still shows its path (see
  // mobile-file-tab-prefetch.ts); the tab's own read serves it later.
  useEffect(() => {
    if (!client) {
      return
    }
    prefetchOutsideWorktreeFileTabs(client, worktreeId, sessionTabs, terminalHandlesFor())
  }, [client, sessionTabs, terminalHandlesFor, worktreeId])
  const readMarkdownTab = useCallback(
    async (tab: Extract<MobileSessionTab, { type: 'markdown' }>) => {
      if (!client) {
        return
      }
      // Why: the object identity is this read's claim on the slot. A close (or a newer read) replaces
      // or removes it, and a late reply then finds a different value and leaves the map alone.
      const loading = { status: 'loading' } as const
      setMarkdownDocs((prev) => new Map(prev).set(tab.id, loading))
      try {
        const response = await markdownTabRead.request(client, {
          worktree: `id:${worktreeId}`,
          tabId: tab.id
        })
        if (response.ok) {
          const result = markdownTabRead.interpret(response)
          setMarkdownDocs((prev) =>
            prev.get(tab.id) === loading
              ? new Map(prev).set(tab.id, {
                  status: 'ready',
                  content: result.content,
                  localContent: result.content,
                  baseVersion: result.version,
                  isDirty: false,
                  editable: result.editable === true,
                  stale: result.isDirty,
                  readOnlyReason: result.readOnlyReason
                })
              : prev
          )
          return
        }
        // Any refusal falls back to the file on disk, read-only, and says
        // why: a headless host fails markdown.readTab (renderer_unavailable),
        // and a desktop that has the window can still refuse the tab (a
        // picked file's tab said "Couldn't load markdown" on every Retry,
        // 2026-09-26, and the phone had dropped the desktop's reason).
        const refused = response as RpcFailure
        const headless = shouldReadMarkdownFromDiskAfterReadTabFailure(refused)
        const desktopReason = refused.error.message || refused.error.code
        if (refusalBarsDiskRead(refused.error)) {
          throw new Error(desktopReason)
        }
        let fallback: ReturnType<typeof filePreviewTextRead.interpret> | null = null
        try {
          fallback = filePreviewTextRead.interpret(
            await filePreviewTextRead.request(client, {
              worktree: `id:${worktreeId}`,
              relativePath: tab.relativePath
            })
          )
        } catch {
          fallback = null
        }
        if (!fallback?.accepted) {
          throw new Error(desktopReason)
        }
        const fileResult = fallback.value
        setMarkdownDocs((prev) =>
          prev.get(tab.id) === loading
            ? new Map(prev).set(
                tab.id,
                buildMarkdownDiskFallbackDoc({
                  content: fileResult.content,
                  truncated: fileResult.truncated,
                  tabIsDirty: tab.isDirty,
                  ...(headless ? {} : { desktopRefusal: desktopReason })
                })
              )
            : prev
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message : ''
        setMarkdownDocs((prev) =>
          prev.get(tab.id) === loading
            ? new Map(prev).set(tab.id, {
                status: 'error',
                message: reason ? `Couldn't load markdown (${reason})` : "Couldn't load markdown"
              })
            : prev
        )
      }
    },
    [client, worktreeId]
  )

  const readFileTab = useCallback(
    async (tab: Extract<MobileSessionTab, { type: 'file' }>) => {
      if (!client) {
        return
      }
      const prefetched =
        tab.diffSource === 'staged' || tab.diffSource === 'unstaged'
          ? null
          : prefetchedFileTabDoc(worktreeId, tab.relativePath)
      if (prefetched) {
        setFileDocs((prev) => new Map(prev).set(tab.id, prefetched))
        return
      }
      const loading = { status: 'loading' } as const
      // A diff is never cached, so it claims nothing.
      const read =
        tab.diffSource === 'staged' || tab.diffSource === 'unstaged'
          ? null
          : beginFileTabRead(worktreeId, tab.relativePath)
      setFileDocs((prev) => new Map(prev).set(tab.id, loading))
      try {
        const doc = await resolveMobileFileTabDoc(client, {
          worktreeId,
          relativePath: tab.relativePath,
          diffSource: tab.diffSource,
          terminalHandles: terminalHandlesFor()
        })
        if (read) {
          rememberFileTabDoc(read, doc)
        }
        // Closed tabs and newer reads release ownership of this reply.
        setFileDocs((prev) => (prev.get(tab.id) === loading ? new Map(prev).set(tab.id, doc) : prev))
      } catch (err) {
        if (read) {
          abandonFileTabRead(read)
        }
        const message = err instanceof Error ? err.message : ''
        const previewMessage =
          message === 'binary_file'
            ? 'Binary preview unavailable'
            : message === 'file_too_large'
              ? 'File too large for mobile preview'
              : message === 'outside_worktree'
                ? // The chat's chip wording for the same thing ("Image on
                  // Desktop"), asked for on 2026-09-19: the phone can read a
                  // file outside the workspace only while a terminal here
                  // still shows its path (the host vouches for the last 64 KB
                  // of a terminal's output, and a grant lives ten minutes).
                  `${classifyMobileArtifact(tab.relativePath) === 'image' ? 'Image' : 'File'} on Desktop. The phone can show it only while a terminal here still shows its path.`
                : `${tab.diffSource === 'staged' || tab.diffSource === 'unstaged' ? "Couldn't load diff preview" : "Couldn't load file preview"}${
                    // The desktop's own reason: without it every failure read
                    // the same and could not be told apart (2026-09-26).
                    message ? ` (${message})` : ''
                  }`
        setFileDocs((prev) =>
          prev.get(tab.id) === loading
            ? new Map(prev).set(tab.id, { status: 'error', message: previewMessage })
            : prev
        )
      }
    },
    [client, worktreeId, terminalHandlesFor]
  )
  return {
    readMarkdownTab,
    readFileTab
  }
}

export type MobileSessionDocumentReadersModel = MobileSessionTabApplicationModel &
  ReturnType<typeof useMobileSessionDocumentReaders>
