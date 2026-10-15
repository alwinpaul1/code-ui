import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CcrEvent } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import type { CcrLinkPhase } from './ccr-session-link-types'
import { ccrSessionOffline } from './ccr-send'
import { defaultCcrUsageAskDeps, type CcrUsageAskDeps } from './use-ccr-usage-sheet'
import {
  CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS,
  CCR_CONTROL_LANE,
  CCR_SET_MODEL_TIMEOUT_MS,
  CCR_SET_PERMISSION_MODE_TIMEOUT_MS,
  ccrEffortOutcomeMessage,
  ccrEffortSettings,
  ccrModeOutcomeMessage,
  ccrModelOutcomeMessage,
  ccrRewindOutcomeMessage,
  CCR_REWIND_NOT_CONNECTED,
  CCR_REWIND_TIMEOUT_MS,
  postCcrInterrupt,
  sendCcrControlRequest
} from './ccr-control-request'
import {
  buildCcrPermissionResponseBody,
  CCR_APPROVE_FAILED,
  CCR_DENY_FAILED,
  ccrPermissionCard,
  ccrPermissionChoice,
  ccrPermissionModeName,
  ccrStatedPermissionMode,
  pendingCcrPermission,
  type CcrPendingPermission,
  type CcrPermissionChoice
} from './ccr-permission-request'
import { registerCcrPermissionAnswerer } from './ccr-permission-answerers'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import type { TerminalPermissionMode } from './claude-terminal-mode-footer'
import type { PickDispatch } from './session-option-pick-failure'

/**
 * The control lane of a Claude tab matched to its Remote Control session (ccr-control-request.ts,
 * ccr-permission-request.ts): Stop, the permission mode, the model, the effort and permission
 * answers go to Anthropic, as the Claude app sends them, while the tab's link is live. Without a
 * live link every entry point is absent (or passes through) and the terminal path stays the route.
 *
 * Every request goes to the tab's OWN session with its own account (`ccrSendTargetForTab`, read
 * at the moment of the action, as the send lane does), and only while that is the session the
 * chat's link is reading: a copy of the session under another profile is never driven.
 */

export type CcrControlLaneArgs = {
  /** The tab sends through Anthropic (`claudeSendsThroughAnthropic`). */
  enabled: boolean
  /** The tab's target read NOW (ccrSendTargetForTab). */
  resolveTarget: () => CcrSendTarget
  /** The session the chat's link reads (the gate's match), or null. */
  linkSessionId: string | null
  linkPhase: CcrLinkPhase | null
  connectionStatus: string | null
  /** The link's events, oldest first. */
  events: readonly CcrEvent[]
  onSendError: (message: string) => void
  /** Where the tab is, so a notification's answer can reach the prompt this lane holds. */
  scope?: { hostId: string; worktreeId: string; tabId: string | null }
  /** For tests: how a request reaches the session (the shared link by default). */
  makeDeps?: CcrUsageAskDeps
  /** Tests turn it on; the app reads the one switch (CCR_CONTROL_LANE). */
  switchOn?: boolean
}

/** A Stop tap: `onVerdict` hears whether the stop went (use-chat-stop-button.ts). */
export type CcrStop = (onVerdict?: (sent: boolean) => void) => void

function laneSwitchedOn(args: Pick<CcrControlLaneArgs, 'enabled' | 'switchOn'>): boolean {
  return args.enabled && (args.switchOn ?? CCR_CONTROL_LANE)
}

