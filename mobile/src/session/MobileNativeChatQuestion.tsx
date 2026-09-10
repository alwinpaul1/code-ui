import { useMemo, useRef, useState } from 'react'
import { notificationPlainText } from '../notifications/notification-plain-text'
import { Pressable, TextInput, View } from 'react-native'
import { ArrowUp, Check, CircleHelp } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import {
  formatQuestionAnswerByIndexes,
  formatQuestionAnswerWithOtherByIndexes,
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
  const [selectedOptionIndexes, setSelectedOptionIndexes] = useState<number[]>([])
  const [freeText, setFreeText] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const allowOther = question.allowOther !== false

  const hasOptions = question.options.length > 0
  const trimmedFreeText = freeText.trim()

  // Keyed by position, not by label: an agent may repeat a label inside one
  // question, and label-keyed selection makes both rows toggle as one.
  const toggle = (optionIndex: number): void => {
    setSelectedOptionIndexes((prev) =>
      prev.includes(optionIndex)
        ? prev.filter((index) => index !== optionIndex)
        : [...prev, optionIndex]
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

  const answerSingle = async (optionIndex: number): Promise<void> => {
    const token = question.optionTokens[optionIndex]
    await sendAnswer(
      token && token.length > 0 ? token : formatQuestionAnswerByIndexes(question, [optionIndex])
    )
  }

  const submitMulti = async (): Promise<void> => {
    if (selectedOptionIndexes.length === 0) {
      return
    }
    const answer =
      question.freeTextToken && trimmedFreeText.length > 0
        ? formatQuestionAnswerWithOtherByIndexes(question, selectedOptionIndexes, trimmedFreeText)
        : formatQuestionAnswerByIndexes(question, selectedOptionIndexes)
    if (await sendAnswer(answer)) {
      setFreeText('')
    }
  }

  const submitFreeText = async (): Promise<void> => {
    if (trimmedFreeText.length === 0) {
      return
    }
    const answer =
      question.multiSelect && question.freeTextToken && selectedOptionIndexes.length > 0
        ? formatQuestionAnswerWithOtherByIndexes(question, selectedOptionIndexes, trimmedFreeText)
        : formatQuestionFreeTextAnswer(question, trimmedFreeText)
    if (await sendAnswer(answer)) {
      setFreeText('')
    }
  }

  const canSubmitMulti = selectedOptionIndexes.length > 0 && !sending
  const canSendFreeText = allowOther && trimmedFreeText.length > 0 && !sending

  // Stable keys for option rows even if an agent repeats a label.
  const optionRows = useMemo(
    () =>
      question.options.map((label, index) => ({
        label,
        description: question.optionDescriptions?.[index],
        key: `${index}:${label}`
      })),
    [question.optionDescriptions, question.options]
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
          {notificationPlainText(question.question)}
        </Txt>
      </View>

      {hasOptions ? (
        <View style={{ gap: space.xs + 2 }}>
          {optionRows.map(({ label, description, key }, optIndex) => {
            const isSelected = selectedOptionIndexes.includes(optIndex)
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
                onPress={() => (question.multiSelect ? toggle(optIndex) : answerSingle(optIndex))}
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
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="body">{notificationPlainText(label)}</Txt>
                  {description ? (
                    <Txt variant="caption" tone="muted" numberOfLines={2}>
                      {notificationPlainText(description)}
                    </Txt>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {question.multiSelect && hasOptions ? (
        <Button
          label={`Submit${selectedOptionIndexes.length > 0 ? ` (${selectedOptionIndexes.length})` : ''}`}
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
