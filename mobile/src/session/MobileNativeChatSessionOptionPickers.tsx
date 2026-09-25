import { useEffect, useState } from 'react'
import { ActivityIndicator, Keyboard, View } from 'react-native'
import { ChevronLeft, X } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { sessionModelPillLabel } from './session-model-pill'
import { IconButton } from '../ui/IconButton'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import {
  mobileModelPillLabel,
  mobileOptionsPillLabel,
  mobileSessionOptionSummaryValue,
  mobileSessionOptionDisabledReason
} from './mobile-native-chat-session-option-labels'
import {
  DescriptorRows,
  Pill,
  SessionOptionCaption,
  SessionOptionFailure,
  SessionOptionSummaryRow
} from './MobileNativeChatSessionOptionRows'
import { sortNativeChatSessionOptions } from '../../../src/shared/native-chat-session-option-snapshot'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'
import type { PickFailureReport } from './session-option-pick-failure'
import { useSessionOptionPickFailure } from './use-session-option-pick-failure'

/** Descriptor id of the per-model effort option in every agent catalog. */
const EFFORT_OPTION_ID = 'effort'

export type MobileNativeChatSessionOptionPickersProps = {
  controller: MobileNativeChatSessionOptionsController
  /** The chat's banner, or its toast, for the tab shown. A pick's failure goes
   *  here only when the drawer is not showing it (use-session-option-pick-failure.ts).
   *  Keep it the same function for one tab: a new one reads as a new tab. */
  reportFailure: PickFailureReport
  /** Pickers lock while the agent works — a mid-turn `/model` interleaves with
   *  the agent's own output (desktop parity). */
  isWorking: boolean
  /** A composer send owns the TUI input line until it settles. The host spaces a
   *  send's body and its Enter ~500ms apart, so an apply dispatched inside that
   *  window would be submitted as part of the user's prompt. The composer blocks
   *  the reverse direction on `pendingId`; this is the same guard mirrored. */
  sendInFlight?: boolean
  /** Bumped by the owner to open the model sheet (a typed `/model` in Codex chat). */
  openRequest?: number
  /** The agent's own word about what is running — the status-line badge or
   *  the beacon. When present it labels the pill; the snapshot still decides
   *  which drawer row is selected, because that is what a pick changes. See
   *  session-model-pill.ts for the 2026-09-18 case this exists for. */
  liveModel?: { model: string | null; label: string | null; effort: string | null }
  /** The agent's own model list is still being read (Codex scrapes its picker);
   *  the sheet shows a reader row instead of a placeholder list. */
  modelsPending?: boolean
}

/** Combined model/session-option trigger and its mobile bottom drawer. */
/**
 * The model drawer marks the RUNNING model as selected, not the picked one.
 *
 * The descriptor's `currentValue` is the tracked record — a pick, a seed, a
 * remembered value. With Opus running and the record saying Fable, opening the
 * picker showed Fable checked (2026-09-18). The agent's own word decides the
 * checked row; the record stands in only until the agent has spoken.
 *
 * Only the model descriptor, and only its `currentValue`: choices, labels and
 * everything a tap dispatches are untouched. `applyOption` compares the tap
 * against this same value, so re-picking what is already running is a no-op
 * and picking the record's stale value dispatches, both of which are right.
 */
function withRunningModelSelected(
  descriptor: SessionOptionDescriptor,
  modelDescriptorId: string,
  live: { model: string | null } | undefined
): SessionOptionDescriptor {
  const running = live?.model?.trim()
  if (descriptor.id !== modelDescriptorId || !running || descriptor.kind.type !== 'select') {
    return descriptor
  }
  return { ...descriptor, kind: { ...descriptor.kind, currentValue: running } }
}

