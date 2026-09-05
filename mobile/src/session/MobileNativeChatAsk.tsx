import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'

type Props = {
  prompt: AskPrompt
  /** Deliver the chosen answer (per-question option indices + free text) —
   *  index-based so Claude's arrow-navigate selector can be driven by the
   *  option's stable number instead of pasted label text (STA-1860). */
  onAnswer: (selections: AskAnswerSelection[]) => Promise<boolean>
  onCancel?: () => Promise<boolean>
}

// Sentinel index for the free-text "Other…" row (never a real option index).
const OTHER = -1

/** Native renderer for an agent's AskUserQuestion prompt as a wizard: one
 *  question per step with tabs across the top, a Next button that advances (Send
 *  on the last step), and a Cancel that dismisses the prompt. */
export function MobileNativeChatAsk({ prompt, onAnswer, onCancel }: Props): React.JSX.Element {
  const { colors, fonts, radius, space, type } = useTheme()
  const [index, setIndex] = useState(0)
  const [selections, setSelections] = useState<number[][]>(() => prompt.questions.map(() => []))
  const [otherText, setOtherText] = useState<string[]>(() => prompt.questions.map(() => ''))
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const toggle = (qi: number, optIndex: number, multi: boolean): void => {
    setSelections((prev) => {
      const next = prev.map((s) => [...s])
      const cur = next[qi] ?? []
      if (multi) {
        next[qi] = cur.includes(optIndex) ? cur.filter((i) => i !== optIndex) : [...cur, optIndex]
      } else {
        next[qi] = cur.includes(optIndex) ? [] : [optIndex]
      }
      return next
    })
  }

  const setOther = (qi: number, value: string): void => {
    setOtherText((prev) => {
      const next = [...prev]
      next[qi] = value
      return next
    })
  }

  const selectionFor = (qi: number): AskAnswerSelection => {
    const picked = (selections[qi] ?? []).filter((i) => i !== OTHER)
    const other = (selections[qi] ?? []).includes(OTHER) ? (otherText[qi] ?? '').trim() : ''
    return other ? { indices: picked, other } : { indices: picked }
  }

  const isAnswered = (qi: number): boolean => {
    const sel = selectionFor(qi)
    return sel.indices.length > 0 || (sel.other ?? '').length > 0
  }

  const total = prompt.questions.length
  const isLast = index === total - 1
  const currentAnswered = useMemo(
    () => isAnswered(index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selections, otherText, index]
  )
  const allAnswered = useMemo(
    () => prompt.questions.every((_, i) => isAnswered(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherText, prompt.questions, selections]
  )
  const canAdvance = !submitting && (isLast ? allAnswered : currentAnswered)

  const submit = async (): Promise<void> => {
    if (!allAnswered || submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onAnswer(prompt.questions.map((_, i) => selectionFor(i)))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const advance = async (): Promise<void> => {
    if (isLast) {
      await submit()
    } else {
      setIndex((i) => Math.min(i + 1, total - 1))
    }
  }

  const cancel = async (): Promise<void> => {
    if (submittingRef.current || !onCancel) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onCancel()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const q = prompt.questions[index]!
  const otherSelected = (selections[index] ?? []).includes(OTHER)

  return (
    <View
      style={{
        maxHeight: 400,
        marginHorizontal: space.md,
        marginBottom: space.xs,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgPanel,
        overflow: 'hidden'
      }}
    >
      {total > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border }}
          contentContainerStyle={{
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            gap: space.sm,
            alignItems: 'center'
          }}
          keyboardShouldPersistTaps="always"
        >
          {prompt.questions.map((qq, i) => {
            const active = i === index
            return (
              <Pressable
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  height: 30,
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  backgroundColor: active ? colors.text : colors.bgRaised
                }}
                onPress={() => setIndex(i)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Txt
                  variant="caption"
                  weight="semibold"
                  numberOfLines={1}
                  style={{ color: active ? colors.textInverse : colors.textSecondary }}
                >
                  {qq.header || `Step ${i + 1}`}
                </Txt>
                {isAnswered(i) ? (
                  <Check size={11} color={active ? colors.textInverse : colors.success} strokeWidth={3} />
                ) : null}
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        style={{ paddingHorizontal: space.lg }}
        contentContainerStyle={{ paddingBottom: space.sm }}
        keyboardShouldPersistTaps="always"
      >
        <Txt variant="heading" weight="semibold" style={{ marginVertical: space.md }}>
          {q.question}
        </Txt>
        {q.options.map((opt, optIndex) => (
          <OptionRow
            key={`${optIndex}:${opt.label}`}
            label={opt.label}
            description={opt.description}
            selected={(selections[index] ?? []).includes(optIndex)}
            multi={q.multiSelect}
            onPress={() => toggle(index, optIndex, q.multiSelect)}
          />
        ))}
        <OptionRow
          label="Other…"
          selected={otherSelected}
          multi={q.multiSelect}
          onPress={() => toggle(index, OTHER, q.multiSelect)}
        />
        {otherSelected ? (
          <TextInput
            style={{
              backgroundColor: colors.bgRaised,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              color: colors.text,
              fontFamily: fonts.regular,
              fontSize: type.body.size,
              padding: space.md,
              minHeight: 46,
              marginBottom: space.xs
            }}
            value={otherText[index]}
            onChangeText={(v) => setOther(index, v)}
            placeholder="Type your answer"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            multiline
            autoFocus
          />
        ) : null}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: space.md,
          paddingVertical: space.sm + 2,
          gap: space.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border
        }}
      >
        <Button label="Cancel" variant="ghost" size="sm" disabled={submitting} onPress={() => void cancel()} />
        {total > 1 ? (
          <Txt variant="caption" tone="muted">
            {index + 1}/{total}
          </Txt>
        ) : null}
        <Button
          label={isLast ? 'Submit' : 'Next'}
          variant="accent"
          size="sm"
          disabled={!canAdvance}
          onPress={() => void advance()}
        />
      </View>
    </View>
  )
}

function OptionRow({
  label,
  description,
  selected,
  multi,
  onPress
}: {
  label: string
  description?: string
  selected: boolean
  multi?: boolean
  onPress: () => void
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  return (
    <Pressable
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm + 2,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.bgSunken : colors.bgRaised,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        marginBottom: space.xs + 2
      })}
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
    >
      {/* Multi-select reads as a checkbox (square); single-select as a radio (circle). */}
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: multi ? 6 : 10,
          borderWidth: 1.5,
          borderColor: selected ? colors.accent : colors.textMuted,
          backgroundColor: selected ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {selected ? <Check size={12} color={colors.onAccent} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body" weight="medium">
          {label}
        </Txt>
        {description ? (
          <Txt variant="caption" tone="secondary" numberOfLines={3}>
            {description}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  )
}
