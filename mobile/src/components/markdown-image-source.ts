/**
 * What an image in a markdown document resolves to, and where its file lives.
 *
 * A document's `![fig](fig/plot.svg)` names a file beside the document, on
 * the desktop. The phone can read it through the same file RPCs the explorer
 * uses, once the path is turned into a worktree-relative one. Anything that
 * would leave the worktree (`../../etc`) is refused: the read RPC is jailed
 * and would refuse it too, but refusing here keeps the reason legible.
 */
export type MarkdownImageSource =
  | { kind: 'bitmap'; uri: string }
  | { kind: 'svg'; xml: string }

export type MarkdownImageResolver = (url: string) => Promise<MarkdownImageSource | null>

const REMOTE = /^(https?:)?\/\//i
const DATA = /^data:image\//i

/** True for a URL the phone can show without asking the host. */
export function isRemoteImageUrl(url: string): boolean {
  return REMOTE.test(url) || DATA.test(url)
}

/** The worktree-relative path of an image named from a document, or null
 *  when it points outside the worktree or is not a file path at all. */
export function resolveMarkdownImagePath(
  documentRelativePath: string,
  url: string
): string | null {
  const bare = url.trim().replace(/[?#].*$/, '')
  if (!bare || isRemoteImageUrl(bare) || /^[a-z][a-z0-9+.-]*:/i.test(bare)) {
    return null
  }
  const documentDir = documentRelativePath.replace(/\\/g, '/').split('/').slice(0, -1)
  const parts = bare.startsWith('/') ? [] : [...documentDir]
  for (const part of bare.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      if (parts.length === 0) {
        return null
      }
      parts.pop()
      continue
    }
    parts.push(decodeURIComponent(part))
  }
  return parts.length > 0 ? parts.join('/') : null
}

export function isSvgPath(path: string): boolean {
  return /\.svg$/i.test(path)
}

/** The height an SVG wants at a given width, from its own viewBox or
 *  width/height attributes; 9:16 when it says nothing. */
export function svgAspectRatio(xml: string): number {
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(xml)
  if (viewBox) {
    const width = Number.parseFloat(viewBox[1]!)
    const height = Number.parseFloat(viewBox[2]!)
    if (width > 0 && height > 0) {
      return width / height
    }
  }
  const width = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(xml)
  const height = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(xml)
  if (width && height) {
    const w = Number.parseFloat(width[1]!)
    const h = Number.parseFloat(height[1]!)
    if (w > 0 && h > 0) {
      return w / h
    }
  }
  return 16 / 9
}