export function MobileNativeChatSessionOptionPickers({
  controller,
  isWorking,
  reportFailure,
  sendInFlight = false,
  openRequest = 0,
  modelsPending = false,
  liveModel
}: MobileNativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const { colors, space } = useTheme()
  const [openDescriptorId, setOpenDescriptorId] = useState<string | null>(null)
  const [lastRequest, setLastRequest] = useState(controller.optionPickerRequest)
  if (controller.optionPickerRequest && lastRequest !== controller.optionPickerRequest) {
    setLastRequest(controller.optionPickerRequest)
    setOpenDescriptorId(controller.optionPickerRequest.id)
  }
  const { snapshot, pendingId } = controller
  const model = snapshot.find((descriptor) => descriptor.category === 'model')
  const modelId = model?.id ?? null
  useEffect(() => {
    if (openRequest > 0 && modelId) {
      Keyboard.dismiss()
      setOpenDescriptorId(modelId)
    }
  }, [modelId, openRequest])
  // Why the drawer says a failed pick itself: it draws in its own native window
  // (a Modal), and the chat's banner and toast draw in the screen under it. A
  // failed pick keeps the drawer open, so a reason said only there was never
  // seen, and the row looked dead rather than refused (2026-09-25).
  const drawerOpen =
    model !== undefined && snapshot.some((descriptor) => descriptor.id === openDescriptorId)
  const failure = useSessionOptionPickFailure({ drawerOpen, reportFailure })
  const options = sortNativeChatSessionOptions(snapshot)
  if (!model) {
    return null
  }
  // Why not `isWorking`: Claude Code queues a `/model` typed mid-turn and applies
  // it when the turn ends, so the pill stays usable while the agent works. Only
  // an in-flight change of ours, or a send in progress, holds it.
  const disabled = pendingId !== null || sendInFlight
  const activeDescriptor = snapshot.find((descriptor) => descriptor.id === openDescriptorId)
  const modelView = activeDescriptor?.id === model.id
  // What is RUNNING outranks what was picked, for the label. The snapshot's
  // current value is the tracked record, and the pill read "Fable Medium" from
  // it on a session whose status line painted Opus xhigh (2026-09-18).
  const live = sessionModelPillLabel(liveModel ?? null)
  const modelLabel = mobileModelPillLabel(model)
  const optionsLabel = options.length > 0 ? mobileOptionsPillLabel(options) || null : null
  const pillLabel = live ?? (optionsLabel ? `${modelLabel} ${optionsLabel}` : modelLabel)
  const reason = mobileSessionOptionDisabledReason(activeDescriptor?.disabledReason)

  // The user moves on from a failure they have in front of them: another view
  // of the drawer, or its X. Back, a backdrop tap and a swipe close it only once
  // the hide animation ends, so `dismissed` keeps what may have landed since,
  // and the chat's banner takes it.
  const showView = (id: string | null): void => {
    failure.clear()
    setOpenDescriptorId(id)
  }
  const closePicker = (): void => showView(null)
  const dismissed = (): void => setOpenDescriptorId(null)
  const openPicker = (): void => {
    Keyboard.dismiss()
    setOpenDescriptorId(model.id)
  }

  // Why: picking a model is only half the choice — its effort level is the next
  // question, so the drawer steps straight into that model's effort rows instead
  // of closing and making the user reopen the pill. A model with no effort option
  // (Haiku) has no such descriptor, and the drawer closes as before. Neither drops
  // what the pick said (an ack that was lost): it stays in the drawer, or goes to
  // the banner once the drawer has closed.
  const afterApply = (descriptor: SessionOptionDescriptor): void => {
    setOpenDescriptorId(descriptor.id === model.id ? EFFORT_OPTION_ID : null)
  }

  const applyOption = (descriptor: SessionOptionDescriptor, value: SessionOptionValue): void => {
    failure.clear()
    // Re-picking the tracked value is a no-op — never re-dispatch it.
    if (
      descriptor.valueSource !== 'unknown' &&
      descriptor.kind.type === 'select' &&
      descriptor.kind.currentValue === value
    ) {
      afterApply(descriptor)
      return
    }
    void controller.setOption(descriptor.id, value, failure.reporterForPick()).then((applied) => {
      if (applied) {
        afterApply(descriptor)
      }
    })
  }
  const invokeAction = (descriptor: SessionOptionDescriptor): void => {
    failure.clear()
    void controller.invokeAction(descriptor.id, failure.reporterForPick()).then((invoked) => {
      if (invoked) {
        setOpenDescriptorId(null)
      }
    })
  }

  return (
    <View style={{ flexShrink: 1, minWidth: 0 }}>
      <Pill
        label={pillLabel}
        accessibleName={`Model, ${pillLabel}`}
        disabled={disabled}
        onPress={openPicker}
      />
      <BottomDrawer visible={activeDescriptor !== undefined} onClose={dismissed}>
        {activeDescriptor ? (
          <View style={{ paddingBottom: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: space.lg }}>
              <IconButton
                icon={modelView ? X : ChevronLeft}
                accessibilityLabel={modelView ? 'Close picker' : 'Back to models'}
                variant="soft"
                size={36}
                iconSize={18}
                onPress={modelView ? closePicker : () => showView(model.id)}
              />
              <Txt variant="title" weight="semibold" align="center" style={{ flex: 1 }}>
                {modelView ? 'Select model' : `Select ${activeDescriptor.label.toLowerCase()}`}
              </Txt>
              <View
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                {pendingId !== null ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : null}
              </View>
            </View>
            {failure.shown ? <SessionOptionFailure>{failure.shown}</SessionOptionFailure> : null}
            {activeDescriptor.valueSource === 'dispatched' ? (
              <SessionOptionCaption>Sent to the agent — not confirmed</SessionOptionCaption>
            ) : null}
            {reason ? <SessionOptionCaption>{reason}</SessionOptionCaption> : null}
            <Surface level="raised" bordered rounded="lg" style={{ overflow: 'hidden' }}>
              {modelView && modelsPending ? (
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel={
                    isWorking ? 'Waiting for Codex to finish' : 'Reading models from the agent'
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    paddingHorizontal: space.md,
                    paddingVertical: space.md
                  }}
                >
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Txt variant="body" tone="secondary">
                    {isWorking
                      ? 'Models will load when Codex finishes this turn'
                      : 'Reading models from the agent…'}
                  </Txt>
                </View>
              ) : (
                <DescriptorRows
                  descriptor={withRunningModelSelected(activeDescriptor, model.id, liveModel)}
                  disabled={disabled}
                  grouped
                  onSetOption={(value) => applyOption(activeDescriptor, value)}
                  onInvokeAction={() => invokeAction(activeDescriptor)}
                />
              )}
            </Surface>
            {modelView && options.length > 0 ? (
              <Surface
                level="raised"
                bordered
                rounded="lg"
                style={{ overflow: 'hidden', marginTop: space.md }}
              >
                {options.map((descriptor, index) => (
                  <SessionOptionSummaryRow
                    key={descriptor.id}
                    label={descriptor.label}
                    value={mobileSessionOptionSummaryValue(descriptor)}
                    disabled={disabled}
                    divided={index < options.length - 1}
                    onPress={() => showView(descriptor.id)}
                  />
                ))}
              </Surface>
            ) : null}
          </View>
        ) : null}
      </BottomDrawer>
    </View>
  )
}
