import { loadMobileFilePreview } from './mobile-file-preview-request'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { isFileOwnPreviewError } from './mobile-file-preview-response'
import { classifyMobileArtifact } from '../session/mobile-artifact-kind'
import type { RpcClient } from '../transport/rpc-client'
import {
  isSvgPath,
  resolveMarkdownImagePath,
  type MarkdownImageConnection,
  type MarkdownImageResolver,
  type MarkdownImageSource
} from '../components/markdown-image-source'

/** Resolved images kept per document, so a re-render or a Source-and-back
 *  does not fetch a figure twice. Bounded: a long document with many figures
 *  is still a few MB at most. */
const CACHE_CAP = 32

/** The file RPCs, and the connection a figure watches when the client has one (a live RpcClient). */
type MarkdownImageClient = MobileFilePreviewRpcSender &
  Partial<Pick<RpcClient, 'getLastConnectedAt' | 'onStateChange'>>

/** What one read found, and whether that is the file's answer or only the link's. */
type ImageRead = { source: MarkdownImageSource | null; settled: boolean }

const UNSETTLED: ImageRead = { source: null, settled: false }
const NO_IMAGE: ImageRead = { source: null, settled: true }

/** Settled only on the file's own answer, listed here; every other outcome is unsettled. */
async function readImage(
  client: MarkdownImageClient,
  worktreeId: string,
  path: string
): Promise<ImageRead> {
  try {
    const preview = await loadMobileFilePreview(client, worktreeId, path)
    if (preview.status === 'ready') {
      if (preview.kind === 'image') {
        return { source: { kind: 'bitmap', uri: preview.dataUri }, settled: true }
      }
      if (
        preview.kind !== 'pdf' &&
        isSvgPath(path) &&
        !preview.truncated &&
        /<svg[\s>]/i.test(preview.content)
      ) {
        return { source: { kind: 'svg', xml: preview.content }, settled: true }
      }
      // A PDF, a text file, a cut SVG: the file is there and is not a figure.
      return NO_IMAGE
    }
    if (preview.status === 'empty' || isFileOwnPreviewError(preview)) {
      return NO_IMAGE
    }
    console.warn('[markdown-image] the host did not answer for a figure; read again on a new connection', {
      path,
      message: preview.message
    })
    return UNSETTLED
  } catch (error: unknown) {
    console.warn('[markdown-image] a figure read was refused; read again on a new connection', {
      path,
      error: error instanceof Error ? error.message : String(error)
    })
    return UNSETTLED
  }
}

/** The connection a figure watches, when the client reports one. Unanswered reads are keyed on it. */
function connectionOf(client: MarkdownImageClient | null): MarkdownImageConnection | undefined {
  if (!client?.getLastConnectedAt || !client.onStateChange) {
    return undefined
  }
  return {
    lastConnectedAt: () => client.getLastConnectedAt?.() ?? null,
    subscribe: (listener) => client.onStateChange?.(() => listener()) ?? (() => {})
  }
}

/**
 * Images for a markdown file in a worktree, read through the same file RPCs
 * the explorer uses. Bitmaps come back from `files.readPreview` as a data
 * URI; an SVG is text, read with `files.read`, and drawn by react-native-svg
 * (RN's Image cannot draw SVG). Anything the host refuses, or that points
 * outside the worktree, resolves to null and the document shows the link it
 * always showed.
 *
 * Only the file's own answer is kept for the document: an image, an SVG, not found, a PDF or other
 * non-image, too large, binary (`readImage` and `isFileOwnPreviewError` list them between them).
 * Every other read is unanswered: a rejection, a refusal about the link or the runtime ("Remote
 * Orca runtime is not connected.", "Request timed out"), or the generic 'Unable to load preview:
 * ...' for a cause this build has not seen. One of those stands for the connection it was asked on
 * and no longer, so a figure asks again once per NEW connection (`connection` tells it when) and
 * never once per render on the same one. With no connection to watch it is dropped once it
 * settles, and the next render asks. The rule this replaced listed four recoverable phrases and
 * kept every other refusal as the file's answer, so a figure refused while the desktop's runtime
 * reconnected stayed a link until the document was closed (review 2026-09-30, round 3).
 */
export function createMarkdownImageResolver(args: {
  client: MarkdownImageClient | null
  worktreeId: string
  documentRelativePath: string
}): MarkdownImageResolver {
  const connection = connectionOf(args.client)
  const cache = new Map<string, Promise<MarkdownImageSource | null>>()
  // An unanswered read, and the connection it was asked on: it answers only while that one lasts.
  const unansweredOn = new WeakMap<Promise<MarkdownImageSource | null>, number | null>()
  const read = (url: string): Promise<MarkdownImageSource | null> => {
    const { client, worktreeId, documentRelativePath } = args
    const path = resolveMarkdownImagePath(documentRelativePath, url)
    // A PDF cannot be drawn as a figure, and the preview loader pages the whole file over first.
    if (!client || !path || classifyMobileArtifact(path) === 'pdf') {
      return Promise.resolve(null)
    }
    const askedOn = connection?.lastConnectedAt() ?? null
    const cached = cache.get(path)
    if (cached && (!unansweredOn.has(cached) || unansweredOn.get(cached) === askedOn)) {
      return cached
    }
    cache.delete(path)
    const pending: Promise<MarkdownImageSource | null> = readImage(client, worktreeId, path).then(
      (read) => {
        if (!read.settled && cache.get(path) === pending) {
          if (connection) {
            unansweredOn.set(pending, askedOn)
          } else {
            cache.delete(path)
          }
        }
        return read.source
      }
    )
    if (cache.size >= CACHE_CAP) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) {
        cache.delete(oldest)
      }
    }
    cache.set(path, pending)
    return pending
  }
  // Nothing this does may throw out of the caller, which is a figure's effect: a throw there takes
  // the document viewer down instead of drawing the link (`![chart](100%.png)`, review 2026-09-30).
  const resolve: MarkdownImageResolver = (url) => {
    try {
      return read(url)
    } catch (error: unknown) {
      console.warn('[markdown-image] a figure path could not be resolved', {
        url,
        error: error instanceof Error ? error.message : String(error)
      })
      return Promise.resolve(null)
    }
  }
  if (connection) {
    resolve.connection = connection
  }
  return resolve
}
