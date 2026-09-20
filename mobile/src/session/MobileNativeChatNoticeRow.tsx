import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react-native'
import type { NativeChatTextBlock } from '../../../src/shared/native-chat-types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { useTheme, type Theme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { PEER_MESSAGE_PRESENTATION, peerMessageLabelAndBody } from './mobile-native-chat-peer-messages'
import { PEER_NOTICE_PRESENTATION } from './screen-peer-notices'

export const NATIVE_CHAT_NOTICE_COPY = {
  compaction: 'Context compacted',
  plan: 'Plan'
} as const

/** Whether a text block carries display hints this build knows how to draw. A
 *  hint from a newer host falls through to ordinary prose rather than to a
 *  blank row — the text is always readable on its own. */
export function isRenderableNativeChatNotice(block: NativeChatTextBlock): boolean {
  return (
    block.presentation === 'compaction' ||
    block.presentation === 'plan-document' ||
    block.presentation === PEER_MESSAGE_PRESENTATION ||
    block.presentation === PEER_NOTICE_PRESENTATION ||
    block.tone === 'warning' ||
    block.tone === 'error' ||
    block.tone === 'notice'
  )
}

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

  if (block.presentation === 'compaction') {
    // A rule, not a sentence: compaction is a break in the conversation, and a
    // line of prose there reads as something the agent said.
    return (
      <View
        style={styles.compaction}
        accessibilityRole="none"
        accessibilityLabel={NATIVE_CHAT_NOTICE_COPY.compaction}
      >
        <View style={styles.rule} />
        <Txt variant="caption" tone="muted">
          {NATIVE_CHAT_NOTICE_COPY.compaction}
        </Txt>
        <View style={styles.rule} />
      </View>
    )
  }

  // A message from another session or a subagent: the sender on top, the
  // message as it was written. A card like the plan's, not a user bubble:
  // nobody here typed it (mobile-native-chat-peer-messages.ts).
  if (block.presentation === PEER_MESSAGE_PRESENTATION) {
    const { label, body } = peerMessageLabelAndBody(block.text)
    return (
      <View style={styles.card} accessibilityLabel={label} testID="native-chat-peer-message">
        <Txt variant="caption" weight="semibold" tone="secondary">
          {label}
        </Txt>
        <MobileMarkdown content={body} textScale={fontScale} onOpenFile={onOpenFile} />
      </View>
    )
  }

  // A peer message the agent's screen announced but the transcript never
  // carried: who wrote, and nothing more, because that is all the phone knows
  // (screen-peer-notices.ts). One muted line, like the compaction rule.
  if (block.presentation === PEER_NOTICE_PRESENTATION) {
    return (
      <View style={styles.compaction} accessibilityLabel={block.text} testID="native-chat-peer-notice">
        <View style={styles.rule} />
        <Txt variant="caption" tone="muted">
          {block.text}
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
        <MobileMarkdown content={block.text} textScale={fontScale} onOpenFile={onOpenFile} />
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
