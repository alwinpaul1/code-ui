import { loadMobileFilePreview } from './mobile-file-preview-request'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { classifyMobileArtifact } from '../session/mobile-artifact-kind'
import type { RpcClient } from '../transport/rpc-client'
import {
  isSvgPath,
  resolveMarkdownImagePath,
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

async function readImage(
  client: MarkdownImageClient,
  worktreeId: string,
  path: string
): Promise<ImageRead> {
  try {
    const preview = await loadMobileFilePreview(client, worktreeId, path)
    if (
      preview.status === 'waiting' ||
      preview.status === 'loading' ||
      (preview.status === 'error' && preview.reconnect)
    ) {
      console.warn('[markdown-image] the host could not read a figure yet', {
        path,
        message: preview.message
      })
      return UNSETTLED
    }
    if (preview.status !== 'ready') {
      return NO_IMAGE
    }
    if (preview.kind === 'image') {
      return { source: { kind: 'bitmap', uri: preview.dataUri }, settled: true }
    }
    if (preview.kind === 'pdf') {
      return NO_IMAGE
    }
    if (isSvgPath(path) && !preview.truncated && /<svg[\s>]/i.test(preview.content)) {
      return { source: { kind: 'svg', xml: preview.content }, settled: true }
    }
    return NO_IMAGE
  } catch (error: unknown) {
    console.warn('[markdown-image] a figure read was refused', {
      path,
      error: error instanceof Error ? error.message : String(error)
    })
    return UNSETTLED
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
 * Only the file's own answer is kept (an image, not found, a PDF, a non-image). A read that
 * rejected or found the host unreachable is dropped once it settles, so the next render reads it
 * again: kept, a figure opened during a reconnect stayed a link until the document was closed
 * (review, 2026-09-30). `connection` is what the figure watches to know when that is.
 */
export function createMarkdownImageResolver(args: {
  client: MarkdownImageClient | null
  worktreeId: string
  documentRelativePath: string
}): MarkdownImageResolver {
  const cache = new Map<string, Promise<MarkdownImageSource | null>>()
  const read = (url: string): Promise<MarkdownImageSource | null> => {
    const { client, worktreeId, documentRelativePath } = args
    const path = resolveMarkdownImagePath(documentRelativePath, url)
    // A PDF cannot be drawn as a figure, and the preview loader pages the whole file over first.
    if (!client || !path || classifyMobileArtifact(path) === 'pdf') {
      return Promise.resolve(null)
    }
    const cached = cache.get(path)
    if (cached) {
      return cached
    }
    const pending: Promise<MarkdownImageSource | null> = readImage(client, worktreeId, path).then(
      (read) => {
        if (!read.settled && cache.get(path) === pending) {
          cache.delete(path)
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
  const { client } = args
  if (client?.getLastConnectedAt && client.onStateChange) {
    resolve.connection = {
      lastConnectedAt: () => client.getLastConnectedAt?.() ?? null,
      subscribe: (listener) => client.onStateChange?.(() => listener()) ?? (() => {})
    }
  }
  return resolve
}
