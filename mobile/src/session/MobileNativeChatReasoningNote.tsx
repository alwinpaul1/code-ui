import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { cutWholeCharacters } from '../text/whole-character-cut'
import { Txt } from '../ui/Txt'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { nativeChatMessageText } from './mobile-native-chat-message-text'
import { MobileNativeChatLongPressRow } from './MobileNativeChatLongPressRow'

/** A thought longer than this shows its opening and a Show more. On this
 *  machine 201 of the 1,245 thinking blocks in Claude Code 2.1.282
 *  transcripts carried text (the rest only a signature); the longest was 414
 *  characters, and none from 2.1.280 or 2.1.281 passed 460 (2026-09-26). So an
 *  ordinary thought is drawn whole, and only a long think-aloud folds, which
 *  keeps #17579 from coming back. */
export const REASONING_FOLD_CHARS = 600

/** Where a long thought is cut: at the last space before the fold, so the cut
 *  never lands inside a word. Never back at an earlier paragraph break: a
 *  streamed thought read whole at 600 characters would lose most of what was
 *  on screen at 601 (review, 2026-09-26). */
export function reasoningOpening(text: string, limit: number = REASONING_FOLD_CHARS): string | null {
  if (text.length <= limit) {
    return null
  }
  // Half an emoji draws as a replacement glyph.
  const stretch = cutWholeCharacters(text, limit)
  const space = stretch.search(/\s\S*$/)
  const opening = `${(space > 0 ? stretch.slice(0, space) : stretch).trimEnd()}…`
  // A code block the cut left open would draw the rest of the opening as code.
  const fences = opening.match(/^ {0,3}(`{3,}|~{3,})/gm) ?? []
  return fences.length % 2 === 1 ? `${opening}\n${fences[fences.length - 1]!.trim()}` : opening
}

/** A `reasoning` message, drawn the way the Claude app draws Claude's
 *  thinking: the words themselves beside a thin, faint line. The line is what
 *  marks a thought: the agent's own notes and answers carry none (2026-09-25). */
export function MobileNativeChatReasoningNote({
  message,
  fontScale,
  onOpenFile,
  onLongPress,
  styles
}: {
  message: NativeChatMessage
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  /** Android only: the message's actions sheet (Orca #22871). */
  onLongPress?: () => void
  styles: ChatMessageStyles
}) {
  const [open, setOpen] = useState(false)
  const text = nativeChatMessageText(message.blocks).trim()
  if (!text) {
    return null
  }
  const opening = reasoningOpening(text)
  return (
    <MobileNativeChatLongPressRow onLongPress={onLongPress} style={styles.row}>
      <View style={styles.reasoning}>
        <View style={styles.reasoningBody}>
          <MobileMarkdown
            content={opening && !open ? opening : text}
            textScale={fontScale * 0.93}
            onOpenFile={onOpenFile}
            rangeSelectable
            typography={TRANSCRIPT_MARKDOWN_TYPOGRAPHY}
            onLongPress={onLongPress}
          />
        </View>
        {opening ? (
          <Pressable
            style={styles.reasoningToggle}
            onPress={() => setOpen((shown) => !shown)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
          >
            <Txt variant="caption" weight="semibold" tone="muted">
              {open ? 'Show less' : 'Show more'}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </MobileNativeChatLongPressRow>
  )
}
