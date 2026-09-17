import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resetEffortReportGateForTests, shouldApplyReportedEffort } from './native-chat-effort-report-gate'
import {
  mergeStoredSessionOptionRecord,
  readSessionOptionRecord,
  writeSessionOptionRecord
} from '../storage/session-option-records'
import {
  getAgentSessionOptionCatalog,
  type CatalogCommandDelivery,
  type CatalogModel
} from '../../../src/shared/agent-session-option-catalog'
import type { CatalogOptionApply } from '../../../src/shared/agent-session-option-catalog-types'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import {
  clearPendingModelPicksForTests,
  forgetModelReportScope,
  getPendingModelPick,
  MODEL_PICK_GRACE_MS,
  notePendingModelPick,
  hasSeenLiveModelReport,
  resolveReportedModelSeed,
  type ModelReportSource
} from './mobile-native-chat-model-report-authority'
import {
  buildNativeChatSessionOptionCommand,
  recordNativeChatSessionOptionCommand
} from '../../../src/shared/native-chat-session-option-commands'
import { buildNativeChatSessionOptionSnapshot } from '../../../src/shared/native-chat-session-option-snapshot'
import {
  applyNativeChatReportedSessionOptions,
  clearNativeChatSessionModel,
  createNativeChatSessionOptionRecord,
  getTrackedSessionOption,
  isFlipOnlyMidSession,
  setTrackedSessionOption,
  type NativeChatSessionOptionRecord
} from '../../../src/shared/native-chat-session-option-state'
import { activeModels } from './mobile-chat-model-row-naming'

export type MobileNativeChatSessionOptionsController = {
  conversationCommands?: readonly AgentSessionConversationCommand[]
  optionPickerRequest?: { id: string; sequence: number } | null
  /** Model descriptor first, then the current model's options; empty when the
   *  agent has no catalog. */
  snapshot: SessionOptionDescriptor[]
  /** Descriptor id with a dispatch in flight; the UI disables rows meanwhile. */
  pendingId: string | null
  setOption: (id: string, value: SessionOptionValue) => Promise<boolean>
  invokeAction: (id: string) => Promise<boolean>
  /** Track a slash command the user typed themselves (e.g. `/model sonnet`). */
  recordCommand: (command: string) => void
  /** Whether THIS terminal's agent has ever stated its own model. False means
   *  the snapshot's model is a tracked pick nobody has confirmed, which is not
   *  something the header may assert. See session-model-pill.ts. */
  modelConfirmed: boolean
}

type PendingOperation = { id: string; token: number }

// Why: per-tab records survive chat↔terminal flips and remounts, like desktop's
// scope cache. Bounded so long sessions across many tabs can't grow unbounded.
const MOBILE_SESSION_OPTION_RECORD_CAP = 32
const recordsByScope = new Map<string, NativeChatSessionOptionRecord>()
// Scopes whose stored record has been consulted once this process. Effort and
// toggles are never reported back by the agent, so a record lost with the
// process is lost for good unless it is read back from disk.
const hydratedScopes = new Set<string>()

/** Test-only: the module caches outlive a single test's hooks. */
export function resetMobileNativeChatSessionOptionRecordsForTests(): void {
  clearMobileSessionOptionRecordsForTests()
  hydratedScopes.clear()
}

function getScopedRecord(scopeKey: string, agent: string): NativeChatSessionOptionRecord {
  const existing = recordsByScope.get(scopeKey)
  const record =
    existing && existing.agent === agent ? existing : createNativeChatSessionOptionRecord(agent)
  if (record !== existing) {
    // The agent under this tab changed: nothing the OLD one said about itself
    // is evidence about this one. Leaving any of it latched left the fresh
    // record with no model at all (2026-09-15).
    forgetModelReportScope(scopeKey)
  }
  // Why: delete-then-set on every read makes the touched scope most-recent, so
  // eviction only sheds the oldest UNTOUCHED tab. Insertion order alone would let
  // a long-lived active tab be the oldest key and lose its tracked model.
  recordsByScope.delete(scopeKey)
  recordsByScope.set(scopeKey, record)
  while (recordsByScope.size > MOBILE_SESSION_OPTION_RECORD_CAP) {
    const oldest = recordsByScope.keys().next().value
    if (oldest === undefined) {
      break
    }
    recordsByScope.delete(oldest)
    forgetModelReportScope(oldest)
  }
  return record
}

