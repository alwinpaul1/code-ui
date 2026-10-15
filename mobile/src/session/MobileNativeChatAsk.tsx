import { useMemo, useRef, useState } from 'react'
import { notificationPlainText } from '../notifications/notification-plain-text'
import { ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react-native'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { OptionRow, OtherRow, PagerButton, Rule, SendButton } from './MobileNativeChatAskRows'
import {
  ASK_CARD_RADIUS,
  ASK_FOOTER,
  ASK_SKIP_LABEL,
  askCardMaxHeight
} from './ask-card-claude-app-spec'
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
  /** How much of the window the keyboard takes (the chat view's inset). The
   *  window does not shrink for it, so the card's cap must. */
  keyboardInset?: number
  /** Set when declining must not write Escape (the agent is working and the
   *  question is the transcript's copy alone): Skip with nothing answered then
   *  says this in the footer instead of declining. */
  declineRefusal?: string | null
  /** The composer is still drawn under the card, so the card keeps the
   *  smaller cap it had beside one (askCardMaxHeight). */
  besideComposer?: boolean
}

/** How far the choices fade once a single-select answer is typed in the free
 *  row, as the Claude app's card fades them: the typed words are the answer. */
const DIMMED_CHOICE_OPACITY = 0.4
/** The rows that were not chosen, once the answer is on its way (dc5.java:2298). */
const LOCKED_ROW_OPACITY = 0.38

/** Native renderer for an agent's AskUserQuestion prompt, drawn as the Claude
 *  app 1.261013.20 draws its question card (dc5.java; the numbers are in
 *  ask-card-claude-app-spec.ts and ask-card-claude-look.test.tsx): one question
 *  per page inside a hairline edge, a "1 of N" pager with chevrons in the header
 *  (no header chip, no tabs), numbered rows or checkboxes, a "Something else"
 *  field in the last row, and a footer with the count, an outlined Skip and a
 *  round arrow that turns the page (Next) or sends (Submit on the last page). A
 *  tap on an option only chooses it; nothing reaches the agent until Submit,
 *  which sends every page's answer at once. Desktop moves on by itself after a
 *  single-select pick (Orca #26288); the phone does not, because on the last page
 *  that move was the submit and the user lost the chance to change their mind
 *  (2026-10-13). The Claude app hides its footer on such a card and submits on the
 *  pick; this card keeps the footer for that reason.
 *
 *  Skip is the app's: it lets go of the page's answer and turns the page, or
 *  sends from the last one. From the last page every page still untouched is
 *  skipped too, one the chevron passed by included, as the app does. A skipped
 *  page leaves the card unanswered (`{ indices: [] }`); what each agent is sent
 *  for it is in ask-skipped-pages.ts. When nothing at all is answered there is
 *  nothing to send, so Skip declines the question instead, which writes Escape:
 *  the old Cancel, and Claude Code's own "no answer". */
