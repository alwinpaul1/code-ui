import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'

/** What an opened row says when only the TUI's row reached the phone: the
 *  sender, and no words (a tab launched without the prompt hook). */
export const AGENT_MESSAGE_UNREAD_NOTE =
  'Only the sender reached the phone. To read the message, expand this row in the desktop terminal (ctrl+o).'

/** What an opened row says under words that are only the start of the message
 *  (the hook's 2,000 bytes, the tab status's 200 characters). */
export const AGENT_MESSAGE_CUT_NOTE =
  'Only the start of this message reached the phone. The rest is in the desktop terminal (ctrl+o).'

/**
 * A message a subagent sent this session, folded like the desktop TUI folds
 * it ("› Message from @general-purpose (ctrl+o to expand)") and drawn like a
 * run of work: the same muted sentence and chevron, the same ruled body when
 * open. Not a bubble: the user did not write it, and neither did the agent
 * this chat is with (mobile-native-chat-agent-messages.ts).
 */
export function MobileNativeChatAgentMessageRow({
  sender,
  body,
  cut,
  fontScale,
  onOpenFile,
  styles
}: {
  sender: string
  body: string
  /** Only the start of the message reached the phone. */
  cut?: boolean
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const title = `Message from ${sender}`
  return (
    <View style={styles.row} testID="native-chat-agent-message">
      <Pressable
        style={styles.toolRunToggle}
        onPress={() => setOpen((shown) => !shown)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        {/* Hugs its words, as a finished run's sentence does, so the chevron
            follows them rather than sitting at the far end of the row. */}
        <Text style={[styles.toolRunLabel, styles.toolRunSentence]} numberOfLines={1}>
          {title}
        </Text>
        {open ? (
          <ChevronDown size={14} color={colors.textMuted} strokeWidth={2} />
        ) : (
          <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.toolRunBody} testID="native-chat-agent-message-body">
          {body.trim().length > 0 ? (
            <>
              <MobileMarkdown content={body} textScale={fontScale} onOpenFile={onOpenFile} />
              {cut ? (
                <Txt variant="caption" tone="muted" scale={fontScale} testID="native-chat-agent-message-cut">
                  {AGENT_MESSAGE_CUT_NOTE}
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt variant="caption" tone="muted" scale={fontScale}>
              {AGENT_MESSAGE_UNREAD_NOTE}
            </Txt>
          )}
        </View>
      ) : null}
    </View>
  )
}
