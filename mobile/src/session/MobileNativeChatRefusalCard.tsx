import { useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { CCR_REFUSAL_COPY, CCR_REFUSAL_LEARN_MORE_URL, ccrRefusalWords, type CcrRefusalCard } from './ccr-refusal-rows'
import { useCcrRefusalRetry } from './ccr-refusal-retry'

/**
 * A refusal card in a matched Claude tab (ccr-refusal-rows.ts), drawn as the Claude app draws it:
 * the switch notice is one muted line, "Switched to <model>" and "Why?", that opens the reason and
 * "Learn more" (np30.c/b); the paused notice is "Session paused: <reason>" (op30.e). Both end with
 * the category ("Details: [cyber]", ny30.c) and, when the session can be rewound to the refused
 * prompt, "Edit and retry" (ccr-refusal-retry.ts). Colours from the theme; Code UI's own sizes.
 */
export function MobileNativeChatRefusalCard({ card, fontScale = 1 }: { card: CcrRefusalCard; fontScale?: number }) {
  const { colors, space, radius } = useTheme()
  const retry = useCcrRefusalRetry()
  const [open, setOpen] = useState(false)
  const canRetry = retry !== null && card.refusedUuid !== null && card.promptText !== null
  const words = ccrRefusalWords(card, { rewindable: canRetry })
  const details = words.details ? (
    <Txt variant="caption" tone="muted" scale={fontScale} testID="refusal-details">
      {words.details}
    </Txt>
  ) : null
  const retryButton = canRetry ? (
    <Pressable
      accessibilityRole="button"
      testID="refusal-edit-and-retry"
      onPress={() => retry(card)}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.6 : 1
      })}
    >
      <Txt variant="label" weight="semibold" scale={fontScale}>
        {CCR_REFUSAL_COPY.editAndRetry}
      </Txt>
    </Pressable>
  ) : null

  if (card.kind === 'paused') {
    return (
      <View style={{ gap: space.sm }} testID="refusal-card-paused">
        <Txt variant="body" tone="secondary" scale={fontScale} testID="refusal-text">
          <Txt variant="body" weight="semibold" tone="secondary" scale={fontScale}>
            {words.headline}
          </Txt>
          {`: ${words.body}`}
        </Txt>
        {details}
        {retryButton}
      </View>
    )
  }

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <View style={{ gap: space.sm }} testID="refusal-card-fallback">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="refusal-why"
        onPress={() => setOpen((value) => !value)}
        hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 }}
      >
        <Txt variant="body" tone="secondary" scale={fontScale} numberOfLines={2} style={{ flexShrink: 1 }} testID="refusal-text">
          {words.headline}
        </Txt>
        <Chevron size={14} color={colors.textMuted} strokeWidth={2} />
        <Txt variant="body" tone="secondary" scale={fontScale} style={{ textDecorationLine: 'underline' }}>
          {open ? CCR_REFUSAL_COPY.hide : CCR_REFUSAL_COPY.why}
        </Txt>
      </Pressable>
      {open ? (
        <View style={{ gap: space.sm }} testID="refusal-reason">
          <Txt variant="body" tone="secondary" scale={fontScale}>
            {`${words.body} `}
            <Txt
              variant="body"
              tone="secondary"
              scale={fontScale}
              style={{ textDecorationLine: 'underline' }}
              accessibilityRole="link"
              testID="refusal-learn-more"
              onPress={() => void Linking.openURL(CCR_REFUSAL_LEARN_MORE_URL)}
            >
              {CCR_REFUSAL_COPY.learnMore}
            </Txt>
          </Txt>
          {details}
        </View>
      ) : null}
      {retryButton}
    </View>
  )
}
