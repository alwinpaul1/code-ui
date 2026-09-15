// Classifies a file path into how the mobile viewer should render it. Images
// route through files.readPreview (base64) and render as an <Image>; HTML routes
// through files.read (text) and renders in a sandboxed WebView with a source
// toggle; markdown reads through the same text path and renders as a document
// with its own source toggle; everything else stays on the text/syntax path.
export type MobileArtifactKind = 'image' | 'html' | 'markdown' | 'pdf' | 'other'

// Raster image extensions React Native's <Image> can decode from a base64 data
// URI (host returns these via files.readPreview). SVG is intentionally excluded:
// RN <Image> can't render image/svg+xml data URIs, so .svg falls through to the
// text path and renders as (meaningful) XML source instead of a blank image.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])

const HTML_EXTENSIONS = new Set(['html', 'htm'])

// Markdown is a document, not source: it renders, with a toggle back to the raw
// text for when the syntax is the point. The desktop has always shown it this
// way; the phone showed the raw file (2026-09-15).
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])

// PDFs also come back as base64 from files.readPreview and render in the native
// PDF view.
const PDF_EXTENSIONS = new Set(['pdf'])

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  // A leading dot (dotfile, no real extension) or no dot → no extension.
  if (dot <= 0) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

export function classifyMobileArtifact(path: string): MobileArtifactKind {
  const ext = extensionOf(path)
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  if (HTML_EXTENSIONS.has(ext)) {
    return 'html'
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return 'markdown'
  }
  if (PDF_EXTENSIONS.has(ext)) {
    return 'pdf'
  }
  return 'other'
}
