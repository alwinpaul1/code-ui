import {
  NATIVE_CHAT_VISUAL_MAX_PER_MESSAGE,
  parseNativeChatVisualDirectiveLine,
  type NativeChatVisualDirective
} from '../../../src/shared/native-chat-visual-directive'
import type { MobileMarkdownBlock } from './mobile-markdown-parser'

// The fence shapes the block parser (marked, CommonMark) opens and closes on, so a directive inside
// code stays code: up to three spaces, then three or more backticks or tildes; a closer uses the
// opener's character, is at least as long and carries nothing after it. Upstream's line parser only
// knew ``` fences (Orca #26071); this fork parses with marked, so a ~~~ or ```` fence counts too.
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/
const FENCE_TERMINATOR = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
// Private-use delimiters, as the preview normalizer's own placeholders use.
const PLACEHOLDER_PREFIX = '\uE000ORCA_VISUAL_'
const PLACEHOLDER = /^\uE000ORCA_VISUAL_(\d+)\uE000$/

/** A native-chat visual directive; `index` is its position in the protected directive list. */
export type MobileMarkdownVisualBlock = { type: 'visual'; index: number }

/** What MobileMarkdown draws: the parser's blocks, plus the visuals a transcript lifted out. */
export type MobileMarkdownRenderBlock = MobileMarkdownBlock | MobileMarkdownVisualBlock

export type MobileMarkdownVisualLines = {
  /** The content with each recognized directive line replaced by a placeholder paragraph. */
  text: string
  directives: NativeChatVisualDirective[]
}

function placeholderFor(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}\uE000`
}

/**
 * Lifts native-chat visual directive lines out of assistant prose before preview normalization,
 * which decodes entities and strips tags and would otherwise rewrite a title. Only top-level lines
 * outside fenced code count; quotes and list items never start with the marker, and an indented
 * line past three spaces is not a directive. Past the per-message cap a directive stays literal
 * text.
 */
export function protectMobileMarkdownVisualLines(content: string): MobileMarkdownVisualLines {
  // Text that already spells a placeholder would alias a real one; it renders no visuals at all.
  if (content.includes(PLACEHOLDER_PREFIX)) {
    return { text: content, directives: [] }
  }
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const directives: NativeChatVisualDirective[] = []
  let fence: string | null = null
  const next = lines.map((line) => {
    if (fence !== null) {
      const terminator = FENCE_TERMINATOR.exec(line)?.[1]
      if (terminator && terminator[0] === fence[0] && terminator.length >= fence.length) {
        fence = null
      }
      return line
    }
    const opener = FENCE_OPENER.exec(line)?.[1]
    if (opener) {
      fence = opener
      return line
    }
    if (directives.length >= NATIVE_CHAT_VISUAL_MAX_PER_MESSAGE) {
      return line
    }
    const directive = parseNativeChatVisualDirectiveLine(line)
    if (!directive) {
      return line
    }
    directives.push(directive)
    // Blank lines around it make the directive its own block, splitting any paragraph it was in.
    return `\n${placeholderFor(directives.length - 1)}\n`
  })
  return { text: next.join('\n'), directives }
}

/** The directive index a parsed line stands for, or null for any other line. */
export function mobileMarkdownVisualPlaceholderIndex(line: string, count: number): number | null {
  const match = PLACEHOLDER.exec(line.trim())
  if (!match) {
    return null
  }
  const index = Number(match[1])
  return index < count ? index : null
}

/**
 * The parsed blocks with each placeholder paragraph turned back into its visual. A separate pass
 * rather than a parser argument: the parser caches its blocks by source text
 * (`parseMobileMarkdown`), and a count in its signature would let one source answer for two.
 * With no directives, the parser's own array comes back untouched.
 */
export function withMobileMarkdownVisualBlocks(
  blocks: readonly MobileMarkdownBlock[],
  count: number
): readonly MobileMarkdownRenderBlock[] {
  if (count === 0) {
    return blocks
  }
  return blocks.map((block) => {
    if (block.type !== 'paragraph') {
      return block
    }
    const index = mobileMarkdownVisualPlaceholderIndex(block.text, count)
    return index === null ? block : { type: 'visual', index }
  })
}
