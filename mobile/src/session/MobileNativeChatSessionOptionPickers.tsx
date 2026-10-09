import { useEffect, useState } from 'react'
import { ActivityIndicator, Keyboard, View } from 'react-native'
import { ArrowLeft, X } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { sessionModelPillLabel } from './session-model-pill'
import { matchClaudeCatalogModelId } from './claude-model-identity'
import { IconButton } from '../ui/IconButton'
import { Txt } from '../ui/Txt'
import type {
  SessionOptionDescriptor,
  SessionOptionSelectChoice,
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
  RowGroup,
  tileColour,
  SessionOptionCaption,
  SessionOptionSummaryRow
} from './MobileNativeChatSessionOptionRows'
import { SheetFailureLine } from './SheetFailureLine'
import { sortNativeChatSessionOptions } from '../../../src/shared/native-chat-session-option-snapshot'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'
import type { PickFailureReport } from './session-option-pick-failure'
import { useSheetFailure } from './use-sheet-failure'
import { modelSheetLayout } from './model-sheet-layout'

/** Descriptor id of the per-model effort option in every agent catalog. */
const EFFORT_OPTION_ID = 'effort'

export type MobileNativeChatSessionOptionPickersProps = {
  controller: MobileNativeChatSessionOptionsController
  /** The chat's banner, or its toast, for the tab shown. A pick's failure goes
   *  here only when the drawer is not showing it (use-sheet-failure.ts). */
  reportFailure: PickFailureReport
  /** The tab the chat shows (mobileNativeChatScopeKey): a failure is drawn only
   *  on the tab its pick was made on. */
  scopeKey: string | null
  /** The agent is working. It does not lock the pill (see `disabled` below);
   *  it tells the Codex reader to say the list waits for the turn to end. */
  isWorking: boolean
  /** A composer send owns the TUI input line until it settles. The host spaces a
   *  send's body and its Enter ~500ms apart, so an apply dispatched inside that
   *  window would be submitted as part of the user's prompt. The composer blocks
   *  the reverse direction on `pendingId`; this is the same guard mirrored. */
  sendInFlight?: boolean
  /** Bumped by the owner to open the model sheet (a typed `/model` in Codex chat). */
  openRequest?: number
  /** The agent's own word about what is running — the status-line badge or
   *  the beacon, or with neither on a Claude session, the model its transcript
   *  last recorded (claude-transcript-model.ts). When present it labels the
   *  pill and decides which drawer row is checked (`withRunningModelSelected`);
   *  the snapshot stands in for the checked row only until the agent has
   *  spoken. See session-model-pill.ts for the 2026-09-18 case this exists for. */
  liveModel?: { model: string | null; label: string | null; effort: string | null }
  /** The agent's own model list is still being read (Codex scrapes its picker);
   *  the sheet shows a reader row instead of a placeholder list. */
  modelsPending?: boolean
  /** The user tapped the pill to open the sheet. */
  onOpen?: () => void
  /** The list is Claude Code's own, laid out as the Claude app's picker
   *  (model-sheet-layout.ts). Every other agent's list is drawn flat. */
  claudeModelLayout?: boolean
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
 *
 * The agent states full ids (the beacon's `claude-opus-4-8`, the transcript's
 * `claude-opus-5-5`) and the rows are catalog ids (`opus`), so the id goes
 * through the same matcher the seeding uses (`matchClaudeCatalogModelId`) to
 * find its row. Compared raw, nothing was checked on a quiet host (2026-09-27).
 * An id no row carries checks nothing, never the record's row.
 */
function withRunningModelSelected(
  descriptor: SessionOptionDescriptor,
  modelDescriptorId: string,
  live: { model: string | null; label?: string | null } | undefined
): SessionOptionDescriptor {
  const running = live?.model?.trim()
  if (descriptor.id !== modelDescriptorId || !running || descriptor.kind.type !== 'select') {
    return descriptor
  }
  const rows = {
    models: descriptor.kind.choices.map((choice) => ({ id: choice.value, label: choice.label, options: [] })),
    modelApply: {}
  }
  const row = matchClaudeCatalogModelId(rows, running, live?.label ?? null) ?? running
  return { ...descriptor, kind: { ...descriptor.kind, currentValue: row } }
}

/** The model descriptor showing one page of its rows; the checked value stays. */
function withChoices(
  descriptor: SessionOptionDescriptor,
  choices: SessionOptionSelectChoice[]
): SessionOptionDescriptor {
  return descriptor.kind.type === 'select'
    ? { ...descriptor, kind: { ...descriptor.kind, choices } }
    : descriptor
}

export function MobileNativeChatSessionOptionPickers({
  controller,
  isWorking,
  reportFailure,
  scopeKey,
  sendInFlight = false,
  openRequest = 0,
  modelsPending = false,
  liveModel,
  onOpen,
  claudeModelLayout = false
}: MobileNativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const { colors, space, isDark } = useTheme()
  const [openDescriptorId, setOpenDescriptorId] = useState<string | null>(null)
  // The model view's second page: the rows the first page leaves out.
  const [morePage, setMorePage] = useState(false)
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
  const failure = useSheetFailure({ open: drawerOpen, scopeKey, reportFailure })
  const options = sortNativeChatSessionOptions(snapshot)
  if (!model) {
    return null
  }
  // Why not `isWorking`: both agents take a `/model` mid-turn. Claude Code
  // queues it and applies it when the turn ends; Codex opens its picker during
  // a turn (`available_during_task` lists Model, codex-rs 0.153.4), and the
  // phone drives it there (codex-picker-apply.ts). So the pill stays usable
  // while the agent works. Only an in-flight change of ours, or a send in
  // progress, holds it.
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
  // The running model decides the checked row on both pages, so the layout is
  // cut from the descriptor that already carries it.
  const modelShown = withRunningModelSelected(model, model.id, liveModel)
  const layout =
    claudeModelLayout && modelShown.kind.type === 'select'
      ? modelSheetLayout(modelShown.kind.choices)
      : null
  const onMorePage = modelView && morePage && layout !== null
  // Why the More models row names a pick: with the running model on the
  // second page, the first page checks nothing, and the row is where it is.
  const runningValue = modelShown.kind.type === 'select' ? modelShown.kind.currentValue : undefined
  const moreSelectedLabel =
    layout?.more.find((choice) => choice.value === runningValue)?.label ?? null

  // Another view of the drawer drops the failure the user read in this one.
  // Closing leaves it to use-sheet-failure.ts, which drops it if
  // it has been read and hands it to the chat's banner if not.
  const showView = (id: string, more = false): void => {
    failure.clear()
    setMorePage(more)
    setOpenDescriptorId(id)
  }
  const closePicker = (): void => {
    setMorePage(false)
    setOpenDescriptorId(null)
  }
  const openPicker = (): void => {
    Keyboard.dismiss()
    setMorePage(false)
    setOpenDescriptorId(model.id)
    onOpen?.()
  }

  // Why: picking a model is only half the choice — its effort level is the next
  // question, so the drawer steps straight into that model's effort rows instead
  // of closing and making the user reopen the pill. A model with no effort option
  // (Haiku) has no such descriptor, and the drawer closes as before. Neither drops
  // what the pick said (an ack that was lost): it stays in the drawer, or goes to
  // the banner once the drawer has closed.
  const afterApply = (descriptor: SessionOptionDescriptor): void => {
    setMorePage(false)
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
    void controller.setOption(descriptor.id, value, failure.reporter()).then((applied) => {
      if (applied) {
        afterApply(descriptor)
      }
    })
  }
  const invokeAction = (descriptor: SessionOptionDescriptor): void => {
    failure.clear()
    void controller.invokeAction(descriptor.id, failure.reporter()).then((invoked) => {
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
      <BottomDrawer visible={activeDescriptor !== undefined} onClose={closePicker}>
        {activeDescriptor ? (
          <View style={{ paddingBottom: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: space.lg }}>
              <IconButton
                icon={modelView && !onMorePage ? X : ArrowLeft}
                accessibilityLabel={modelView && !onMorePage ? 'Close picker' : 'Back to models'}
                variant="ghost"
                size={36}
                iconSize={22}
                onPress={modelView && !onMorePage ? closePicker : () => showView(model.id)}
              />
              <Txt variant="title" weight="semibold" align="center" style={{ flex: 1 }}>
                {onMorePage
                  ? 'More models'
                  : modelView
                    ? 'Select model'
                    : `Select ${activeDescriptor.label.toLowerCase()}`}
              </Txt>
              <View
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                {pendingId !== null ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : null}
              </View>
            </View>
            {failure.shown ? (
              <SheetFailureLine style={{ paddingHorizontal: space.md, paddingBottom: space.xs }}>
                {failure.shown}
              </SheetFailureLine>
            ) : null}
            {activeDescriptor.valueSource === 'dispatched' ? (
              <SessionOptionCaption>Sent to the agent — not confirmed</SessionOptionCaption>
            ) : null}
            {reason ? <SessionOptionCaption>{reason}</SessionOptionCaption> : null}
            <RowGroup>
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
                    paddingVertical: space.md,
                    backgroundColor: tileColour(colors, isDark)
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
                  descriptor={
                    modelView && layout
                      ? withChoices(modelShown, onMorePage ? layout.more : layout.featured)
                      : withRunningModelSelected(activeDescriptor, model.id, liveModel)
                  }
                  disabled={disabled}
                  grouped
                  onSetOption={(value) => applyOption(activeDescriptor, value)}
                  onInvokeAction={() => invokeAction(activeDescriptor)}
                />
              )}
            </RowGroup>
            {modelView && !onMorePage && options.length > 0 ? (
              <RowGroup style={{ marginTop: space.md }}>
                {options.map((descriptor) => (
                  <SessionOptionSummaryRow
                    key={descriptor.id}
                    label={descriptor.label}
                    value={mobileSessionOptionSummaryValue(descriptor)}
                    disabled={disabled}
                    divided={false}
                    onPress={() => showView(descriptor.id)}
                  />
                ))}
              </RowGroup>
            ) : null}
            {modelView && !onMorePage && !modelsPending && layout && layout.more.length > 0 ? (
              <RowGroup style={{ marginTop: space.md }}>
                <SessionOptionSummaryRow
                  label="More models"
                  value={moreSelectedLabel ?? ''}
                  disabled={false}
                  divided={false}
                  onPress={() => showView(model.id, true)}
                />
              </RowGroup>
            ) : null}
          </View>
        ) : null}
      </BottomDrawer>
    </View>
  )
}
