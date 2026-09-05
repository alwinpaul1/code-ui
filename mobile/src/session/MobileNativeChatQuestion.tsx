import { useMemo, useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { ArrowUp, Check, CircleHelp } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import {
  formatQuestionAnswer,
  formatQuestionFreeTextAnswer,
  type MobileChatQuestion
} from './mobile-native-chat-question'

type Props = {
  question: MobileChatQuestion
  onAnswer: (text: string) => Promise<boolean>
}

/** Renders an agent's choice prompt as a tappable card. Single-select answers
 *  on tap; multi-select toggles then Submits; an always-present text entry lets
 *  the user answer freely (the escape hatch) when the heuristic misreads the
 *  options or none apply. */
export function MobileNativeChatQuestion({ question, onAnswer }: Props): React.JSX.Element {
  const { colors, fonts, radius, space, type } = useTheme()
  const [selected, setSelected] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const allowOther = question.allowOther !== false

  const hasOptions = question.options.length > 0
  const trimmedFreeText = freeText.trim()

  const toggle = (option: string): void => {
    setSelected((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    )
  }

  const sendAnswer = async (text: string): Promise<boolean> => {
    if (sendingRef.current) {
      return false
    }
    sendingRef.current = true
    setSending(true)
    try {
      return await onAnswer(text)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const answerSingle = async (option: string, optionIndex: number): Promise<void> => {
    const token = question.optionTokens[optionIndex]
    await sendAnswer(token && token.length > 0 ? token : formatQuestionAnswer(question, [option]))
  }

  const submitMulti = async (): Promise<void> => {
    if (selected.length === 0) {
      return
    }
    await sendAnswer(formatQuestionAnswer(question, selected))
  }

  const submitFreeText = async (): Promise<void> => {
    if (trimmedFreeText.length === 0) {
      return
    }
    if (await sendAnswer(formatQuestionFreeTextAnswer(question, trimmedFreeText))) {
      setFreeText('')
    }
  }

  const canSubmitMulti = selected.length > 0 && !sending
  const canSendFreeText = allowOther && trimmedFreeText.length > 0 && !sending

  // Stable keys for option rows even if an agent repeats a label.
  const optionRows = useMemo(
    () => question.options.map((label, index) => ({ label, key: `${index}:${label}` })),
    [question.options]
  )

  return (
    <View
      style={{
        marginHorizontal: space.md,
        marginVertical: space.sm,
        padding: space.lg,
        gap: space.md,
        backgroundColor: colors.bgPanel,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <CircleHelp
          size={16}
          color={colors.accentText}
          strokeWidth={2.2}
          style={{ marginTop: 3 }}
        />
        <Txt variant="heading" weight="semibold" style={{ flex: 1 }}>
          {question.question}
        </Txt>
      </View>

      {hasOptions ? (
        <View style={{ gap: space.xs + 2 }}>
          {optionRows.map(({ label, key }, optIndex) => {
            const isSelected = selected.includes(label)
            return (
              <Pressable
                key={key}
                accessibilityRole={question.multiSelect ? 'checkbox' : 'button'}
                accessibilityState={question.multiSelect ? { checked: isSelected } : undefined}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  minHeight: 46,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  backgroundColor: pressed ? colors.bgSunken : colors.bgRaised,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: isSelected ? colors.accent : colors.border
                })}
                onPress={() =>
                  question.multiSelect ? toggle(label) : answerSingle(label, optIndex)
                }
              >
                {question.multiSelect ? (
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      borderWidth: 1.5,
                      borderColor: isSelected ? colors.accent : colors.textMuted,
                      backgroundColor: isSelected ? colors.accent : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {isSelected ? <Check size={13} color={colors.onAccent} strokeWidth={3} /> : null}
                  </View>
                ) : null}
                <Txt variant="body" style={{ flex: 1 }}>
                  {label}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {question.multiSelect && hasOptions ? (
        <Button
          label={`Submit${selected.length > 0 ? ` (${selected.length})` : ''}`}
          accessibilityLabel="Submit selected options"
          variant="accent"
          block
          disabled={!canSubmitMulti}
          onPress={() => void submitMulti()}
        />
      ) : null}

      {allowOther ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <TextInput
            style={{
              flex: 1,
              minHeight: 42,
              maxHeight: 120,
              color: colors.text,
              fontFamily: fonts.regular,
              fontSize: type.body.size,
              backgroundColor: colors.bgRaised,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: space.md,
              paddingTop: space.sm + 2,
              paddingBottom: space.sm + 2
            }}
            value={freeText}
            onChangeText={setFreeText}
            placeholder={hasOptions ? 'Or type a reply…' : 'Type your reply…'}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            onSubmitEditing={submitFreeText}
            returnKeyType="send"
            multiline
          />
          <Pressable
            accessibilityLabel="Send reply"
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: canSendFreeText ? colors.accent : colors.bgRaised,
              opacity: pressed && canSendFreeText ? 0.8 : 1
            })}
            onPress={submitFreeText}
            disabled={!canSendFreeText}
          >
            <ArrowUp
              size={18}
              color={canSendFreeText ? colors.onAccent : colors.textMuted}
              strokeWidth={2.6}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
