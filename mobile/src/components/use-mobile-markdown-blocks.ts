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
 *  With `keepLineBreaks`, a newline the writer typed stays a line break instead of a space
 *  (a sent prompt, MobileNativeChatProse). */
export function useMobileMarkdownBlocks(
  text: string,
  visuals: boolean,
  keepLineBreaks = false
): { blocks: readonly MobileMarkdownRenderBlock[]; directives: NativeChatVisualDirective[] } {
  const visualLines = useMemo(
    () => (visuals ? protectMobileMarkdownVisualLines(text) : null),
    [text, visuals]
  )
  const previewText = useMemo(
    () => normalizeMobileMarkdownPreviewHtml(visualLines?.text ?? text),
    [visualLines, text]
  )
  const directives = visualLines?.directives ?? NO_DIRECTIVES
  const lines = visualLines?.lines ?? NO_LINES
  const blocks = useMemo(
    () => withMobileMarkdownVisualBlocks(parseMobileMarkdown(previewText, keepLineBreaks), lines),
    [previewText, lines, keepLineBreaks]
  )
  return { blocks, directives }
}