export type CcrControlLane = {
  /** Whether the lane drives this tab now. */
  live: boolean
  /** Stop given the terminal's Stop: an `interrupt` into the session while the lane is live,
   *  falling back to `fallback` when it fails; `fallback` itself when the lane is not live.
   *  `canStop` is whether the turn works now (the Stop button's own flag): a fallback due after
   *  it went false types nothing. */
  wrapStop: (fallback: CcrStop, canStop: boolean) => CcrStop
  /** A mode pick through `set_permission_mode`: the failure's words, or null when it went.
   *  Undefined when the lane is not live (the terminal's Shift+Tab then). */
  setPermissionMode: ((mode: TerminalPermissionMode) => Promise<string | null>) | undefined
  /** The session's mode by its own word (or the pick it took since), or null with no live link. */
  permissionMode: TerminalPermissionMode | null
  /** A pick's dispatch: `/model <id>` and `/effort <level>` go as control requests while live. */
  wrapDispatch: (fallback: PickDispatch) => PickDispatch
  /** The prompt the session waits on, as the chat's card; null with none or no live link. */
  permission: MobileChatPermission | null
  /** Answers the card's option `send`; null when the send is not this lane's. */
  respondPermission: (send: string, comment?: string) => Promise<boolean> | null
  /** A refusal card's Edit and retry: `rewind_conversation` to the refused prompt. The failure's
   *  words, or null when the session rewound. Undefined when the lane is not live. */
  rewindTo: ((messageUuid: string) => Promise<string | null>) | undefined
}

/** Whether the lane drives the tab: a resolved target that IS the linked session, a live stream,
 *  and a Claude Code that has not left the session. */
export function ccrControlLaneLive(input: { enabled: boolean; target: CcrSendTarget; linkSessionId: string | null; linkPhase: CcrLinkPhase | null; connectionStatus: string | null }): boolean {
  return input.enabled && input.target.kind === 'target' && input.target.sessionId === input.linkSessionId && input.linkPhase === 'live' && !ccrSessionOffline(input.connectionStatus)
}

const MODEL_COMMAND = /^\/model\s+(\S+)\s*$/
const EFFORT_COMMAND = /^\/effort\s+(\S+)\s*$/

