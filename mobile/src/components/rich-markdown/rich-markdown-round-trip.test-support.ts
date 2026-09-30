import { createRichMarkdownEditorScope, type RichMarkdownEditorScope } from './document-scope'
import { markdownToHtml } from './markdown-to-html'
import { RICH_MARKDOWN_EDITOR_MARKUP } from './document-markup'
import { currentMarkdown } from './editor-content'
import { startEditorSurface } from './editor-surface'

/**
 * The editor's two halves over a real document (happy-dom), for the round-trip suites beside
 * markdown-round-trip.test.ts, whose own `surface()` this is: markdown into the surface, and the
 * surface back out as markdown. A test file that imports this runs under happy-dom.
 */
export type RoundTripSurface = {
  scope: RichMarkdownEditorScope
  editor: HTMLElement
  html: string
  /** What a save writes for the surface as it is now. */
  saved: () => string
}

function startSurface(): { scope: RichMarkdownEditorScope; editor: HTMLElement } {
  document.body.innerHTML = RICH_MARKDOWN_EDITOR_MARKUP
  const scope = createRichMarkdownEditorScope()
  scope.editable = true
  startEditorSurface(scope)
  return { scope, editor: document.getElementById('editor')! }
}

/** The surface a document opens as. */
export function openedSurface(markdown: string): RoundTripSurface {
  const { scope, editor } = startSurface()
  editor.innerHTML = markdownToHtml(scope, markdown)
  return { scope, editor, html: editor.innerHTML, saved: () => currentMarkdown(scope) }
}

/**
 * The surface holding markup no document opens as, which only an edit reaches: the engine's own
 * paragraphs inside a quote, a mark it left empty. Parsed by the HTML parser, as `innerHTML` is.
 */
export function editedSurface(markup: string): RoundTripSurface {
  const { scope, editor } = startSurface()
  editor.innerHTML = markup
  return { scope, editor, html: editor.innerHTML, saved: () => currentMarkdown(scope) }
}

/** What opening a document and saving it untouched writes back. */
export function savedUntouched(markdown: string): string {
  return openedSurface(markdown).saved()
}
