// Images the DESKTOP pasted into a chat arrive in the transcript as
// `[Image: source: /var/folders/…/orca-paste-….png]` — a path on the Mac that
// the phone cannot load, so the bubble showed "🖼 /var/folders/…" as text.
// Resolve each path through the host (the same grant flow a tapped file uses)
// and read it as a preview, so the bubble gets a real thumbnail.
import { useEffect, useMemo, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import {
  formatPreviewByteLength,
  normalizeMobileFilePreviewResult,
  previewErrorFromRefusal
} from '../files/mobile-file-preview-response'
import { AGENT_IMAGE_MAX_BYTES, worktreeFileSize } from './host-image-size-cap'
import { notShared } from './host-image-not-shared'
import { isAgentImageShown, resetAgentImagesShownForTests, useAgentImagesShownVersion } from './agent-image-visibility'
import { normalizeImageTranscriptMessages } from '../../../src/shared/native-chat-image-transcript-markers'
import { isImageRefBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { agentImagePaths } from './mobile-native-chat-agent-images'
import { agentTextNamesPath, agentTextNamesPathCleanly } from './agent-image-share-ask'
import { foldQueuedImageTurns } from './mobile-native-chat-queued-image-fold'
import { hostImageAskState, recordHostImageFailure, recordHostImageMissing, refusedBeforeNamed, resetHostImageRefusals, RETRY_MS } from './host-image-refusals'
import {
  hostImageStillThere,
  keepHostImageFile,
  resetHostImageFilesForTests,
  type HostImageFileStore
} from './host-image-files'

/** The pictures an assistant message's calls show, in order: each image its
 *  Read tool read, and each picture SendUserFile sent. The Claude app shows
 *  both as thumbnails (2026-09-12, 2026-10-11); the bytes never reach the
 *  phone (mobile-native-chat-agent-images.ts), so it fetches a host
 *  thumbnail of each path. */
export function readImagePaths(message: NativeChatMessage): string[] {
  return agentImagePaths(message)
}

/** Image-ref paths per RAW record, in block order, for messages the phone has
 *  no local preview for (a message with local previews is a phone-side send).
 *
 *  Keyed by the raw record on purpose. An earlier version folded first and
 *  keyed by the folded message, but the view folds with the mid-turn send
 *  boundaries and this hook could not see them: a Read record that folds
 *  into its assistant turn normally stays its own row after a split, the two
 *  folds named different ids, and no thumbnail ever showed (2026-09-13). The
 *  view remaps raw ids through whichever fold it actually renders. */
export function collectHostImagePaths(
  messages: readonly NativeChatMessage[],
  localPreviews: Record<string, string[]> | undefined
): Record<string, string[]> {
  const paths: Record<string, string[]> = {}
  // Folded as the chat draws them, so each path is asked for on the row that
  // draws it (mobile-native-chat-queued-image-fold.ts).
  for (const message of normalizeImageTranscriptMessages(foldQueuedImageTurns([...messages]))) {
    const read = readImagePaths(message)
    if (read.length > 0) {
      paths[message.id] = read
      continue
    }
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

/** Host and path to the picture's URI: a cache file on the phone, or the
 *  `data:` URI it came as where no file could be written (host-image-files.ts). */
const dataUriByPath = new Map<string, string>()
const inFlight = new Map<string, Promise<string | null>>()
/** Paths already explained, so a retry every few seconds says it once. */
const explained = new Set<string>()

export function resetHostImagePreviewCacheForTests(): void {
  dataUriByPath.clear()
  resetHostImageRefusals()
  inFlight.clear()
  explained.clear()
  resetHostImageFilesForTests()
  resetAgentImagesShownForTests()
}

/** The one line a picture that never came leaves behind: which path, and
 *  where to look. Once per path per run. */
function explainMissing(key: string, path: string, why: string): void {
  if (explained.has(key)) {
    return
  }
  explained.add(key)
  console.warn(`[host-image] no picture for ${path}: ${why}`)
}

// Whether assistant TEXT names a path (the desktop's rule 1), loosely or as that rule accepts it.
export { agentTextNamesPath } from './agent-image-share-ask'

export async function loadHostImage(args: {
  client: RpcClient
  hostId: string
  worktreeId: string
  nativeChatContext: { tabId: string; sessionId: string } | null
  /** The tab's terminal: a pasted path is echoed in its output, which is the
   *  one provenance the host accepts for a user-pasted file. */
  terminalHandle: string | null
  path: string
  /** Whether agent text the phone holds names the path (for the line a
   *  refusal leaves behind; the desktop decides on its own transcript). */
  agentTextNamesPath?: boolean
  /** Whether that text names it the way the desktop's rule 1 accepts. Refused
   *  even so, the file is most likely gone: said as "couldn't be fetched". */
  agentTextNamesPathCleanly?: boolean
  /** Where the picture is kept; the platform's own when not given. */
  files?: HostImageFileStore | null
}): Promise<string | null> {
  const key = `${args.hostId}\0${args.path}`
  const cached = dataUriByPath.get(key)
  if (cached && hostImageStillThere(cached, args.files, key)) {
    return cached
  }
  // Its cache file was cleared, or now holds another picture: read it again.
  dataUriByPath.delete(key)
  const named = args.agentTextNamesPath === true
  const cleanly = args.agentTextNamesPathCleanly === true
  const { allowed, newlyNamed } = hostImageAskState(key, named, cleanly)
  if (!allowed) {
    return null
  }
  const pending = inFlight.get(key)
  if (pending) {
    // An ask sent before the agent's text named the path may come back
    // refused after it does: ask once more then, rather than at the next timer.
    return args.agentTextNamesPath === true
      ? pending.then((uri) => uri ?? (refusedBeforeNamed(key, cleanly) ? loadHostImage(args) : null))
      : pending
  }
  // Back-off rules: host-image-refusals.ts.
  const gone = cleanly && args.nativeChatContext != null
  const fail = (refused = false) => {
    recordHostImageFailure(key, { refused, named, cleanly, newlyNamed })
    recordHostImageMissing(args.path, refused && !gone ? 'not-shared' : 'failed')
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
        fail()
        const failure = (resolved as Partial<RpcFailure>).error
        explainMissing(key, args.path, `the desktop could not resolve it (${failure?.message || failure?.code || 'no reason given'})`)
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
      if (target?.kind === 'worktree-file' && target.relativePath) {
        const size = await worktreeFileSize(args.client, { worktree: resolvedWorktree, relativePath: target.relativePath })
        if (size !== null && size > AGENT_IMAGE_MAX_BYTES) {
          recordHostImageFailure(key, { refused: true, named, cleanly, newlyNamed })
          recordHostImageMissing(args.path, 'too-large')
          explainMissing(key, args.path, `it is ${formatPreviewByteLength(size)}, over the ${formatPreviewByteLength(AGENT_IMAGE_MAX_BYTES)} the phone takes for a chat picture, so it was not read`)
          return null
        }
      }
      if (!request) {
        fail(true)
        explainMissing(key, args.path, `${gone ? "the agent's text names it cleanly, so the file may be gone (moved or deleted), or Orca's rule 1 did not apply (another session or agent on the tab, a transcript it could not read, older than its 2,000-message tail); " : ''}${notShared(args)}`)
        return null
      }
      const read = await args.client.sendRequest(request.method, request.params, {
        timeoutMs: 30_000
      })
      // This send is still on the raw port, so the envelope is split here: no acceptance
      // policy has admitted the payload before the projection sees it.
      const preview = read.ok
        ? normalizeMobileFilePreviewResult(args.path, (read as RpcSuccess).result)
        : previewErrorFromRefusal((read as RpcFailure).error)
      if (preview.status !== 'ready' || preview.kind !== 'image') {
        fail()
        explainMissing(key, args.path, 'message' in preview ? preview.message : 'the desktop read it, but it is not an image')
        return null
      }
      const uri = keepHostImageFile(key, preview.dataUri, args.files)
      dataUriByPath.set(key, uri)
      recordHostImageMissing(args.path, undefined)
      return uri
    } catch (error) {
      fail()
      explainMissing(key, args.path, error instanceof Error ? error.message : String(error))
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
  // Raw records, keyed by their own ids; the view remaps them through the
  // fold it renders (see `collectHostImagePaths`). The filter keeps a
  // half-built message from a stubbed session out.
  const wanted = useMemo(
    () =>
      enabled
        ? collectHostImagePaths(
            messages.filter((m) => Array.isArray(m.blocks)),
            localPreviews
          )
        : {},
    [enabled, localPreviews, messages]
  )
  // Records whose paths are an agent's pictures, not a user's pasted ones.
  const agentIds = useMemo(
    () => new Set(messages.filter((m) => wanted[m.id] && m.role !== 'user').map((m) => m.id)),
    [messages, wanted]
  )
  // Only for the line a refusal leaves behind; recomputed with `wanted`.
  const namedInAgentText = useMemo(
    () => new Set(Object.values(wanted).flat().filter((path) => agentTextNamesPath(messages, path))),
    [messages, wanted]
  )
  const namedCleanly = useMemo(() => new Set([...namedInAgentText].filter((path) => agentTextNamesPathCleanly(messages, path))), [messages, namedInAgentText])
  const [loaded, setLoaded] = useState<Record<string, string>>({})
  // An agent's picture is asked for only while its slot is on screen
  // (agent-image-visibility.ts); a picture the user pasted is asked for at once.
  const shownVersion = useAgentImagesShownVersion()
  const userPaths = useMemo(
    () => new Set(Object.entries(wanted).filter(([id]) => !agentIds.has(id)).flatMap(([, paths]) => paths)),
    [agentIds, wanted]
  )

  useEffect(() => {
    if (!client || !enabled) {
      return
    }
    let active = true
    const paths = [...new Set(Object.values(wanted).flat())].filter(
      (path) => userPaths.has(path) || isAgentImageShown(path)
    )
    if (paths.length === 0) {
      return
    }
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
            path,
            agentTextNamesPath: namedInAgentText.has(path),
            agentTextNamesPathCleanly: namedCleanly.has(path)
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
  }, [client, enabled, hostId, namedInAgentText, namedCleanly, shownVersion, tabId, sessionId, terminalHandleRef, userPaths, wanted, worktreeId])

  return useMemo(() => {
    const previews: Record<string, string[]> = {}
    for (const [messageId, paths] of Object.entries(wanted)) {
      const uris = paths.map(
        (path) => loaded[`${hostId}\0${path}`] ?? dataUriByPath.get(`${hostId}\0${path}`) ?? ''
      )
      // An agent's pictures keep their entry with nothing loaded yet: the view
      // joins the entries of every record a turn folded, in record order, and
      // places them by position (placeAgentImages), so a record left out
      // would hand its neighbour's picture to its own slot.
      if (uris.some((uri) => uri.length > 0) || agentIds.has(messageId)) {
        previews[messageId] = uris
      }
    }
    return previews
  }, [agentIds, hostId, loaded, wanted])
}
