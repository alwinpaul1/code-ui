import { ScrollView, Text, View } from 'react-native'
import { MermaidDiagram } from './pr-sidebar/MermaidDiagram'
import { MobileSyntaxLine } from './MobileSyntaxSegments'
import { gutterWidthForLines } from './mobile-syntax-lines'
import { isMobileMermaidLanguage } from './mobile-mermaid-language'
import { mobileMarkdownCodeLines } from './mobile-markdown-code-lines'
import type { MobileMarkdownBlock } from './mobile-markdown-parser'
import type { MarkdownStyles } from './mobile-markdown-styles'
import type { ReactNode } from 'react'

/** Prose base size — passed to MermaidDiagram fallback mono text. */
const MERMAID_BASE = 13
/** Kept out of MobileMarkdown.tsx only because that file is at its line
 *  ceiling; a fence is now a numbered, coloured block rather than one Text. */
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
            return (
              <MermaidDiagram
                key={`${block.text}:${occurrence}`}
                source={block.text}
                base={MERMAID_BASE}
              />
            )
          }
          const code = mobileMarkdownCodeLines(block.text, block.language)
          const gutterWidth = gutterWidthForLines(code.lines.length)
          return (
            <View key={index} style={styles.codeBlock}>
              {block.language ? <Text style={styles.codeLanguage}>{block.language}</Text> : null}
              {/* A horizontal scroller, not a wrap: at ~40 columns wrapping a
                  command or an indented block shreds it, and a reader who
                  wants to copy a line needs the line. */}
              {/* The bar is SHOWN, and kept on Android rather than fading, so a
                  line the phone cannot fit reads as scrollable instead of as
                  broken. Reported 2026-09-15: the gate command in CLAUDE.md
                  ended at "npx" and looked truncated — it scrolled the whole
                  time, nothing said so. Android only draws the bar when the
                  content actually overflows, so a short fence gets none. */}
              <ScrollView horizontal showsHorizontalScrollIndicator persistentScrollbar>
                <View>
                  {code.lines.map((segments, lineIndex) => (
                    <MobileSyntaxLine
                      key={lineIndex}
                      number={lineIndex + 1}
                      segments={segments}
                      gutterWidth={gutterWidth}
                      gutterDigits={String(code.lines.length).length}
                      lineStyle={styles.codeText}
                      gutterStyle={styles.codeGutter}
                      selectable={selectable}
                    />
                  ))}
                </View>
              </ScrollView>
              {code.hidden > 0 ? (
                <Text style={styles.codeTruncated}>{`${code.hidden} more lines`}</Text>
              ) : null}
            </View>
          )

}
