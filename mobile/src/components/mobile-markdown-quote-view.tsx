import type { ReactElement, ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import type { MobileMarkdownQuoteMember } from './mobile-markdown-parser'
import type { ProseBlock } from './mobile-markdown-prose-runs'
import type { MarkdownStyles } from './mobile-markdown-styles'

/** Draws a stretch of prose at a width: MobileMarkdown's own prose run, native
 *  on Android's transcript and a Text elsewhere. */
export type QuoteProseDrawer = (prose: ProseBlock[], key: string, width: number, nativeProseWidth: number) => ReactNode

type Options = {
  members: readonly MobileMarkdownQuoteMember[]
  key: string
  style: StyleProp<ViewStyle>
  styles: MarkdownStyles
  /** The width beside the bar: rounded for pills, unrounded for the native view. */
  width: number
  nativeProseWidth: number
  drawProse: QuoteProseDrawer
}

/**
 * A quote as the Claude app draws one: one bar down its whole height, and its
 * Markdown inset beside it (mobile-markdown-quote-blocks.ts has what a quote
 * holds). Each stretch of prose in it is drawn as one run, so a list in a quote
 * hangs as a list outside one does (an email draft quoted in a reply,
 * 2026-10-10), and a quote inside it is a bar of its own, inset by this one.
 */
export function drawMarkdownQuote({ members, key, style, styles, width, nativeProseWidth, drawProse }: Options): ReactElement {
  const inset = styles.quoteBlock.borderLeftWidth + styles.quoteBlock.paddingLeft
  const drawn: ReactNode[] = []
  let prose: ProseBlock[] = []
  const flush = (): void => {
    if (prose.length > 0) {
      drawn.push(drawProse(prose, `${key}:${drawn.length}`, Math.max(0, width), Math.max(0, nativeProseWidth)))
      prose = []
    }
  }
  for (const member of members) {
    if (member.type === 'quote') {
      flush()
      drawn.push(
        drawMarkdownQuote({
          members: member.members,
          key: `${key}:${drawn.length}`,
          style: styles.quoteBlock,
          styles,
          width: width - inset,
          nativeProseWidth: nativeProseWidth - inset,
          drawProse
        })
      )
    } else {
      prose.push(member)
    }
  }
  flush()
  if (drawn.length === 0) {
    // An empty quote (a lone `>`, or a list still streaming in) keeps one
    // empty line beside its bar, so the bar has a height (review, 2026-10-10).
    drawn.push(drawProse([{ type: 'paragraph', text: '' }], `${key}:0`, Math.max(0, width), Math.max(0, nativeProseWidth)))
  }
  return (
    <View key={key} style={style}>
      {drawn}
    </View>
  )
}
