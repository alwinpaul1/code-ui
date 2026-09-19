import { loadMobileFilePreview } from './mobile-file-preview-request'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
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

/**
 * Images for a markdown file in a worktree, read through the same file RPCs
 * the explorer uses. Bitmaps come back from `files.readPreview` as a data
 * URI; an SVG is text, read with `files.read`, and drawn by react-native-svg
 * (RN's Image cannot draw SVG). Anything the host refuses, or that points
 * outside the worktree, resolves to null and the document shows the link it
 * always showed.
 */
export function createMarkdownImageResolver(args: {
  client: MobileFilePreviewRpcSender | null
  worktreeId: string
  documentRelativePath: string
}): MarkdownImageResolver {
  const cache = new Map<string, Promise<MarkdownImageSource | null>>()
  return (url) => {
    const { client, worktreeId, documentRelativePath } = args
    const path = resolveMarkdownImagePath(documentRelativePath, url)
    if (!client || !path) {
      return Promise.resolve(null)
    }
    const cached = cache.get(path)
    if (cached) {
      return cached
    }
    const pending = (async (): Promise<MarkdownImageSource | null> => {
      const preview = await loadMobileFilePreview(client, worktreeId, path)
      if (preview.status !== 'ready') {
        return null
      }
      if (preview.kind === 'image') {
        return { kind: 'bitmap', uri: preview.dataUri }
      }
      if (preview.kind === 'pdf') {
        return null
      }
      if (isSvgPath(path) && !preview.truncated && /<svg[\s>]/i.test(preview.content)) {
        return { kind: 'svg', xml: preview.content }
      }
      return null
    })().catch(() => null)
    if (cache.size >= CACHE_CAP) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) {
        cache.delete(oldest)
      }
    }
    cache.set(path, pending)
    return pending
  }
}
