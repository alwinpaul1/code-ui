import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Brain, ChevronRight } from 'lucide-react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import type { ChatMessageStyles } from './mobile-native-chat-message-styles'
import { nativeChatMessageText } from './mobile-native-chat-message-text'
import { MobileNativeChatThinkingSheet, THOUGHT_PROCESS_LABEL } from './MobileNativeChatThinkingSheet'

/**
 * A `reasoning` message, drawn the way the Claude app 1.261009.20 draws
 * thinking: never inline, but one row like a finished tool run, a glyph and
 * "Thought process" in the run's muted words, and a tap opens the thinking in
 * a sheet (MobileNativeChatThinkingSheet). Until 2026-10-12 the words sat in
 * the transcript beside a rail, folded past 600 characters.
 *
 * A thought reaches the phone from the structured lane and from Codex and
 * Grok terminal tabs whose rollout carries a summary. A terminal Claude tab
 * sends none: Orca's reader makes a thinking block assistant text.
 */
export function MobileNativeChatReasoningNote({
  message,
  fontScale,
  onOpenFile,
  styles
}: {
  message: NativeChatMessage
  fontScale: number
  onOpenFile?: (relativePath: string) => void
  styles: ChatMessageStyles
}) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const text = nativeChatMessageText(message.blocks).trim()
  if (!text) {
    return null
  }
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.toolRunToggle}
        onPress={() => setOpen(true)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={THOUGHT_PROCESS_LABEL}
        accessibilityHint="Opens the thinking"
      >
        <Brain size={14} color={colors.textMuted} strokeWidth={2} />
        <Text style={[styles.toolRunLabel, styles.toolRunSentence]} numberOfLines={1}>
          {THOUGHT_PROCESS_LABEL}
        </Text>
        <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
      </Pressable>
      <MobileNativeChatThinkingSheet
        visible={open}
        text={text}
        fontScale={fontScale}
        onOpenFile={onOpenFile}
        onClose={() => setOpen(false)}
      />
    </View>
  )
}
