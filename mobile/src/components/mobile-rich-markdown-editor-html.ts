import { RICH_MARKDOWN_EDITOR_DOCUMENT_SCRIPT } from './rich-markdown-editor-document-script.generated'
import { RICH_MARKDOWN_EDITOR_MARKUP } from './rich-markdown/document-markup'
import {
  richMarkdownEditorStyle,
  richMarkdownEditorThemeVariables,
  type RichMarkdownEditorTheme
} from './rich-markdown/document-style'

export { escapeInjectedJavaScriptString } from './mobile-rich-markdown-editor-script-string'

/**
 * The page the WebView loads: the document's stylesheet, its markup, and the document itself.
 *
 * The script is the bundle `scripts/build-rich-markdown-editor-script.mjs` writes from
 * `src/components/rich-markdown/`, which is the same program a page mounts by importing those
 * modules. Nothing is escaped into it: it is emitted TypeScript rather than content, and the only
 * text that crosses into this document at runtime is the markdown the host injects, which
 * `escapeInjectedJavaScriptString` handles at the call.
 */
export function buildMobileRichMarkdownEditorHtml(theme: RichMarkdownEditorTheme): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
${richMarkdownEditorStyle(theme)}
  </style>
</head>
<body>
  ${RICH_MARKDOWN_EDITOR_MARKUP}
  <script>
${RICH_MARKDOWN_EDITOR_DOCUMENT_SCRIPT}
  </script>
</body>
</html>`
}

/** A theme switch written into the live document: the same variables the
 *  stylesheet opened with, set on the root, so the editor never reloads and
 *  keeps its caret. */
export function buildRichMarkdownEditorThemeScript(theme: RichMarkdownEditorTheme): string {
  const writes = richMarkdownEditorThemeVariables(theme)
    .map(([name, value]) => `style.setProperty(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
    .join(' ')
  return `(() => { const style = document.documentElement.style; ${writes} })();`
}
