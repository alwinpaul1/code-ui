import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Keyboard, View } from 'react-native'
import { ArrowLeft, X } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { sessionModelPillLabel, sessionModelPillParts } from './session-model-pill'
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

/**
 * The Effort row states the agent's effort, not the phone's pick.
 *
 * The descriptor's `currentValue` is the tracked record, and a pick is written
 * there when it is sent. On 2026-10-13 the sheet read "High" over a pill reading
 * "Opus 5.5 Medium", and Claude had never run the `/effort high` (no row for it
 * in any transcript). So, like the model row, the level the agent states decides
 * the summary and the checked row, and a pick still waiting for it is said as
 * pending beside it (native-chat-effort-pick.ts). With no statement from the
 * agent, or one no row carries, the record stands in as before, under its
 * "not confirmed" caption.
 */
function withLiveEffort(
  descriptor: SessionOptionDescriptor,
  effort: string | null | undefined
): SessionOptionDescriptor {
  const stated = effort?.trim().toLowerCase()
  if (descriptor.id !== EFFORT_OPTION_ID || descriptor.kind.type !== 'select' || !stated) {
    return descriptor
  }
  // Claude states `xhigh` beside Ultracode (2.1.281's `/effort ultracode` is
  // xhigh plus workflows), so that statement neither confirms nor denies it.
  if (stated === 'xhigh' && descriptor.kind.currentValue === 'ultracode') {
    return descriptor
  }
  const row = descriptor.kind.choices.find((choice) => choice.value.toLowerCase() === stated)
  return row
    ? { ...descriptor, valueSource: 'reported', kind: { ...descriptor.kind, currentValue: row.value } }
    : descriptor
}

/** A level's row label, or the level itself. */
function choiceLabel(descriptor: SessionOptionDescriptor | undefined, value: string): string {
  const choice =
    descriptor?.kind.type === 'select'
      ? descriptor.kind.choices.find((candidate) => candidate.value === value)
      : undefined
  return choice?.label ?? value
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
  // The model view's second page: the older models behind the "More models" row.
  const [morePage, setMorePage] = useState(false)
  const [lastRequest, setLastRequest] = useState(controller.optionPickerRequest)
  if (controller.optionPickerRequest && lastRequest !== controller.optionPickerRequest) {
    setLastRequest(controller.optionPickerRequest)
    setMorePage(false)
    setOpenDescriptorId(controller.optionPickerRequest.id)
  }
  const { snapshot, pendingId } = controller
  const pendingEffort = controller.pendingEffort ?? null
  const liveEffort = liveModel?.effort ?? null
  const model = snapshot.find((descriptor) => descriptor.category === 'model')
  const modelId = model?.id ?? null
  // The count the chat controller held when this picker mounted was answered by an earlier one:
  // the controller outlives the chat view, so "above zero" would open the sheet on every return
  // from the terminal. Only a request that rises while mounted opens it, as soon as a model
  // option is there to open.
  const answeredRequest = useRef(openRequest)
  useEffect(() => {
    if (openRequest > answeredRequest.current && modelId) {
      answeredRequest.current = openRequest
      Keyboard.dismiss()
      setMorePage(false)
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
  const openDescriptor = snapshot.find((descriptor) => descriptor.id === openDescriptorId)
  const activeDescriptor = openDescriptor && withLiveEffort(openDescriptor, liveEffort)
  const effortDescriptor = snapshot.find((descriptor) => descriptor.id === EFFORT_OPTION_ID)
  const pendingLabel = pendingEffort ? choiceLabel(effortDescriptor, pendingEffort.value) : null
  // Said on the Effort page while a pick waits for the agent: queued in
  // Claude's box mid-turn, or on its way.
  const pendingCaption =
    activeDescriptor?.id === EFFORT_OPTION_ID && pendingEffort && pendingLabel
      ? pendingEffort.queued
        ? `${pendingLabel} applies after Claude finishes`
        : `Changing to ${pendingLabel}…`
      : null
  const modelView = activeDescriptor?.id === model.id
  // What is RUNNING outranks what was picked, for the label. The snapshot's
  // current value is the tracked record, and the pill read "Fable Medium" from
  // it on a session whose status line painted Opus xhigh (2026-09-18).
  const live = sessionModelPillLabel(liveModel ?? null)
  // Only the agent's own stated effort is drawn apart, muted. The snapshot's label below is one
  // string of descriptor values, and no word is split off a guess.
  const liveParts = sessionModelPillParts(liveModel ?? null)
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
  // The Claude app's chat picker keeps its older models behind a tap: a "More
  // models" row under the Effort row opens a page of its own (Claude Android
  // 1.261009.20, ModelSelectorBottomSheetDestination: "Select model", "More
  // models", "Effort"). Its Code section lists them inline under "Other
  // models", which Code UI drew from 2026-10-12 (05a1f68b5) until the user
  // asked for the tap back on 2026-10-14. The row exists only when there is
  // something behind it.
  const hasMoreModels = modelView && !modelsPending && layout !== null && layout.more.length > 0
  const onMorePage = hasMoreModels && morePage
  // Why the More models row names a pick: with the running model on the second
  // page, the first page checks nothing, and the row is where it is.
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

  const applyOption = (picked: SessionOptionDescriptor, value: SessionOptionValue): void => {
    failure.clear()
    // Re-picking the value the agent states (or, with no statement, the tracked
    // one) is a no-op. A pick it never took is not that value, and is sent again.
    // While a pick waits, a tap on the stated level is the user taking it back:
    // it is sent, so a `/effort` Claude queued is overridden, and the wait ends.
    const descriptor = withLiveEffort(picked, liveEffort)
    if (
      !(descriptor.id === EFFORT_OPTION_ID && pendingEffort) &&
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
        closePicker()
      }
    })
  }

  return (
    <View style={{ flexShrink: 1, minWidth: 0 }}>
      <Pill
        label={liveParts?.name ?? pillLabel}
        effort={liveParts?.effort ?? null}
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
              {/* The app titles an option's own sheet with its name alone
                  ("Effort"), the older models "More models", and the model
                  sheet "Select model". */}
              <Txt variant="title" weight="semibold" align="center" style={{ flex: 1 }}>
                {onMorePage ? 'More models' : modelView ? 'Select model' : activeDescriptor.label}
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
            {pendingCaption ? (
              <SessionOptionCaption>{pendingCaption}</SessionOptionCaption>
            ) : activeDescriptor.valueSource === 'dispatched' ? (
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
                    value={
                      descriptor.id === EFFORT_OPTION_ID && pendingLabel
                        ? `${pendingLabel}…`
                        : mobileSessionOptionSummaryValue(withLiveEffort(descriptor, liveEffort))
                    }
                    disabled={disabled}
                    divided={false}
                    onPress={() => showView(descriptor.id)}
                  />
                ))}
              </RowGroup>
            ) : null}
            {hasMoreModels && !onMorePage ? (
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
