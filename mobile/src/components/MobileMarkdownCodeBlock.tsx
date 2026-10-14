import { Text, View } from 'react-native'
import { MermaidDiagram } from './pr-sidebar/MermaidDiagram'
import { MarkdownCodeHeader } from './MobileMarkdownCodeHeader'
import { MarkdownCodeScroller } from './MobileMarkdownCodeScroller'
import { MarkdownCodeText } from './MobileMarkdownCodeText'
import { isMobileMermaidLanguage } from './mobile-mermaid-language'
import { mobileMarkdownCodeLines } from './mobile-markdown-code-lines'
import type { MobileMarkdownBlock } from './mobile-markdown-parser'
import type { MarkdownStyles } from './mobile-markdown-styles'
import type { ReactNode } from 'react'

/** Prose base size — passed to MermaidDiagram fallback mono text. */
const MERMAID_BASE = 13
/** Kept out of MobileMarkdown.tsx only because that file is at its line
 *  ceiling; a fence is a card (header, then coloured code), not one Text. */
export function renderMarkdownCodeBlock({
  block,
  index,
  styles,
  selectable,
  mermaidSourceOccurrences
}: {
  block: Extract<MobileMarkdownBlock, { type: 'code' }>
  index: number
  styles: MarkdownStyles
  selectable: boolean
  /** Counts identical mermaid sources WITHIN ONE RENDER, so two copies of a
   *  diagram get distinct keys. Per render, never module-level: accumulating
   *  across renders drifts the key and remounts a finished diagram, which
   *  mobile-markdown-mermaid-routing.test.ts pins. */
  mermaidSourceOccurrences: Map<string, number>
}): ReactNode {
          // Mermaid fences render as diagrams (WebView), not as raw code — same as PR sidebar.
          // Unclosed fences are still streaming: mounting the WebView per tick would
          // reload its document up to 20x/sec, so they stay raw code until terminated.
          if (isMobileMermaidLanguage(block.language) && block.closed) {
            const occurrence = mermaidSourceOccurrences.get(block.text) ?? 0
            mermaidSourceOccurrences.set(block.text, occurrence + 1)
            const key = `${block.text}:${occurrence}`
            return inQuote(
              block,
              styles,
              key,
              <MermaidDiagram key={key} source={block.text} base={MERMAID_BASE} />
            )
          }
          const code = mobileMarkdownCodeLines(block.text, block.language)
          return inQuote(
            block,
            styles,
            index,
            <View key={index} style={styles.codeBlock} testID="markdown-code-block">
              <MarkdownCodeHeader language={block.language} code={block.text} styles={styles} />
              <View style={styles.codeBody} testID="markdown-code-body">
                {/* A horizontal scroller, not a wrap, unless the reader turned Wrap long
                    lines on (MobileMarkdownCodeScroller, which says why). The 16 dp padding
                    is inside the scroll, as the Claude app has it, so a long line scrolls
                    out to the card's edge. */}
                <MarkdownCodeScroller contentStyle={styles.codeBodyContent}>
                  <MarkdownCodeText lines={code.lines} lineStyle={styles.codeText} selectable={selectable} />
                </MarkdownCodeScroller>
                {code.hidden > 0 ? (
                  <Text style={styles.codeTruncated}>{`${code.hidden} more lines`}</Text>
                ) : null}
              </View>
            </View>
          )

}

/** A fence that came out of a quote, drawn inside the quote's bar, the bar
 *  joining the one above when the quote carries on from there
 *  (mobile-markdown-quote-blocks.ts). The bar takes the block's key, so a
 *  finished diagram keeps the key it would have had outside a quote. */
function inQuote(
  block: Extract<MobileMarkdownBlock, { type: 'code' }>,
  styles: MarkdownStyles,
  key: string | number,
  drawn: ReactNode
): ReactNode {
  if (!block.quoted) {
    return drawn
  }
  return (
    <View key={key} style={block.continuesQuote ? [styles.quoteBlock, styles.quoteJoin] : styles.quoteBlock}>
      {drawn}
    </View>
  )
}
