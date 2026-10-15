import { useMemo, useRef, useState } from 'react'
import { notificationPlainText } from '../notifications/notification-plain-text'
import { ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react-native'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { OptionRow, OtherRow, PagerButton, Rule } from './MobileNativeChatAskRows'
import {
  ASK_SENT_WAITING_LINE,
  useSentWaitElapsed
} from './mobile-native-chat-ask-sent-wait'

export { ASK_OTHER_LABEL } from './MobileNativeChatAskRows'
export { ASK_SENT_WAIT_MS, ASK_SENT_WAITING_LINE } from './mobile-native-chat-ask-sent-wait'

type Props = {
  prompt: AskPrompt
  /** Deliver the chosen answer (per-question option indices + free text) —
   *  index-based so Claude's arrow-navigate selector can be driven by the
   *  option's stable number instead of pasted label text (STA-1860). */
  onAnswer: (selections: AskAnswerSelection[]) => Promise<boolean>
  onCancel?: () => Promise<boolean>
  /** When the controller recorded this card's answer as accepted, so the sent
   *  state survives the card remounting (a chat↔terminal toggle). */
  sentAt?: number | null
}

/** How far the choices fade once a single-select answer is typed in the free
 *  row, as the Claude app's card fades them: the typed words are the answer. */
const DIMMED_CHOICE_OPACITY = 0.4
/** The rows that were not chosen, once the answer is on its way (dc5.java:2298). */
const LOCKED_ROW_OPACITY = 0.38
/** The card's corner: bn7.j, 24 dp (zlw.java:16). */
const ASK_CARD_RADIUS = 24


/** Native renderer for an agent's AskUserQuestion prompt, drawn as the Claude
 *  app 1.261009.20 draws its question card (dc5.java; the numbers are in
 *  ask-card-claude-look.test.tsx): one question per page, a "1 of N" pager with
 *  chevrons in the header (no header chip, no tabs), numbered rows or
 *  checkboxes, a "Something else" field in the last row, and a footer with Next
 *  (Submit on the last page). A tap on an option only chooses it; nothing reaches
 *  the agent until Submit, which sends every page's answer at once. Desktop moves
 *  on by itself after a single-select pick (Orca #26288); the phone does not,
 *  because on the last page that move was the submit and the user lost the chance
 *  to change their mind (2026-10-13). The Claude app behaves the same way.
 *
 *  Not the Claude app's: it has Skip beside Next, which clears the page's answer
 *  ("[No preference]"). Claude Code's own picker cannot be driven to "no answer"
 *  with keys, so that slot holds Cancel, which writes Escape. */
export function MobileNativeChatAsk({ prompt, onAnswer, onCancel, sentAt = null }: Props): React.JSX.Element {
  const { colors, space } = useTheme()
  // 400 was a fixed guess: with the keyboard up on a short phone it grew the
  // dock past the viewport and clipped the card's own question off the top,
  // with nothing to scroll. The dock is bottom-anchored and has no cap of its
  // own, so the card carries one that follows the screen.
  const { height: windowHeight } = useWindowDimensions()
  const cardMaxHeight = Math.max(240, Math.min(400, Math.round(windowHeight * 0.52)))
  const [index, setIndex] = useState(0)
  const [selections, setSelections] = useState<number[][]>(() => prompt.questions.map(() => []))
  const [otherText, setOtherText] = useState<string[]>(() => prompt.questions.map(() => ''))
  // The row under a finger, so the rules beside it can let go (dc5.java j()).
  const [pressedRow, setPressedRow] = useState<number | null>(null)
  const [busy, setBusy] = useState<'sending' | 'cancelling' | null>(null)
  const busyRef = useRef(false)
  const otherInputRef = useRef<TextInput | null>(null)
  // Once the host accepts the answer the card never takes another: a second
  // send types into whatever the agent draws next (a Bash approval reads a
  // digit as its answer). The controller's record covers a remount; this
  // covers the rest.
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null)
  const answeredAt = sentAt ?? acceptedAt
  const waitingLong = useSentWaitElapsed(answeredAt)
  const locked = busy !== null || answeredAt !== null

  // A tap only chooses: it never turns the page and never sends. Multi-select
  // toggles the row; single-select is a radio, so a tap makes that row the
  // choice, tapping the chosen row again keeps it, and the words typed in the
  // free row are let go (a62.java:186-193: a pick clears the typed text).
  const toggle = (qi: number, optIndex: number, multi: boolean): void => {
    // The ref as well as `locked`: a tap can land before the render that disables the rows.
    if (locked || busyRef.current) {
      return
    }
    setSelections((prev) =>
      prev.map((cur, i) => {
        if (i !== qi) {
          return cur
        }
        if (!multi) {
          return [optIndex]
        }
        return cur.includes(optIndex) ? cur.filter((o) => o !== optIndex) : [...cur, optIndex]
      })
    )
    if (!multi) {
      setOtherText((prev) => prev.map((cur, i) => (i === qi ? '' : cur)))
    }
  }

  // Typing in the free row is the choice of it: on a single-select card the
  // picked option is let go (a62.java:197-203), on a multi-select card the
  // picks stay beside the typed words.
  const setOther = (qi: number, value: string, multi: boolean): void => {
    setOtherText((prev) => {
      const next = [...prev]
      next[qi] = value
      return next
    })
    if (!multi && value.trim().length > 0) {
      setSelections((prev) => prev.map((cur, i) => (i === qi ? [] : cur)))
    }
  }

  const selectionFor = (qi: number): AskAnswerSelection => {
    const picked = selections[qi] ?? []
    const other = (otherText[qi] ?? '').trim()
    return other ? { indices: picked, other } : { indices: picked }
  }

  const isAnswered = (qi: number): boolean => {
    const answer = selectionFor(qi)
    return answer.indices.length > 0 || (answer.other ?? '').length > 0
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
  const canAdvance = !locked && (isLast ? allAnswered : currentAnswered)

  const submit = async (): Promise<void> => {
    if (!prompt.questions.every((_, i) => isAnswered(i)) || busyRef.current || answeredAt !== null) {
      return
    }
    busyRef.current = true
    setBusy('sending')
    let accepted = false
    try {
      accepted = await onAnswer(prompt.questions.map((_, i) => selectionFor(i)))
    } finally {
      // A refusal has already said why (the send path reports every false), so
      // the tap goes back at once. An accepted answer keeps the ref held.
      if (accepted) {
        setAcceptedAt(Date.now())
      } else {
        busyRef.current = false
      }
      setBusy(null)
    }
  }

  // Next only turns the page; the last page's Submit is the one send.
  const advance = async (): Promise<void> => {
    if (isLast) {
      await submit()
    } else if (!locked) {
      setIndex((i) => Math.min(i + 1, total - 1))
    }
  }

  const cancel = async (): Promise<void> => {
    if (busyRef.current || answeredAt !== null || !onCancel) {
      return
    }
    busyRef.current = true
    setBusy('cancelling')
    try {
      await onCancel()
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const q = prompt.questions[index]!
  const picked = selections[index] ?? []
  const typed = (otherText[index] ?? '').trim()
  const otherSelected = typed.length > 0
  // A typed single-select answer replaces the choices, so they step back. A
  // multi-select one is sent beside them, so they keep their strength.
  const choicesDimmed = !q.multiSelect && otherSelected
  const selectedCount = picked.length + (otherSelected ? 1 : 0)
  // Once the answer is on its way the chosen rows stay whole and the rest sink
  // (dc5.java:2298 i()).
  const rowOpacity = (selected: boolean, dimmed: boolean): number => {
    if (locked) {
      return selected ? 1 : LOCKED_ROW_OPACITY
    }
    return dimmed ? DIMMED_CHOICE_OPACITY : 1
  }
  // The rule between two rows lets go while either is pressed.
  const ruleHidden = (above: number): boolean => pressedRow === above || pressedRow === above + 1
  const otherRowIndex = q.options.length

  return (
    <View
      style={{
        maxHeight: cardMaxHeight,
        marginHorizontal: space.md,
        marginBottom: space.xs,
        borderRadius: ASK_CARD_RADIUS,
        backgroundColor: colors.askCardFill,
        overflow: 'hidden'
      }}
    >
      {/* Header (dc5.java f()): the question, and the pager when there is more than one. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 16,
          paddingTop: 12,
          // The chevron's 36 dp target sits 8 dp inside the 16 dp edge.
          paddingRight: total > 1 ? 8 : 16,
          paddingBottom: 6
        }}
      >
        <Txt variant="body" style={{ flex: 1, color: colors.askText }} accessibilityRole="header">
          {notificationPlainText(q.question)}
        </Txt>
        {total > 1 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginLeft: 8,
              // The targets are 36 dp around a 20 dp glyph: pull the group back into the text line.
              marginVertical: -8
            }}
          >
            <PagerButton
              label="Previous question"
              disabled={locked || index === 0}
              onPress={() => setIndex((i) => Math.max(i - 1, 0))}
            >
              <ChevronLeft size={20} color={colors.askMuted} strokeWidth={2} />
            </PagerButton>
            <Txt
              variant="body"
              style={{ color: colors.askMuted }}
              accessibilityLabel={`Question ${index + 1} of ${total}`}
            >
              {`${index + 1} of ${total}`}
            </Txt>
            <PagerButton
              label="Next question"
              disabled={locked || isLast}
              onPress={() => setIndex((i) => Math.min(i + 1, total - 1))}
            >
              <ChevronRight size={20} color={colors.askMuted} strokeWidth={2} />
            </PagerButton>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ padding: 6 }}
        keyboardShouldPersistTaps="always"
      >
        {q.options.map((opt, optIndex) => {
          const selected = picked.includes(optIndex)
          return (
            <View key={`${optIndex}:${opt.label}`}>
              {optIndex > 0 ? <Rule hidden={ruleHidden(optIndex - 1)} /> : null}
              <OptionRow
                label={opt.label}
                description={opt.description}
                number={optIndex < 9 ? optIndex + 1 : null}
                selected={selected}
                multi={q.multiSelect}
                disabled={locked}
                opacity={rowOpacity(selected, choicesDimmed)}
                onPressedChange={(down) => setPressedRow(down ? optIndex : null)}
                onPress={() => toggle(index, optIndex, q.multiSelect)}
              />
            </View>
          )
        })}
        {q.options.length > 0 ? <Rule hidden={ruleHidden(q.options.length - 1)} /> : null}
        <OtherRow
          value={otherText[index] ?? ''}
          selected={otherSelected}
          multi={q.multiSelect}
          disabled={locked}
          opacity={rowOpacity(otherSelected, false)}
          isLast={isLast}
          inputRef={otherInputRef}
          onPressedChange={(down) => setPressedRow(down ? otherRowIndex : null)}
          onChangeText={(v) => setOther(index, v, q.multiSelect)}
          onSubmit={() => {
            if (canAdvance) {
              void advance()
            }
          }}
        />
      </ScrollView>

      <View style={{ height: 1, backgroundColor: colors.askDivider }} />
      {/* Footer (dc5.java d()): the count on the left, then the actions. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 48,
          paddingLeft: 20,
          paddingTop: 6,
          paddingRight: 16,
          paddingBottom: 6,
          gap: 8
        }}
      >
        <View style={{ flex: 1 }}>
          {answeredAt !== null ? (
            // Sent: Cancel would write Escape into a turn the agent may already
            // have started, so it goes, and the slot says what the card waits on.
            <Txt variant="label" style={{ color: colors.askLabel }} accessibilityLiveRegion="polite">
              {waitingLong ? ASK_SENT_WAITING_LINE : ''}
            </Txt>
          ) : q.multiSelect ? (
            // question_card_selected_count: the same words for one and many.
            <Txt variant="label" style={{ color: colors.askMuted }}>
              {`${selectedCount} selected`}
            </Txt>
          ) : null}
        </View>
        {answeredAt === null ? (
          <Button label="Cancel" variant="ghost" size="sm" disabled={locked} onPress={() => void cancel()} />
        ) : null}
        {answeredAt === null ? (
          <Button
            label={busy === 'sending' ? 'Sending…' : isLast ? 'Submit' : 'Next'}
            variant="accent"
            size="sm"
            // Next is the ink pill, Submit the clay one (kf4, gf4).
            style={{ backgroundColor: isLast ? colors.askSubmitFill : colors.askNextFill }}
            labelColor={isLast ? colors.askSubmitLabel : colors.askNextLabel}
            // While sending the spinner is the feedback; Button keeps a loading
            // one pressable-dead without dimming it to look like a missed tap.
            disabled={!canAdvance && busy !== 'sending'}
            loading={busy === 'sending'}
            onPress={() => void advance()}
          />
        ) : (
          // A status, not a dead button: a disabled Button paints at half
          // strength, and this is the one word on the card the user must read.
          <View
            testID="ask-sent"
            accessible
            accessibilityLabel="Answer sent"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              height: 36,
              paddingHorizontal: space.md,
              borderRadius: 999
            }}
          >
            <Check size={14} color={colors.success} strokeWidth={2.6} />
            <Txt variant="label" weight="semibold" style={{ color: colors.askLabel }}>
              Sent
            </Txt>
          </View>
        )}
      </View>
    </View>
  )
}
