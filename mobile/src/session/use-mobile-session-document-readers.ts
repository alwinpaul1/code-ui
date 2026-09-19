import { useCallback, useEffect } from 'react'
import type { RpcFailure } from '../transport/types'
import { resolveMobileFileTabDoc } from '../files/mobile-file-tab-doc'
import { classifyMobileArtifact } from './mobile-artifact-kind'
import {
  prefetchOutsideWorktreeFileTabs,
  prefetchedFileTabDoc,
  rememberFileTabDoc
} from '../files/mobile-file-tab-prefetch'
import { filePreviewTextRead } from '../files/mobile-file-preview-operations'
import { markdownTabRead } from './mobile-session-read-operations'
import {
  buildMarkdownDiskFallbackDoc,
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
      setMarkdownDocs((prev) => new Map(prev).set(tab.id, { status: 'loading' }))
      try {
        const response = await markdownTabRead.request(client, {
          worktree: `id:${worktreeId}`,
          tabId: tab.id
        })
        if (response.ok) {
          const result = markdownTabRead.interpret(response)
          setMarkdownDocs((prev) =>
            new Map(prev).set(tab.id, {
              status: 'ready',
              content: result.content,
              localContent: result.content,
              baseVersion: result.version,
              isDirty: false,
              editable: result.editable === true,
              stale: result.isDirty,
              readOnlyReason: result.readOnlyReason
            })
          )
          return
        }
        if (!shouldReadMarkdownFromDiskAfterReadTabFailure(response as RpcFailure)) {
          throw new Error((response as RpcFailure).error.message)
        }
        // Why: a headless host fails markdown.readTab (renderer_unavailable); fall back to the on-disk file for read-only render.
        const fallback = filePreviewTextRead.interpret(
          await filePreviewTextRead.request(client, {
            worktree: `id:${worktreeId}`,
            relativePath: tab.relativePath
          })
        )
        if (!fallback.accepted) {
          throw new Error('Unable to read markdown')
        }
        const fileResult = fallback.value
        setMarkdownDocs((prev) =>
          new Map(prev).set(
            tab.id,
            buildMarkdownDiskFallbackDoc({
              content: fileResult.content,
              truncated: fileResult.truncated,
              tabIsDirty: tab.isDirty
            })
          )
        )
      } catch {
        setMarkdownDocs((prev) =>
          new Map(prev).set(tab.id, {
            status: 'error',
            message: "Couldn't load markdown"
          })
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
      setFileDocs((prev) => new Map(prev).set(tab.id, { status: 'loading' }))
      try {
        const doc = await resolveMobileFileTabDoc(client, {
          worktreeId,
          relativePath: tab.relativePath,
          diffSource: tab.diffSource,
          terminalHandles: terminalHandlesFor()
        })
        if (tab.diffSource !== 'staged' && tab.diffSource !== 'unstaged') {
          rememberFileTabDoc(worktreeId, tab.relativePath, doc)
        }
        setFileDocs((prev) => new Map(prev).set(tab.id, doc))
      } catch (err) {
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
                : tab.diffSource === 'staged' || tab.diffSource === 'unstaged'
                ? "Couldn't load diff preview"
                : "Couldn't load file preview"
        setFileDocs((prev) =>
          new Map(prev).set(tab.id, {
            status: 'error',
            message: previewMessage
          })
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
