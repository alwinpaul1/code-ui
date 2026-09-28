import { useEffect, useMemo, useRef, useState } from 'react'
import { tapTargetHitSlop } from '../ui/tap-target'
import { notificationPlainText } from '../notifications/notification-plain-text'
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { Check } from 'lucide-react-native'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import { useTheme } from '../theme/theme-context'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'

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

// Sentinel index for the free-text "Other…" row (never a real option index).
const OTHER = -1

/**
 * How long an accepted answer waits for the hook row to let go of the question
 * before the card says it is still waiting. After the last key is acknowledged,
 * the agent's PostToolUse hook goes to the desktop and the status comes back
 * over the relay: one relayed leg (a ~250 ms floor, measured behind the VPN on
 * 2026-09-11) plus the agent's own handling, well under a second on a healthy
 * link. Codex's request_user_input lets go the same way (its PostToolUse). 3 s is
 * several times that, so a normal hand-off never shows the line, and it is
 * still short of a network change, where the relay takes 5–8 s to migrate and
 * re-handshake (docs/network-measurements-2026-09-06.md) and the wait is
 * genuinely unexplained to the phone. Saying so then is the truth.
 */
export const ASK_SENT_WAIT_MS = 3_000

/** Native renderer for an agent's AskUserQuestion prompt as a wizard: one
 *  question per step with tabs across the top, a Next button that advances (Send
 *  on the last step), and a Cancel that dismisses the prompt. */
export function MobileNativeChatAsk({ prompt, onAnswer, onCancel, sentAt = null }: Props): React.JSX.Element {
  const { colors, fonts, radius, space, type } = useTheme()
  // 400 was a fixed guess: with the keyboard up on a short phone it grew the
  // dock past the viewport and clipped the card's own question off the top,
  // with nothing to scroll. The dock is bottom-anchored and has no cap of its
  // own, so the card carries one that follows the screen.
  const { height: windowHeight } = useWindowDimensions()
  const cardMaxHeight = Math.max(240, Math.min(400, Math.round(windowHeight * 0.52)))
  const [index, setIndex] = useState(0)
  const [selections, setSelections] = useState<number[][]>(() => prompt.questions.map(() => []))
  const [otherText, setOtherText] = useState<string[]>(() => prompt.questions.map(() => ''))
  const [busy, setBusy] = useState<'sending' | 'cancelling' | null>(null)
  const busyRef = useRef(false)
  // Once the host accepts the answer the card never takes another: a second
  // send types into whatever the agent draws next (a Bash approval reads a
  // digit as its answer). The controller's record covers a remount; this
  // covers the rest.
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null)
  const answeredAt = sentAt ?? acceptedAt
  const waitingLong = useSentWaitElapsed(answeredAt)
  const locked = busy !== null || answeredAt !== null

  const toggle = (qi: number, optIndex: number, multi: boolean): void => {
    if (locked) {
      return
    }
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
  const canAdvance = !locked && (isLast ? allAnswered : currentAnswered)

  const submit = async (): Promise<void> => {
    if (!allAnswered || busyRef.current || answeredAt !== null) {
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
  const otherSelected = (selections[index] ?? []).includes(OTHER)

  return (
    <View
      style={{
        maxHeight: cardMaxHeight,
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
                hitSlop={tapTargetHitSlop({ height: 30 })}
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
                disabled={locked}
                accessibilityRole="tab"
                accessibilityState={{ selected: active, disabled: locked }}
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
        // The free-text box carries its own border and the footer carries a
        // divider, so these two lines meet unless the list clears them. At
        // `space.sm` they sat almost on top of each other and the card read as
        // clutter (2026-09-15).
        contentContainerStyle={{ paddingBottom: space.lg }}
        keyboardShouldPersistTaps="always"
      >
        <Txt variant="heading" weight="semibold" style={{ marginVertical: space.md }}>
          {notificationPlainText(q.question)}
        </Txt>
        {q.options.map((opt, optIndex) => (
          <OptionRow
            key={`${optIndex}:${opt.label}`}
            label={opt.label}
            description={opt.description}
            selected={(selections[index] ?? []).includes(optIndex)}
            multi={q.multiSelect}
            disabled={locked}
            onPress={() => toggle(index, optIndex, q.multiSelect)}
          />
        ))}
        <OptionRow
          label="Other…"
          selected={otherSelected}
          multi={q.multiSelect}
          disabled={locked}
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
              fontSize: Math.max(type.body.size, TEXT_INPUT_FONT_SIZE),
              padding: space.md,
              minHeight: 46,
              // The Other row's own border is the line above. Without this gap
              // the field's top edge sits on that stroke (Claude ask card,
              // 2026-09-22).
              marginTop: space.md,
              marginBottom: space.sm
            }}
            value={otherText[index]}
            onChangeText={(v) => setOther(index, v)}
            editable={!locked}
            placeholder="Type your answer"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            // Android draws its own underline through the border we just set.
            underlineColorAndroid="transparent"
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
          paddingVertical: space.md,
          gap: space.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border
        }}
      >
        {/* Sent: Cancel would write Escape into a turn the agent may already
            have started, so it goes, and the slot says what the card waits on. */}
        {answeredAt === null ? (
          <Button label="Cancel" variant="ghost" size="sm" disabled={locked} onPress={() => void cancel()} />
        ) : (
          <Txt
            variant="caption"
            tone="secondary"
            style={{ flexShrink: 1 }}
            accessibilityLiveRegion="polite"
          >
            {waitingLong ? ASK_SENT_WAITING_LINE : ''}
          </Txt>
        )}
        {total > 1 && answeredAt === null ? (
          <Txt variant="caption" tone="muted">
            {index + 1}/{total}
          </Txt>
        ) : null}
        {answeredAt === null ? (
          <Button
            label={busy === 'sending' ? 'Sending…' : isLast ? 'Submit' : 'Next'}
            variant="accent"
            size="sm"
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
              borderRadius: radius.pill,
              backgroundColor: colors.bgRaised
            }}
          >
            <Check size={14} color={colors.success} strokeWidth={2.6} />
            <Txt variant="label" weight="semibold" tone="secondary">
              Sent
            </Txt>
          </View>
        )}
      </View>
    </View>
  )
}