export function clearMobileSessionOptionRecordsForTests(): void {
  recordsByScope.clear()
  clearPendingModelPicksForTests()
  resetEffortReportGateForTests()
}

const EMPTY_SNAPSHOT: SessionOptionDescriptor[] = []

/** The model list every consumer must see: the catalog's, plus the tracked model
 *  when the catalog no longer lists it. Desktop reconciles identically. */
export function useMobileNativeChatSessionOptions(args: {
  agent: string | null
  /** Stable per-tab scope (host + worktree + tab), or null when no tab is active. */
  scopeKey: string | null
  /** Provider model from live agent status, when the hook reported one. */
  reportedModel: string | null
  /** Effort level as the terminal's status line shows it, when observed. */
  reportedEffort?: string | null
  /** The agent's OWN name for the reported model ("Opus 4.8.5"); the catalog
   *  knows only families. See mobile-chat-model-row-naming.ts. */
  reportedModelLabel?: string | null
  /** Which source the report came from. A `'live'` reading — the agent's own
   *  beacon or badge — always outranks a locally dispatched guess; `'launch'`
   *  is the host's start-of-session record and only counts when it changes.
   *  See `mobile-native-chat-model-report-authority.ts`. */
  reportedModelSource?: ModelReportSource
  /** The tab's terminal. A scope outlives its terminal, so "this agent has
   *  stated its model" is remembered per terminal, not per scope. */
  terminalHandle?: string | null
  dispatchCommand: (
    command: string,
    options?: { delivery?: CatalogCommandDelivery }
  ) => Promise<MobileNativeChatSendOutcome>
  /** A model change that must happen in the agent's own TUI picker was
   *  dispatched — bring the terminal view forward. */
  onAgentPicker?: () => void
  /** Models discovered from the running agent (Codex: `codex debug models`),
   *  replacing the catalog's static seed so the sheet lists the account's own. */
  discoveredModels?: readonly CatalogModel[] | null
  /** Model apply to pair with `discoveredModels` (radio rows instead of the
   *  agent-picker action row). */
  discoveredModelApply?: CatalogOptionApply | null
  /** Apply a value some other way than typing a command (Codex drives its own
   *  picker). Resolves the outcome, or null to fall through to the command path. */
  applyOverride?: (id: string, value: SessionOptionValue) => Promise<boolean | null>
}): MobileNativeChatSessionOptionsController {
  const { agent, scopeKey, reportedModel, dispatchCommand, onAgentPicker } = args
  const reportedModelLabel = args.reportedModelLabel ?? null
  const { discoveredModels, discoveredModelApply, applyOverride } = args
  const reportedEffort = args.reportedEffort ?? null
  const reportedModelSource = args.reportedModelSource ?? 'launch'
  const terminalHandle = args.terminalHandle ?? null
  // The catalog id the agent is currently reporting, for `setOption` to stamp on
  // a pick. A ref because the dispatch runs in a callback, not in render.
  const reportedModelRef = useRef<string | null>(null)
  const catalog = useMemo(() => {
    // Widening this to a `defaultModelIsCliDefault` catalog (grok) also needs the
    // effective-model resolution desktop does — `previousModelId` below is tracked-only,
    // so a CLI-default model would render option rows that do nothing when tapped.
    const base =
      agent === 'claude' || agent === 'codex' ? getAgentSessionOptionCatalog(agent) : null
    return base && discoveredModels && discoveredModels.length > 0
      ? {
          ...base,
          models: [...discoveredModels],
          ...(discoveredModelApply ? { modelApply: discoveredModelApply } : {})
        }
      : base
  }, [agent, discoveredModelApply, discoveredModels])
  const identity = agent && scopeKey ? `${scopeKey}\0${agent}` : null
  const [version, setVersion] = useState(0)
  // Bumped when the grace on a dispatched model pick expires, so the seeding
  // effect re-runs and the agent's own report can overrule a pick it refused.
  const [reconcileTick, setReconcileTick] = useState(0)
  const [pendingByIdentity, setPendingByIdentity] = useState<
    Record<string, PendingOperation | undefined>
  >({})
  const pendingId = identity ? (pendingByIdentity[identity]?.id ?? null) : null
  const bump = useCallback(() => setVersion((current) => current + 1), [])
  const activeIdentityRef = useRef(identity)
  const applyQueuesRef = useRef(new Map<string, Promise<void>>())
  const operationTokenRef = useRef(0)

  useLayoutEffect(() => {
    activeIdentityRef.current = identity
    return () => {
      activeIdentityRef.current = null
    }
  }, [identity])

  // Restore the scope's picks from disk once per process. A pick made while the
  // read is in flight wins: the in-memory record then already exists and the
  // stored one is stale by definition.
  useEffect(() => {
    if (!scopeKey || !agent || hydratedScopes.has(scopeKey)) {
      return
    }
    hydratedScopes.add(scopeKey)
    if (recordsByScope.has(scopeKey)) {
      return
    }
    let active = true
    void readSessionOptionRecord(scopeKey).then((stored) => {
      if (!active || !stored || stored.agent !== agent) {
        return
      }
      const live = recordsByScope.get(scopeKey)
      if (!live) {
        recordsByScope.set(scopeKey, stored)
        bump()
        return
      }
      if (mergeStoredSessionOptionRecord(live, stored)) {
        bump()
      }
    })
    return () => {
      active = false
    }
  }, [agent, bump, scopeKey])

  // Every in-place mutation bumps `version`; write the record behind it.
  useEffect(() => {
    if (version === 0 || !scopeKey) {
      return
    }
    const record = recordsByScope.get(scopeKey)
    if (record) {
      void writeSessionOptionRecord(scopeKey, record).catch(() => undefined)
    }
  }, [scopeKey, version])

  // Why: a record persisted by an older build can hold a model this agent never
  // had (a Claude id leaked onto a Codex tab). Once the account's own list is
  // known, a tracked id outside it — and not what the footer reports — is stale.
  useEffect(() => {
    if (agent !== 'codex' || !scopeKey || !discoveredModels || discoveredModels.length === 0) {
      return
    }
    void version
    const record = getScopedRecord(scopeKey, agent)
    const tracked = typeof record.model?.value === 'string' ? record.model.value : null
    // Why not spare a tracked id that equals the report: the report is already
    // filtered to the account's list, so a match outside it cannot happen, and
    // an unfiltered older build's leak must not survive on that technicality.
    if (tracked && !discoveredModels.some((model) => model.id === tracked)) {
      clearNativeChatSessionModel(record)
      // Why: the seeding effect ignores a report it has already applied, so
      // without this the footer's (unchanged) model would never refill the pill.
      forgetModelReportScope(scopeKey)
      bump()
    }
  }, [agent, bump, discoveredModels, reportedModel, scopeKey, version])

  // Seed the current model from live agent status; hook reports are authority
  // over locally dispatched guesses (desktop 'reported' source parity).
  useEffect(() => {
    if (!catalog || !scopeKey || !agent || !reportedModel) {
      return
    }
    const seed = resolveReportedModelSeed({
      catalog,
      agent,
      reportedModel,
      reportedEffort,
      source: reportedModelSource,
      scopeKey,
      terminalHandle
    })
    if (!seed) {
      return
    }
    // Stamped even when the seed is not applied: it is also what the agent is
    // currently reporting, which a pick dispatched later records as its
    // `wasReporting`.
    reportedModelRef.current = seed.matched
    if (!seed.apply) {
      return
    }
    const matched = seed.matched
    const record = getScopedRecord(scopeKey, agent)
    const applyEffort = shouldApplyReportedEffort({
      scopeKey,
      reportedEffort,
      pickedSource: getTrackedSessionOption(record, matched, 'effort')?.source ?? null
    })
    if (
      applyNativeChatReportedSessionOptions(record, {
        model: matched,
        ...(applyEffort && reportedEffort ? { effort: reportedEffort } : {})
      })
    ) {
      bump()
    }
    // `reconcileTick` is in the deps so the grace expiring re-runs this. Without
    // it a pick the agent refused would sit there until the report happened to
    // change, which — the agent having not moved — it never does.
  }, [
    agent,
    bump,
    catalog,
    reconcileTick,
    reportedEffort,
    reportedModel,
    reportedModelSource,
    scopeKey,
    terminalHandle
  ])

  // Wake the seeding effect once the grace on a dispatched pick has passed.
  //
  // Scheduled for the time REMAINING on that pick, never a fresh full grace.
  // This effect re-runs on `version`, which every unrelated record write bumps —
  // an effort change, a typed command — and re-arming a full 6 s each time
  // starved the timer so it never fired: the pill stayed on a pick the agent had
  // refused for as long as the user kept touching anything else. Found by a
  // regression probe, 2026-09-15.
  useEffect(() => {
    const pick = scopeKey ? getPendingModelPick(scopeKey) : null
    if (!pick) {
      return
    }
    const remaining = Math.max(0, pick.at + MODEL_PICK_GRACE_MS - Date.now())
    const timer = setTimeout(() => setReconcileTick((tick) => tick + 1), remaining)
    return () => clearTimeout(timer)
    // `version` so a freshly dispatched pick arms this: the pending map is
    // module state, and `bump()` is what says it may have moved.
  }, [reconcileTick, scopeKey, version])

  const snapshot = useMemo(() => {
    if (!catalog || !scopeKey || !agent) {
      return EMPTY_SNAPSHOT
    }
    // Why: `version` invalidates this memo after in-place record mutations.
    void version
    const record = getScopedRecord(scopeKey, agent)
    return buildNativeChatSessionOptionSnapshot({
      catalog,
      // The snapshot no longer self-heals an unlisted tracked model; every caller
      // reconciles it in, so a value the seed dropped keeps its row and options.
      models: activeModels(catalog, record, reportedModel, reportedModelLabel),
      record,
      mode: 'live',
      modelLabel: 'Model',
      // The terminal lane drives the agent's own picker, not agentSession.setOption.
      liveTransport: 'catalog'
    })
  }, [agent, catalog, scopeKey, version])

  const runSerialized = useCallback(
    (operationIdentity: string, id: string, run: () => Promise<boolean>): Promise<boolean> => {
      const previous = applyQueuesRef.current.get(operationIdentity) ?? Promise.resolve()
      const runIfCurrent = (): Promise<boolean> =>
        activeIdentityRef.current === operationIdentity ? run() : Promise.resolve(false)
      const chained = previous.then(runIfCurrent, runIfCurrent)
      const tail = chained.then(
        () => undefined,
        () => undefined
      )
      applyQueuesRef.current.set(operationIdentity, tail)
      operationTokenRef.current += 1
      const token = operationTokenRef.current
      setPendingByIdentity((current) => ({
        ...current,
        [operationIdentity]: { id, token }
      }))
      void tail.then(() => {
        if (applyQueuesRef.current.get(operationIdentity) === tail) {
          applyQueuesRef.current.delete(operationIdentity)
        }
        setPendingByIdentity((current) => {
          if (current[operationIdentity]?.token !== token) {
            return current
          }
          const next = { ...current }
          delete next[operationIdentity]
          return next
        })
      })
      return chained
    },
    []
  )

  const setOption = useCallback(
    (id: string, value: SessionOptionValue): Promise<boolean> => {
      if (!catalog || !scopeKey || !agent || !identity) {
        return Promise.resolve(false)
      }
      return runSerialized(identity, id, async () => {
        const record = getScopedRecord(scopeKey, agent)
        const previousModelId = typeof record.model?.value === 'string' ? record.model.value : null
        const apply =
          id === 'model'
            ? catalog.modelApply
            : activeModels(catalog, record, reportedModel, reportedModelLabel)
                .find((model) => model.id === previousModelId)
                ?.options.find((option) => option.id === id)?.apply
        if (applyOverride) {
          const handled = await applyOverride(id, value)
          if (handled !== null) {
            if (handled) {
              if (id === 'model' && typeof value === 'string' && previousModelId !== value) {
                delete record.valuesByModel[value]
              }
              setTrackedSessionOption(record, id, value, 'dispatched')
              bump()
            }
            return handled
          }
        }
        if (!apply || apply.midSession?.kind === 'agent-picker') {
          return false
        }
        const flipOnly = isFlipOnlyMidSession(apply.midSession)
        const trackedToggle = flipOnly
          ? getTrackedSessionOption(record, previousModelId, id)
          : undefined
        if (flipOnly && !trackedToggle) {
          // Why: a flip from an unknown baseline cannot honor an absolute target.
          return false
        }
        // Why: same absolute target must never re-dispatch a flip (would invert the agent).
        if (flipOnly && trackedToggle?.value === value) {
          return true
        }
        const command = buildNativeChatSessionOptionCommand({
          optionId: id,
          value,
          apply,
          modelId: previousModelId,
          catalog,
          models: activeModels(catalog, record, reportedModel, reportedModelLabel),
          record
        })
        if (!command) {
          return false
        }
        // Baseline for detecting a hook report or typed command that lands while
        // the dispatch is in flight — the record is shared mutable state and the
        // report effect is not on this queue.
        const trackedBeforeDispatch =
          id === 'model' ? undefined : getTrackedSessionOption(record, previousModelId, id)
        const outcome = await dispatchCommand(command)
        if (outcome === 'rejected') {
          return false
        }
        if (id !== 'model') {
          // Why (desktop parity): `setTrackedSessionOption` resolves the owning
          // model when it commits, not when the command was built. If the model
          // moved during the dispatch, committing now would file this value under
          // the NEW model — claiming an effort the agent was never asked for.
          const modelStill = typeof record.model?.value === 'string' ? record.model.value : null
          if (
            modelStill !== previousModelId ||
            getTrackedSessionOption(record, previousModelId, id) !== trackedBeforeDispatch
          ) {
            return true
          }
        }
        if (id === 'model') {
          if (typeof value === 'string' && previousModelId !== value) {
            // Why: switching models can reset effort/toggles for the destination model.
            delete record.valuesByModel[value]
          }
          // A request, not a fact: remember it, with what the agent was saying
          // at the time, so its own report can overrule the pick if the switch
          // never happened.
          if (typeof value === 'string' && scopeKey) {
            notePendingModelPick(scopeKey, value, reportedModelRef.current)
          }
        }
        // Why: flip-only never heals via agent report — track as applied best-known.
        setTrackedSessionOption(record, id, value, flipOnly ? 'applied' : 'dispatched')
        bump()
        return true
      })
    },
    [agent, applyOverride, bump, catalog, dispatchCommand, identity, runSerialized, scopeKey]
  )

  const invokeAction = useCallback(
    (id: string): Promise<boolean> => {
      if (!catalog || !scopeKey || !agent || !identity) {
        return Promise.resolve(false)
      }
      return runSerialized(identity, id, async () => {
        const record = getScopedRecord(scopeKey, agent)
        const modelId = typeof record.model?.value === 'string' ? record.model.value : null
        const apply =
          id === 'model'
            ? catalog.modelApply
            : activeModels(catalog, record, reportedModel, reportedModelLabel)
                .find((model) => model.id === modelId)
                ?.options.find((option) => option.id === id)?.apply
        const midSession = apply?.midSession
        if (midSession?.kind === 'agent-picker') {
          const outcome = midSession.delivery
            ? await dispatchCommand(midSession.command, { delivery: midSession.delivery })
            : await dispatchCommand(midSession.command)
          if (outcome === 'rejected') {
            return false
          }
          clearNativeChatSessionModel(record)
          bump()
          onAgentPicker?.()
          return true
        }
        if (isFlipOnlyMidSession(midSession) && !getTrackedSessionOption(record, modelId, id)) {
          // Why: an unknown baseline remains unknown after one inversion.
          return (await dispatchCommand(midSession.command)) !== 'rejected'
        }
        return false
      })
    },
    [agent, bump, catalog, dispatchCommand, identity, onAgentPicker, runSerialized, scopeKey]
  )

  const recordCommand = useCallback(
    (command: string): void => {
      if (!catalog || !scopeKey || !agent) {
        return
      }
      const record = getScopedRecord(scopeKey, agent)
      const result = recordNativeChatSessionOptionCommand({
        catalog,
        models: activeModels(catalog, record, reportedModel, reportedModelLabel),
        record,
        command
      })
      if (result.changed) {
        bump()
      }
      if (result.opensAgentPicker) {
        onAgentPicker?.()
      }
    },
    [agent, bump, catalog, onAgentPicker, scopeKey]
  )

  // Why here and not in the header: this hook is what knows the scope and the
  // terminal, and the header would have to be handed both just to re-derive it.
  const modelConfirmed =
    scopeKey !== null && hasSeenLiveModelReport(scopeKey, terminalHandle)

  return useMemo(
    () => ({ snapshot, pendingId, setOption, invokeAction, recordCommand, modelConfirmed }),
    [snapshot, pendingId, setOption, invokeAction, recordCommand, modelConfirmed]
  )
}