export function MobileNativeChatAsk({
  prompt,
  onAnswer,
  onCancel,
  sentAt = null,
  keyboardInset = 0,
  declineRefusal = null,
  besideComposer = false
}: Props): React.JSX.Element {
  const { colors, space } = useTheme()
  // A fixed 400 grew the dock past the viewport with the keyboard up on a short
  // phone and clipped the card's own question off the top. The dock is
  // bottom-anchored and has no cap of its own, so the card carries one that
  // follows the screen. It is 60 % since the card took the composer's place
  // (2026-10-16): the composer's room is the card's now, and the old cap
  // (52 %, at most 400) slid "Something else" under the footer. The window
  // does not shrink for the keyboard, so with it up the share is of the room
  // above it (askCardMaxHeight).
  const { height: windowHeight } = useWindowDimensions()
  const cardMaxHeight = askCardMaxHeight(windowHeight, keyboardInset, besideComposer)
  const [index, setIndex] = useState(0)
  const [selections, setSelections] = useState<number[][]>(() => prompt.questions.map(() => []))
  const [otherText, setOtherText] = useState<string[]>(() => prompt.questions.map(() => ''))
  // Pages the user skipped: they count as dealt with, and go out unanswered.
  const [skipped, setSkipped] = useState<boolean[]>(() => prompt.questions.map(() => false))
  // The row under a finger, so the rules beside it can let go (dc5.java j()).
  const [pressedRow, setPressedRow] = useState<number | null>(null)
  const [busy, setBusy] = useState<'sending' | 'cancelling' | null>(null)
  // A refused decline's reason, shown while the refusal still holds: once the
  // agent is seen waiting on the question, Skip declines it as usual.
  const [declineNote, setDeclineNote] = useState<string | null>(null)
  const shownDeclineNote = declineRefusal ? declineNote : null
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
    setSkipped((prev) => prev.map((cur, i) => (i === qi ? false : cur)))
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
    if (value.trim().length > 0) {
      setSkipped((prev) => prev.map((cur, i) => (i === qi ? false : cur)))
    }
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
  const isDealtWith = (qi: number): boolean => isAnswered(qi) || skipped[qi] === true

  const total = prompt.questions.length
  const isLast = index === total - 1
  const currentAnswered = useMemo(
    () => isAnswered(index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selections, otherText, index]
  )
  // Every page answered or skipped, and at least one answered: a card with
  // every page skipped has nothing to send (Skip declines it instead).
  const allAnswered = useMemo(
    () =>
      prompt.questions.every((_, i) => isDealtWith(i)) &&
      prompt.questions.some((_, i) => isAnswered(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherText, prompt.questions, selections, skipped]
  )
  const canAdvance = !locked && (isLast ? allAnswered : currentAnswered)
  // The last page is answered but Submit stays off because a page before it
  // was passed over with the chevron: say which, or the grey arrow reads as a
  // dead button. Skip still sends from here, that page skipped.
  const heldBackBy =
    isLast && currentAnswered && !locked
      ? prompt.questions.findIndex((_, i) => i !== index && !isDealtWith(i))
      : -1

  // `skipPage` is the page Skip just let go of: its state has not rendered yet.
  // `skipUntouched` is Skip from the last page: as in the Claude app, a page no
  // one answered goes out skipped (t52.java:83,97), the chevron having passed
  // it by included. Without it Skip refused in silence there.
  const submit = async (
    skipPage: number | null = null,
    skipUntouched = false
  ): Promise<void> => {
    const answers = prompt.questions.map((_, i) =>
      i === skipPage || (skipUntouched && !isAnswered(i)) ? { indices: [] } : selectionFor(i)
    )
    const dealtWith =
      skipUntouched || prompt.questions.every((_, i) => i === skipPage || isDealtWith(i))
    const anyAnswered = answers.some((a) => a.indices.length > 0 || (a.other ?? '').length > 0)
    if (!dealtWith || !anyAnswered || busyRef.current || answeredAt !== null) {
      return
    }
    busyRef.current = true
    setBusy('sending')
    let accepted = false
    try {
      accepted = await onAnswer(answers)
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

  // Skip (dc5.java:847-861): let go of this page's answer, then turn the page,
  // or send from the last one. With no page answered there is nothing to send,
  // so the question is declined instead (Escape, the old Cancel).
  const skip = async (): Promise<void> => {
    if (locked || busyRef.current) {
      return
    }
    setSelections((prev) => prev.map((cur, i) => (i === index ? [] : cur)))
    setOtherText((prev) => prev.map((cur, i) => (i === index ? '' : cur)))
    setSkipped((prev) => prev.map((cur, i) => (i === index ? true : cur)))
    if (!isLast) {
      setIndex((i) => Math.min(i + 1, total - 1))
      return
    }
    const anyAnswered = prompt.questions.some((_, i) => i !== index && isAnswered(i))
    if (anyAnswered) {
      // Every page still untouched is skipped with this one.
      setSkipped((prev) => prev.map((cur, i) => cur || !isAnswered(i)))
      await submit(index, true)
    } else {
      await cancel()
    }
  }

  const cancel = async (): Promise<void> => {
    if (busyRef.current || answeredAt !== null || !onCancel) {
      return
    }
    if (declineRefusal) {
      setDeclineNote(declineRefusal)
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
        // A 0 dp Compose border is a one-pixel hairline, in the rule colour
        // (dc5.java:655, n55.java:15720).
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.askDivider,
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
        {/* The app sets it in xo7.C (15 / 400), whose face reads heavier than
            Instrument Sans at 400; the user's screenshot of the app shows it
            semibold beside our regular (2026-10-16). */}
        <Txt
          variant="body"
          weight="semibold"
          style={{ flex: 1, color: colors.askText }}
          accessibilityRole="header"
        >
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
        style={{ flexDirection: 'row', alignItems: 'center', ...ASK_FOOTER }}
      >
        <View style={{ flex: 1 }}>
          {answeredAt !== null ? (
            // Sent: Skip could write Escape into a turn the agent may already
            // have started, so it goes, and the slot says what the card waits on.
            <Txt variant="label" style={{ color: colors.askLabel }} accessibilityLiveRegion="polite">
              {waitingLong ? ASK_SENT_WAITING_LINE : ''}
            </Txt>
          ) : shownDeclineNote ? (
            <Txt variant="label" style={{ color: colors.askMuted }} accessibilityLiveRegion="polite">
              {shownDeclineNote}
            </Txt>
          ) : heldBackBy >= 0 ? (
            <Txt variant="label" style={{ color: colors.askMuted }} accessibilityLiveRegion="polite">
              {`Question ${heldBackBy + 1} has no answer yet`}
            </Txt>
          ) : q.multiSelect ? (
            // question_card_selected_count: the same words for one and many.
            <Txt variant="label" style={{ color: colors.askMuted }}>
              {`${selectedCount} selected`}
            </Txt>
          ) : null}
        </View>
        {answeredAt === null ? (
          // An outlined pill (af4 "Secondary", qe4 "Small", dc5.java:2270).
          <Button
            label={ASK_SKIP_LABEL}
            variant="secondary"
            size="sm"
            style={{ backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }}
            labelColor={colors.askText}
            disabled={locked}
            onPress={() => void skip()}
          />
        ) : null}
        {answeredAt === null ? (
          <SendButton
            last={isLast}
            sending={busy === 'sending'}
            disabled={!canAdvance}
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