export function useCcrControlLane(args: CcrControlLaneArgs): CcrControlLane {
  const makeDeps = args.makeDeps ?? defaultCcrUsageAskDeps
  const on = laneSwitchedOn(args)
  const target = on ? args.resolveTarget() : ({ kind: 'refused', reason: 'unmatched' } as const)
  const live = ccrControlLaneLive({ enabled: on, target, linkSessionId: args.linkSessionId, linkPhase: args.linkPhase, connectionStatus: args.connectionStatus })
  const latest = useRef(args)
  latest.current = args
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set())
  const [pickedMode, setPickedMode] = useState<{ sessionId: string; mode: TerminalPermissionMode; statedKey: string | null } | null>(null)
  const sessionId = target.kind === 'target' ? target.sessionId : null
  useEffect(() => {
    setAnswered(new Set())
    setPickedMode(null)
  }, [sessionId])

  /** Runs `run` with the target read now, when it is still the live linked session; else null. */
  const withTarget = useCallback(<T,>(run: (deps: ReturnType<CcrUsageAskDeps>['deps'], sessionId: string) => Promise<T>): Promise<T> | null => {
    const now = latest.current
    const current = laneSwitchedOn(now) ? now.resolveTarget() : null
    if (!current || current.kind !== 'target' || !ccrControlLaneLive({ enabled: true, target: current, linkSessionId: now.linkSessionId, linkPhase: now.linkPhase, connectionStatus: now.connectionStatus })) {
      return null
    }
    const held = makeDeps(current.accountId, current.sessionId)
    return run(held.deps, current.sessionId).finally(held.release)
  }, [makeDeps])

  // Stop must stop the turn even when the unproven interrupt does not land: a refused or
  // unanswered POST falls back to the terminal's Escape, which itself says the app's words when
  // the relay is down too. One line names why the interrupt failed and what Stop did instead.
  // The fallback runs only for the newest tap, while the turn still works and the chat is still
  // mounted: a late one typed Escape twice into an idle Claude, into the last terminal after the
  // chat closed, or into the next turn on top of that turn's own Stop (review 2026-10-15).
  const tapRef = useRef(0)
  const turnWorking = useRef(false)
  const mounted = useRef(true)
  const timers = useRef(new Set<() => void>())
  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const cancel of pending) {
        cancel()
      }
      pending.clear()
    }
  }, [])
  const setTimer = useCallback((run: () => void, ms: number): (() => void) => {
    const cancel = (): void => {
      clearTimeout(handle)
      timers.current.delete(cancel)
    }
    const handle = setTimeout(() => {
      timers.current.delete(cancel)
      run()
    }, ms)
    timers.current.add(cancel)
    return cancel
  }, [])
  const makeStop = useCallback(
    (fallback: CcrStop): CcrStop =>
      (onVerdict) => {
        const tap = (tapRef.current += 1)
        const sent = withTarget((deps, session) => postCcrInterrupt(deps, session, setTimer))
        void (sent ?? Promise.resolve('the tab has no live Anthropic session now')).then((cause) => {
          if (cause === null) {
            onVerdict?.(true)
            return
          }
          const skip = !mounted.current ? 'the chat closed' : tap !== tapRef.current ? 'a newer Stop took over' : !turnWorking.current ? 'the turn already ended' : null
          if (skip) {
            console.warn(`[ccr-control] interrupt failed (${cause}) — no Escape: ${skip}`)
            return
          }
          console.warn(`[ccr-control] interrupt failed (${cause}) — stopping with Escape on the terminal`)
          fallback(onVerdict)
        })
      },
    [setTimer, withTarget]
  )
  const stops = useRef(new WeakMap<CcrStop, CcrStop>())
  const wrapLiveStop = useCallback(
    (fallback: CcrStop): CcrStop => {
      const known = stops.current.get(fallback)
      if (known) {
        return known
      }
      const made = makeStop(fallback)
      stops.current.set(fallback, made)
      return made
    },
    [makeStop]
  )

  const setPermissionMode = useCallback(
    async (mode: TerminalPermissionMode): Promise<string | null> => {
      const stated = ccrStatedPermissionMode(latest.current.events)
      const outcome = await (withTarget((deps, session) => sendCcrControlRequest(deps, session, { subtype: 'set_permission_mode', mode: ccrPermissionModeName(mode) }, CCR_SET_PERMISSION_MODE_TIMEOUT_MS).then((result) => ({ result, session }))) ?? Promise.resolve(null))
      if (!outcome) {
        console.warn('[ccr-control] set_permission_mode not sent — the tab has no live Anthropic session now')
        return ccrModeOutcomeMessage('unsent')
      }
      // Only a success moves the pill. The app keeps an unanswered pick (bto.java:262-273); with
      // bodies not yet proven, an unanswered pick may not have landed, so the pill keeps what the
      // session last stated.
      if (outcome.result === 'applied') {
        setPickedMode({ sessionId: outcome.session, mode, statedKey: stated?.key ?? null })
      }
      return ccrModeOutcomeMessage(outcome.result)
    },
    [withTarget]
  )

  // One wrapper per fallback, so a stable dispatch stays stable through the wrap.
  const wrapped = useRef(new WeakMap<PickDispatch, PickDispatch>())
  const makeWrapper = useCallback(
    (fallback: PickDispatch): PickDispatch =>
      async (command, options) => {
        const model = MODEL_COMMAND.exec(command)?.[1]
        const effort = model ? undefined : EFFORT_COMMAND.exec(command)?.[1]
        const sent = model
          ? withTarget((deps, session) => sendCcrControlRequest(deps, session, { subtype: 'set_model', model }, CCR_SET_MODEL_TIMEOUT_MS))
          : effort
            ? withTarget((deps, session) => sendCcrControlRequest(deps, session, { subtype: 'apply_flag_settings', settings: ccrEffortSettings(effort) }, CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS))
            : null
        if (!sent) {
          return options ? fallback(command, options) : fallback(command)
        }
        const outcome = await sent
        const message = model ? ccrModelOutcomeMessage(outcome) : ccrEffortOutcomeMessage(outcome)
        if (message) {
          ;(options?.onError ?? latest.current.onSendError)(message)
          return 'rejected'
        }
        return 'accepted'
      },
    [withTarget]
  )
  const wrapDispatch = useCallback(
    (fallback: PickDispatch): PickDispatch => {
      const known = wrapped.current.get(fallback)
      if (known) {
        return known
      }
      const made = makeWrapper(fallback)
      wrapped.current.set(fallback, made)
      return made
    },
    [makeWrapper]
  )

  const pending = useMemo(() => (live ? pendingCcrPermission(args.events, answered) : null), [answered, args.events, live])
  const permission = useMemo(() => (pending ? ccrPermissionCard(pending) : null), [pending])
  /** Posts the answer to `asked` into the tab's own session; null when the lane is not live. */
  const postAnswer = useCallback(
    (asked: CcrPendingPermission, choice: CcrPermissionChoice, comment?: string): Promise<boolean> | null => {
      const posted = withTarget(async (deps, session) => {
        try {
          await deps.post(buildCcrPermissionResponseBody({ sessionId: session, uuid: deps.newUuid(), pending: asked, choice, ...(comment ? { comment } : {}) }))
          return true
        } catch (error) {
          deps.log(`[ccr-control] permission ${choice} failed — the answer was not posted: ${error instanceof Error ? error.message : String(error)}`)
          return false
        }
      })
      return (
        posted?.then((ok) => {
          if (ok) {
            setAnswered((before) => new Set(before).add(asked.requestId))
          }
          return ok
        }) ?? null
      )
    },
    [withTarget]
  )
  const respondPermission = useCallback(
    (send: string, comment?: string): Promise<boolean> | null => {
      const tapped = ccrPermissionChoice(send)
      if (!tapped) {
        return null
      }
      const { choice, requestId } = tapped
      const failed = choice === 'deny' ? CCR_DENY_FAILED : CCR_APPROVE_FAILED
      const asked = pendingCcrPermission(latest.current.events)
      if (asked?.requestId !== requestId) {
        console.warn(`[ccr-control] permission ${choice} not sent — the session is no longer waiting on that prompt`)
        latest.current.onSendError(failed)
        return Promise.resolve(false)
      }
      const posted = postAnswer(asked, choice, comment)
      if (!posted) {
        console.warn(`[ccr-control] permission ${choice} not sent — the tab has no live Anthropic session now`)
      }
      return (posted ?? Promise.resolve(false)).then((ok) => {
        if (!ok) {
          latest.current.onSendError(failed)
        }
        return ok
      })
    },
    [postAnswer]
  )

  // A notification's Approve / Deny reaches the prompt this lane holds (ccr-permission-answerers.ts).
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const hostId = args.scope?.hostId ?? null, worktreeId = args.scope?.worktreeId ?? null, tabId = args.scope?.tabId ?? null
  useEffect(() => {
    if (!live || !hostId || !worktreeId || !tabId) {
      return undefined
    }
    return registerCcrPermissionAnswerer(hostId, worktreeId, tabId, {
      pending: () => pendingRef.current,
      answer: async (asked, choice, comment) => (await postAnswer(asked, choice, comment)) ?? false
    })
  }, [hostId, live, postAnswer, tabId, worktreeId])

  const rewindTo = useCallback(
    async (messageUuid: string): Promise<string | null> => {
      const outcome = withTarget((deps, session) => sendCcrControlRequest(deps, session, { subtype: 'rewind_conversation', target_message_uuid: messageUuid, interrupt_if_running: true }, CCR_REWIND_TIMEOUT_MS))
      return outcome ? ccrRewindOutcomeMessage(await outcome) : CCR_REWIND_NOT_CONNECTED
    },
    [withTarget]
  )

  const stated = useMemo(() => (live ? ccrStatedPermissionMode(args.events) : null), [args.events, live])
  const picked = pickedMode && pickedMode.sessionId === sessionId && (stated?.key ?? null) === pickedMode.statedKey ? pickedMode.mode : null
  return {
    live,
    wrapStop: (fallback, canStop) => {
      // Read at each render, as `latest` is: whether the turn still works when a fallback is due.
      turnWorking.current = canStop
      return live ? wrapLiveStop(fallback) : fallback
    },
    setPermissionMode: live ? setPermissionMode : undefined,
    permissionMode: live ? (picked ?? stated?.mode ?? null) : null,
    wrapDispatch,
    permission,
    respondPermission,
    rewindTo: live ? rewindTo : undefined
  }
}