/** The caption an answered card shows once it has waited ASK_SENT_WAIT_MS. */
export const ASK_SENT_WAITING_LINE = 'Sent — waiting for the agent to take it'

// The answer whose wait was last logged: a card remounted past the wait (a
// chat↔terminal toggle) must not log the same answer again.
let waitLoggedFor: number | null = null

/** True once `sentAt` is ASK_SENT_WAIT_MS old. Logs one line per answer when it
 *  turns, so one the agent never took leaves a trace saying where it stopped. */
function useSentWaitElapsed(sentAt: number | null): boolean {
  const [elapsedFor, setElapsedFor] = useState<number | null>(null)
  useEffect(() => {
    if (sentAt === null) {
      return
    }
    const remaining = ASK_SENT_WAIT_MS - (Date.now() - sentAt)
    const turn = (): void => {
      if (waitLoggedFor !== sentAt) {
        waitLoggedFor = sentAt
        console.warn(
          `[ask] answer accepted ${Date.now() - sentAt} ms ago; the hook row still shows the question pending, so the card waits (no resend offered)`
        )
      }
      setElapsedFor(sentAt)
    }
    if (remaining <= 0) {
      turn()
      return
    }
    const timer = setTimeout(turn, remaining)
    return () => clearTimeout(timer)
  }, [sentAt])
  return sentAt !== null && elapsedFor === sentAt
}

function OptionRow({
  label,
  description,
  selected,
  multi,
  disabled = false,
  onPress
}: {
  label: string
  description?: string
  selected: boolean
  multi?: boolean
  /** Sending or sent: the answer on its way out can no longer change. */
  disabled?: boolean
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
      disabled={disabled}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
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
          {notificationPlainText(label)}
        </Txt>
        {description ? (
          <Txt variant="caption" tone="secondary" numberOfLines={3}>
            {notificationPlainText(description)}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  )
}
