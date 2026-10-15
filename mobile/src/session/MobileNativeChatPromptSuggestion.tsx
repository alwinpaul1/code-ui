import { useState, type ReactElement } from 'react'
import { Pressable, Text, View } from 'react-native'
import { CornerDownLeft } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { useCcrPromptSuggestion, type CcrPromptSuggestion } from './ccr-prompt-suggestion'

/**
 * The next-prompt suggestion in the empty composer field (ccr-prompt-suggestion.ts): the words in
 * the field's hint ink where the placeholder would be, at most two lines, two spaces and a small
 * accept pill after them, as the Claude app's k730.e draws it; a tap on the pill fills the field.
 * It lies over the field in the field's own type and padding, so the words sit where typed ones
 * would.
 *
 * Only the pill takes a tap (review 2026-10-15): the box and the words are `box-none`, so a tap
 * anywhere else on the empty field reaches the TextInput below and the user can just type. The
 * lines drawn go to `onLines`, so the field can grow to hold a two-line hint and its pill.
 */
export function MobileNativeChatPromptSuggestion({
  suggestion,
  onFill,
  onLines,
  pad,
  type
}: {
  suggestion: CcrPromptSuggestion
  onFill: (text: string) => void
  onLines: (lines: number) => void
  pad: FieldPad
  type: FieldType
}) {
  const { colors } = useTheme()
  return (
    <View
      testID="composer-prompt-suggestion"
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: pad.top, paddingBottom: pad.bottom, paddingHorizontal: pad.side }}
    >
      <Text
        numberOfLines={2}
        pointerEvents="box-none"
        onTextLayout={(event) => onLines(Math.min(2, Math.max(1, event.nativeEvent.lines.length)))}
        style={{ ...type, color: colors.composerPlaceholder }}
      >
        {suggestion.text}
        {'  '}
        <Pressable
          testID="composer-prompt-suggestion-accept"
          onPress={() => onFill(suggestion.text)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Suggested next prompt: ${suggestion.text}. Double tap to fill.`}
          style={{ borderRadius: 999, borderWidth: 1, borderColor: colors.composerPlaceholder, paddingHorizontal: 5, paddingVertical: 1 }}
        >
          <CornerDownLeft size={12} color={colors.composerPlaceholder} strokeWidth={2} />
        </Pressable>
      </Text>
    </View>
  )
}

type FieldPad = { top: number; bottom: number; side: number }
type FieldType = { fontFamily: string; fontSize: number; lineHeight: number }

/** The composer's side of the suggestion: the overlay to draw over the field (null when none is
 *  offered) and the lines the field must hold for it, 1 when none shows. */
export function useComposerPromptSuggestion(args: { value: string; onFill: (text: string) => void; pad: FieldPad; type: FieldType }): {
  overlay: ReactElement | null
  lines: number
} {
  const suggestion = useCcrPromptSuggestion(args.value)
  // Keyed by the suggestion, so a new one starts at one line until its own layout says otherwise.
  const [drawn, setDrawn] = useState<{ uuid: string; lines: number } | null>(null)
  if (!suggestion) {
    return { overlay: null, lines: 1 }
  }
  const onLines = (lines: number) => setDrawn({ uuid: suggestion.uuid, lines })
  const overlay = <MobileNativeChatPromptSuggestion suggestion={suggestion} onFill={args.onFill} onLines={onLines} pad={args.pad} type={args.type} />
  return { overlay, lines: drawn?.uuid === suggestion.uuid ? drawn.lines : 1 }
}
