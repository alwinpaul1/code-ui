// Images the DESKTOP pasted into a chat arrive in the transcript as
// `[Image: source: /var/folders/…/orca-paste-….png]` — a path on the Mac that
// the phone cannot load, so the bubble showed "🖼 /var/folders/…" as text.
// Resolve each path through the host (the same grant flow a tapped file uses)
// and read it as a preview, so the bubble gets a real thumbnail.
import { useEffect, useMemo, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { normalizeMobileFilePreviewResponse } from '../files/mobile-file-preview-response'
import { normalizeImageTranscriptMessages } from '../../../src/shared/native-chat-image-transcript-markers'
import { isImageRefBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/** Image-ref paths per message, in block order, for messages the phone has no
 *  local preview for (a message with local previews is a phone-side send). */
export function collectHostImagePaths(
  messages: readonly NativeChatMessage[],
  localPreviews: Record<string, string[]> | undefined
): Record<string, string[]> {
  const paths: Record<string, string[]> = {}
  for (const message of normalizeImageTranscriptMessages([...messages])) {
    if (message.role !== 'user' || localPreviews?.[message.id]?.length) {
      continue
    }
    const refs = message.blocks
      .filter(isImageRefBlock)
      .map((block) => block.path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
    if (refs.length > 0) {
      paths[message.id] = refs
    }
  }
  return paths
}

/** Local previews win; host thumbnails fill messages that have none. */
export function mergeImagePreviews(
  local: Record<string, string[]>,
  host: Record<string, string[]>
): Record<string, string[]> {
  if (Object.keys(host).length === 0) {
    return local
  }
  return { ...host, ...local }
}

const dataUriByPath = new Map<string, string>()
const failedPaths = new Map<string, number>()
const RETRY_MS = 5_000
const inFlight = new Map<string, Promise<string | null>>()

export function resetHostImagePreviewCacheForTests(): void {
  dataUriByPath.clear()
  failedPaths.clear()
  inFlight.clear()
}

export async function loadHostImage(args: {
  client: RpcClient
  hostId: string
  worktreeId: string
  nativeChatContext: { tabId: string; sessionId: string } | null
  /** The tab's terminal: a pasted path is echoed in its output, which is the
   *  one provenance the host accepts for a user-pasted file. */
  terminalHandle: string | null
  path: string
}): Promise<string | null> {
  const key = `${args.hostId}\0${args.path}`
  const cached = dataUriByPath.get(key)
  if (cached) {
    return cached
  }
  if ((failedPaths.get(key) ?? 0) > Date.now()) {
    return null
  }
  const pending = inFlight.get(key)
  if (pending) {
    return pending
  }
  const run = (async () => {
    try {
      const worktree = `id:${args.worktreeId}`
      const resolved = await args.client.sendRequest(
        'files.resolveTerminalPath',
        {
          worktree,
          pathText: args.path,
          // Same shape as a tapped chat path (mobile-file-tap-open): the paste
          // lives in the Mac temp dir, outside every workspace.
          crossWorkspace: true,
          ...(args.terminalHandle ? { terminal: args.terminalHandle } : {}),
          ...(args.nativeChatContext ? { nativeChatContext: args.nativeChatContext } : {})
        },
        { timeoutMs: 15_000 }
      )
      if (!resolved.ok) {
        failedPaths.set(key, Date.now() + RETRY_MS)
        return null
      }
      const resolution = (resolved as RpcSuccess).result as {
        worktree?: string
        openTarget?: {
          kind?: string
          absolutePath?: string
          grantId?: string
          relativePath?: string
        }
      }
      const target = resolution.openTarget
      const resolvedWorktree = resolution.worktree ? `id:${resolution.worktree}` : worktree
      const request =
        target?.kind === 'absolute-file' && target.absolutePath && target.grantId
          ? {
              method: 'files.readTerminalArtifactPreview',
              params: {
                worktree: resolvedWorktree,
                absolutePath: target.absolutePath,
                grantId: target.grantId
              }
            }
          : target?.kind === 'worktree-file' && target.relativePath
            ? {
                method: 'files.readPreview',
                params: { worktree: resolvedWorktree, relativePath: target.relativePath }
              }
            : null
      if (!request) {
        failedPaths.set(key, Date.now() + RETRY_MS)
        return null
      }
      const read = await args.client.sendRequest(request.method, request.params, {
        timeoutMs: 30_000
      })
      const preview = normalizeMobileFilePreviewResponse(args.path, read)
      if (preview.status !== 'ready' || preview.kind !== 'image') {
        failedPaths.set(key, Date.now() + RETRY_MS)
        return null
      }
      dataUriByPath.set(key, preview.dataUri)
      return preview.dataUri
    } catch {
      failedPaths.set(key, Date.now() + RETRY_MS)
      return null
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, run)
  return run
}

export function useHostImagePreviews(args: {
  client: RpcClient | null
  enabled: boolean
  hostId: string
  worktreeId: string
  nativeChatContext: { tabId: string; sessionId: string } | null
  terminalHandleRef: { current: string | null }
  messages: readonly NativeChatMessage[]
  localPreviews: Record<string, string[]>
}): Record<string, string[]> {
  const { client, enabled, hostId, worktreeId, nativeChatContext, messages, localPreviews } = args
  const { terminalHandleRef } = args
  const tabId = nativeChatContext?.tabId
  const sessionId = nativeChatContext?.sessionId
  const wanted = useMemo(
    () => (enabled ? collectHostImagePaths(messages, localPreviews) : {}),
    [enabled, localPreviews, messages]
  )
  const [loaded, setLoaded] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!client || !enabled) {
      return
    }
    let active = true
    const paths = [...new Set(Object.values(wanted).flat())]
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const read = async () => {
      attempts += 1
      await Promise.all(
        paths.map(async (path) => {
          const key = `${hostId}\0${path}`
          const uri = await loadHostImage({
            client,
            hostId,
            worktreeId,
            nativeChatContext: tabId && sessionId ? { tabId, sessionId } : null,
            terminalHandle: terminalHandleRef.current,
            path
          })
          if (active && uri) {
            setLoaded((current) => (current[key] === uri ? current : { ...current, [key]: uri }))
          }
        })
      )
      if (
        active &&
        attempts < 3 &&
        paths.some((path) => !dataUriByPath.has(`${hostId}\0${path}`))
      ) {
        timer = setTimeout(() => void read(), RETRY_MS)
      }
    }
    void read()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [client, enabled, hostId, tabId, sessionId, terminalHandleRef, wanted, worktreeId])

  return useMemo(() => {
    const previews: Record<string, string[]> = {}
    for (const [messageId, paths] of Object.entries(wanted)) {
      const uris = paths.map(
        (path) => loaded[`${hostId}\0${path}`] ?? dataUriByPath.get(`${hostId}\0${path}`) ?? ''
      )
      if (uris.some((uri) => uri.length > 0)) {
        previews[messageId] = uris
      }
    }
    return previews
  }, [hostId, loaded, wanted])
}
