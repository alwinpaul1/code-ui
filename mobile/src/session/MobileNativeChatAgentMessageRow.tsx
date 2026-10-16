import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { claudeToolRunPalette } from '../theme/claude-tool-run-palette'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import { TOOL_RUN_ROW } from './claude-tool-run-row-spec'
import { receivedMessageHeading, receivedMessageSender, receivedMessageTitle } from './mobile-received-message-sender'

/** What the opened sheet says when only the TUI's row reached the phone: the
 *  sender, and no words (a tab launched without the prompt hook). */
export const AGENT_MESSAGE_UNREAD_NOTE =
  'Only the sender reached the phone. To read the message, expand this row in the desktop terminal (ctrl+o).'

/** What the opened sheet says under words that are only the start of the message
 *  (the hook's 2,000 bytes, the tab status's 200 characters). */
export const AGENT_MESSAGE_CUT_NOTE =
  'Only the start of this message reached the phone. The rest is in the desktop terminal (ctrl+o).'

/**
 * A message a subagent sent this session, drawn as the Claude app 1.261009.20
 * draws a received message: one row, "Received message from <name>"
 * (`ccr_received_message_from`), with the name in the strong ink and checked
 * first (mobile-received-message-sender.ts), and the chevron of a finished
 * run. A tap opens a sheet titled "Message" (`ccr_received_message_title`)
 * headed "From: <name>", with the message under it. Not a bubble: the user did
 * not write it, and neither did the agent this chat is with
 * (mobile-native-chat-agent-messages.ts). A subagent's hand-back is never
 * drawn at all (mobile-native-chat-agent-message-rows.ts).
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
  const { colors, space, scheme } = useTheme()
  const toolRun = claudeToolRunPalette(scheme)
  const [open, setOpen] = useState(false)
  const name = receivedMessageSender(sender)
  const title = receivedMessageTitle(name)
  return (
    <View style={styles.row} testID="native-chat-agent-message">
      <Pressable
        style={styles.toolRunToggle}
        onPress={() => setOpen(true)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint="Opens the message"
      >
        {/* Hugs its words, as a finished run's sentence does, so the chevron
            follows them rather than sitting at the far end of the row. */}
        <Text style={[styles.toolRunLabel, styles.toolRunSentence]} numberOfLines={1}>
          {name === null
            ? title
            : [
                'Received message from ',
                <Text key="name" style={{ color: colors.text }}>
                  {name}
                </Text>
              ]}
        </Text>
        <ChevronRight size={TOOL_RUN_ROW.chevronSize} color={toolRun.text} strokeWidth={2} />
      </Pressable>
      <BottomDrawer
        visible={open}
        onClose={() => setOpen(false)}
        dragContentToDismiss
        header={<MobileSheetTitleBar title="Message" onClose={() => setOpen(false)} />}
      >
        <View style={{ gap: space.sm, paddingBottom: space.md }} testID="native-chat-agent-message-body">
          <Txt variant="caption" tone="secondary" scale={fontScale}>
            {receivedMessageHeading(name)}
          </Txt>
          {body.trim().length > 0 ? (
            <>
              <MobileMarkdown
                content={body}
                textScale={fontScale}
                onOpenFile={onOpenFile}
                typography={TRANSCRIPT_MARKDOWN_TYPOGRAPHY}
                widthKey="chat-agent-message"
              />
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
      </BottomDrawer>
    </View>
  )
}
