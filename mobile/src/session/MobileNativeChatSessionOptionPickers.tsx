import { useState } from 'react'
import { ActivityIndicator, Keyboard, View } from 'react-native'
import { ChevronLeft, X } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
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
  SessionOptionSummaryRow
} from './MobileNativeChatSessionOptionRows'
import { sortNativeChatSessionOptions } from '../../../src/shared/native-chat-session-option-snapshot'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

/** Descriptor id of the per-model effort option in every agent catalog. */
const EFFORT_OPTION_ID = 'effort'

export type MobileNativeChatSessionOptionPickersProps = {
  controller: MobileNativeChatSessionOptionsController
  /** Pickers lock while the agent works — a mid-turn `/model` interleaves with
   *  the agent's own output (desktop parity). */
  isWorking: boolean
  /** A composer send owns the TUI input line until it settles. The host spaces a
   *  send's body and its Enter ~500ms apart, so an apply dispatched inside that
   *  window would be submitted as part of the user's prompt. The composer blocks
   *  the reverse direction on `pendingId`; this is the same guard mirrored. */
  sendInFlight?: boolean
  /** False when this terminal's status line shows no model badge, so the phone
   *  cannot mirror what the desktop is running. */
  statusLineObserved?: boolean
}

/** Combined model/session-option trigger and its mobile bottom drawer. */
export function MobileNativeChatSessionOptionPickers({
  controller,
  isWorking,
  sendInFlight = false,
  statusLineObserved = true
}: MobileNativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const { colors, space } = useTheme()
  const [openDescriptorId, setOpenDescriptorId] = useState<string | null>(null)
  const { snapshot, pendingId } = controller
  const model = snapshot.find((descriptor) => descriptor.category === 'model')
  const options = sortNativeChatSessionOptions(snapshot)
  if (!model) {
    return null
  }
  const disabled = isWorking || pendingId !== null || sendInFlight
  const activeDescriptor = snapshot.find((descriptor) => descriptor.id === openDescriptorId)
  const modelView = activeDescriptor?.id === model.id
  const modelLabel = mobileModelPillLabel(model)
  const optionsLabel = options.length > 0 ? mobileOptionsPillLabel(options) : null
  const pillLabel = optionsLabel ? `${modelLabel} ${optionsLabel}` : modelLabel
  const reason = mobileSessionOptionDisabledReason(activeDescriptor?.disabledReason)

  const closePicker = (): void => setOpenDescriptorId(null)
  const openPicker = (): void => {
    Keyboard.dismiss()
    setOpenDescriptorId(model.id)
  }

  // Why: picking a model is only half the choice — its effort level is the next
  // question, so the drawer steps straight into that model's effort rows instead
  // of closing and making the user reopen the pill. A model with no effort option
  // (Haiku) has no such descriptor, and the drawer closes as before.
  const afterApply = (descriptor: SessionOptionDescriptor): void => {
    if (descriptor.id === model.id) {
      setOpenDescriptorId(EFFORT_OPTION_ID)
      return
    }
    closePicker()
  }

  const applyOption = (descriptor: SessionOptionDescriptor, value: SessionOptionValue): void => {
    // Re-picking the tracked value is a no-op — never re-dispatch it.
    if (
      descriptor.valueSource !== 'unknown' &&
      descriptor.kind.type === 'select' &&
      descriptor.kind.currentValue === value
    ) {
      afterApply(descriptor)
      return
    }
    void controller.setOption(descriptor.id, value).then((applied) => {
      if (applied) {
        afterApply(descriptor)
      }
    })
  }
  const invokeAction = (descriptor: SessionOptionDescriptor): void => {
    void controller.invokeAction(descriptor.id).then((invoked) => {
      if (invoked) {
        closePicker()
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
      <BottomDrawer visible={activeDescriptor !== undefined} onClose={closePicker}>
        {activeDescriptor ? (
          <View style={{ paddingBottom: space.xs }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: space.lg }}
            >
              <IconButton
                icon={modelView ? X : ChevronLeft}
                accessibilityLabel={modelView ? 'Close picker' : 'Back to models'}
                variant="soft"
                size={36}
                iconSize={18}
                onPress={modelView ? closePicker : () => setOpenDescriptorId(model.id)}
              />
              <Txt variant="title" weight="semibold" align="center" style={{ flex: 1 }}>
                {modelView ? 'Select model' : `Select ${activeDescriptor.label.toLowerCase()}`}
              </Txt>
              <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                {pendingId !== null ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : null}
              </View>
            </View>
            {activeDescriptor.valueSource === 'dispatched' ? (
              <SessionOptionCaption>Sent to the agent — not confirmed</SessionOptionCaption>
            ) : null}
            {reason ? <SessionOptionCaption>{reason}</SessionOptionCaption> : null}
            {modelView && !statusLineObserved ? (
              <SessionOptionCaption>
                No model badge in this terminal's status line, so the phone can't see what the
                desktop switches to. Install the Code UI status line (see README) to sync both ways.
              </SessionOptionCaption>
            ) : null}
            <Surface level="raised" bordered rounded="lg" style={{ overflow: 'hidden' }}>
              <DescriptorRows
                descriptor={activeDescriptor}
                disabled={disabled}
                grouped
                onSetOption={(value) => applyOption(activeDescriptor, value)}
                onInvokeAction={() => invokeAction(activeDescriptor)}
              />
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
                    onPress={() => setOpenDescriptorId(descriptor.id)}
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
