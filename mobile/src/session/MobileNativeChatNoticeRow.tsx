import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react-native'
import type { NativeChatTextBlock } from '../../../src/shared/native-chat-types'
import { isAgentSessionProviderContextBoundary } from '../../../src/shared/agent-session-provider-context'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { useTheme, type Theme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

export const NATIVE_CHAT_NOTICE_COPY = {
  compaction: 'Context compacted',
  contextCleared: 'Context cleared',
  plan: 'Plan'
} as const

// The rule lives in a module with no React Native in it, so the turn reader
// (mobile-native-chat-turn-end.ts) can ask it too.
export { isRenderableNativeChatNotice } from './mobile-native-chat-notice-kind'

/** A host-authored notice: a compaction boundary, a plan document, or a toned
 *  line. Desktop parity: `NativeChatNoticeRow`. */
export function MobileNativeChatNoticeRow({
  block,
  fontScale = 1,
  onOpenFile
}: {
  block: NativeChatTextBlock
  fontScale?: number
  onOpenFile?: (relativePath: string) => void
}) {
  const theme = useTheme()
  const styles = useMemo(() => makeNoticeStyles(theme), [theme])

  // A /clear keeps the chat (Orca #26579): one divider where the agent's context restarted, the
  // earlier messages left above it. Drawn as the compaction rule is, in the host's words.
  const cleared = isAgentSessionProviderContextBoundary(block.contextClear)
  if (cleared || block.presentation === 'compaction') {
    // A rule, not a sentence: compaction is a break in the conversation, and a
    // line of prose there reads as something the agent said.
    const label = cleared
      ? block.text.trim() || NATIVE_CHAT_NOTICE_COPY.contextCleared
      : NATIVE_CHAT_NOTICE_COPY.compaction
    return (
      <View style={styles.compaction} accessibilityRole="none" accessibilityLabel={label}>
        <View style={styles.rule} />
        <Txt variant="caption" tone="muted">
          {label}
        </Txt>
        <View style={styles.rule} />
      </View>
    )
  }

  if (block.presentation === 'plan-document') {
    return (
      <View style={styles.card}>
        <Txt variant="caption" weight="semibold" tone="secondary">
          {NATIVE_CHAT_NOTICE_COPY.plan}
        </Txt>
        <MobileMarkdown
          content={block.text}
          textScale={fontScale}
          onOpenFile={onOpenFile}
          typography={TRANSCRIPT_MARKDOWN_TYPOGRAPHY}
          widthKey="chat-plan"
        />
      </View>
    )
  }

  const Icon =
    block.tone === 'warning'
      ? AlertTriangle
      : block.tone === 'error'
        ? AlertCircle
        : block.tone === 'notice'
          ? Info
          : null
  const tone = block.tone === 'warning' ? 'warning' : block.tone === 'error' ? 'danger' : 'muted'
  const iconColor =
    block.tone === 'warning'
      ? theme.colors.warning
      : block.tone === 'error'
        ? theme.colors.danger
        : theme.colors.textMuted
  return (
    <View style={Icon ? styles.toned : undefined}>
      {Icon ? <Icon size={14} color={iconColor} strokeWidth={2} /> : null}
      <Txt variant="body" tone={tone} style={styles.tonedText}>
        {block.text}
      </Txt>
    </View>
  )
}

function makeNoticeStyles({ colors, radius, space }: Theme) {
  return StyleSheet.create({
    compaction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.xs
    },
    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border
    },
    card: {
      gap: space.xs,
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised
    },
    toned: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.sm,
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgRaised
    },
    tonedText: {
      flex: 1
    }
  })
}
