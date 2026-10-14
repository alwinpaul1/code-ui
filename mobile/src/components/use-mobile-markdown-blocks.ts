import { useMemo } from 'react'
import type { NativeChatVisualDirective } from '../../../src/shared/native-chat-visual-directive'
import { normalizeMobileMarkdownPreviewHtml } from './mobile-markdown-preview-html'
import { parseMobileMarkdown } from './mobile-markdown-parser'
import {
  protectMobileMarkdownVisualLines,
  withMobileMarkdownVisualBlocks,
  type MobileMarkdownRenderBlock
} from './mobile-markdown-visual-lines'

const NO_DIRECTIVES: NativeChatVisualDirective[] = []
const NO_LINES: string[] = []

/** The blocks MobileMarkdown draws, from its document source; with `visuals`, directive lines
 *  become `visual` blocks (Orca #26071). Without it, every surface parses exactly as before.
 *  With `typed`, the text is a person's own (a sent prompt, MobileNativeChatProse): its
 *  newlines and indents stay, and it is not read as HTML, so `<Text>` and `&amp;` are drawn
 *  as typed. */
export function useMobileMarkdownBlocks(
  text: string,
  visuals: boolean,
  typed = false
): { blocks: readonly MobileMarkdownRenderBlock[]; directives: NativeChatVisualDirective[] } {
  const visualLines = useMemo(
    () => (visuals ? protectMobileMarkdownVisualLines(text) : null),
    [text, visuals]
  )
  const previewText = useMemo(
    () => (typed ? (visualLines?.text ?? text) : normalizeMobileMarkdownPreviewHtml(visualLines?.text ?? text)),
    [visualLines, text, typed]
  )
  const directives = visualLines?.directives ?? NO_DIRECTIVES
  const lines = visualLines?.lines ?? NO_LINES
  const blocks = useMemo(
    () => withMobileMarkdownVisualBlocks(parseMobileMarkdown(previewText, typed), lines),
    [previewText, lines, typed]
  )
  return { blocks, directives }
}
