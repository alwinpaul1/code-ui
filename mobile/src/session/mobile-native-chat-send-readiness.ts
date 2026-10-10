import { useMemo, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RelayHostReachability } from '../transport/relay-host-reachability'
import type { StableLogicalRpcClient } from '../transport/stable-logical-rpc-client'
import { appWasAwayLongEnoughSince, SEND_BUDGET_SPENT_AWAY } from './mobile-native-chat-send-budget-refusal'
import { noteSendPath, noteSendStage } from './native-chat-send-timing'

/** What a send needs to be true before it writes anything, read from the render
 *  that is current when the send looks, not the one that was current at the tap. */
export type MobileNativeChatSendConditions = {
  readonly client: RpcClient | null
  /** The lane's own gate with the socket up: the input lease for a terminal
   *  chat, the loaded session for a structured one. */
  readonly sendable: boolean
  /** Who a send is addressed to (a tab's scope, a session's key). A wait that
   *  sees it change gives up: the tapped send belongs to the one it started on. */
  readonly target?: string | null
}

/** A terminal chat's input is its lease; a structured session's is its load. */
export type MobileNativeChatSendLane = 'terminal' | 'session'

/** Why a send gave up before it wrote anything, in the terms its message uses. */
export type MobileNativeChatSendUnready = {
  readonly ready: false
  readonly missing: 'connection' | 'pairing' | 'input' | 'session'
  readonly waitedMs: number
  /** The relay's own verdict on the desktop, when the client carries one. */
  readonly reachability: RelayHostReachability | null
  /** This client has never been connected (a cold start, not a drop). */
  readonly neverConnected: boolean
  /** The link came back, but too little of the budget was left to write in. */
  readonly late: boolean
  /** The app was out of the foreground for a write's worth or more while the send
   *  waited: Android ran no timer then, so the wait (and the link's redial) could not run. */
  readonly away: boolean
}

export type MobileNativeChatSendReadiness =
  | { readonly ready: true; readonly client: RpcClient }
  | MobileNativeChatSendUnready

/** What a wait leaves of the send's budget for the writes that follow it: the
 *  clear and the body each refuse to start with less than
 *  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS (2 s) left. */
export const MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS = 4_000
// Readiness changes on a render (the lease, the session), not on an event this
// module can subscribe to, so the wait looks again on a short beat.
const MOBILE_NATIVE_CHAT_SEND_READY_POLL_MS = 100

/** A lane's send gate. Each call resolves to the client to write on, or to
 *  null once the one line saying why not has gone to `onUnready`. */
export type MobileNativeChatSendGate = {
  /** Waits for the link and the lane, on the send's own budget. */
  readonly wait: (deadline: number, abandoned?: () => boolean) => Promise<RpcClient | null>
  /** Does not wait: for a write chosen against a screen the phone has not
   *  seen since the link dropped (a card answer, a command). `onUnready`
   *  replaces the gate's own for this one call: a pick from the option drawer
   *  says its refusal in the drawer, over the banner the gate's own draws on. */
  readonly now: (action?: string, onUnready?: (message: string) => void) => RpcClient | null
  /** Whether a send could write right now; reports nothing. */
  readonly isReady: () => boolean
}

/** Reads the conditions of the latest render, so a send that started in an
 *  earlier one sees the link come back. */
export function useMobileNativeChatSendGate(
  args: MobileNativeChatSendConditions & {
    /** The noun the refusal starts with: "Message not sent: …". */
    readonly action: string
    readonly lane?: MobileNativeChatSendLane
    readonly onUnready: (message: string) => void
  }
): MobileNativeChatSendGate {
  const latest = useRef(args)
  latest.current = args
  return useMemo(() => {
    const read = (): MobileNativeChatSendConditions => latest.current
    const settle = (
      readiness: MobileNativeChatSendReadiness,
      action?: string,
      onUnready: (message: string) => void = latest.current.onUnready
    ): RpcClient | null => {
      if (readiness.ready) {
        return readiness.client
      }
      onUnready(
        mobileNativeChatSendUnreadyMessage(action ?? latest.current.action, readiness, latest.current.lane)
      )
      return null
    }
    return {
      wait: async (deadline, abandoned) => {
        const startedAt = Date.now()
        const readiness = await waitForMobileNativeChatSendable({ read, deadline, abandoned })
        // How long the send waited for the link and the lane, and the path it then had.
        noteSendStage('readiness', Date.now() - startedAt)
        if (readiness.ready) {
          noteSendPath((readiness.client as Partial<StableLogicalRpcClient>).getActivePath?.())
        }
        return settle(readiness)
      },
      now: (action, onUnready) => settle(mobileNativeChatSendReadinessNow(read()), action, onUnready),
      isReady: () => readyClient(read()) !== null
    }
  }, [])
}

function readyClient(conditions: MobileNativeChatSendConditions): RpcClient | null {
  // The live state as well as the rendered gate: the socket can die a render
  // before `sendable` hears about it, and a relay session that has died refuses
  // every request at once (relay-session-dead-fast-fail.test.ts).
  const { client } = conditions
  return client !== null && conditions.sendable && client.getState() === 'connected'
    ? client
    : null
}

/** Whether a send may write right now, without waiting: for a write that must
 *  not outlive the screen it was chosen against. */
export function mobileNativeChatSendReadinessNow(
  conditions: MobileNativeChatSendConditions
): MobileNativeChatSendReadiness {
  const client = readyClient(conditions)
  return client ? { ready: true, client } : mobileNativeChatSendUnready(conditions)
}

/** The refusal of a write whose own render gate said no and that must not
 *  wait (a card answer, a cancel), in the same words a waiting send uses. */
export function mobileNativeChatSendRefusal(
  action: string,
  conditions: MobileNativeChatSendConditions
): string {
  return mobileNativeChatSendUnreadyMessage(action, mobileNativeChatSendUnready(conditions))
}

function mobileNativeChatSendUnready(
  conditions: MobileNativeChatSendConditions,
  waitedMs = 0,
  late = false,
  /** When the wait began; null for a look that did not wait. */
  waitedSince: number | null = null
): MobileNativeChatSendUnready {
  const { client } = conditions
  const state = client?.getState() ?? 'disconnected'
  const logical = client as Partial<StableLogicalRpcClient> | null
  const missing = state === 'auth-failed' ? 'pairing' : state === 'connected' ? 'input' : 'connection'
  return {
    ready: false,
    missing: late ? 'connection' : missing,
    waitedMs,
    reachability: logical?.getRelayHostReachability?.() ?? null,
    neverConnected: missing === 'connection' && (client?.getLastConnectedAt() ?? null) === null,
    late,
    away: waitedSince !== null && appWasAwayLongEnoughSince(waitedSince)
  }
}

/**
 * Resolves once a send may write, or says why it may not within its budget.
 *
 * Why wait at all: on the relay, which is the only path this phone has at home,
 * a relay session that loses its socket is never revived. It publishes
 * 'disconnected', the supervisor dials a replacement after its backoff, and
 * the logical client is 'connected' again only once that replacement has been
 * migrated in. A send tapped in that gap was refused at once, and the dead
 * session would have refused its request anyway. Nothing has been written when
 * this runs, so a send that waits here and then goes cannot be a second copy.
 */
export async function waitForMobileNativeChatSendable(args: {
  read: () => MobileNativeChatSendConditions
  /** The send's own budget (openMobileNativeChatSendBudget): the wait spends it. */
  deadline: number
  /** True once the send's target has gone (another terminal, another tab). */
  abandoned?: () => boolean
}): Promise<MobileNativeChatSendReadiness> {
  const startedAt = Date.now()
  const target = args.read().target
  let nudged: RpcClient | null = null
  for (let waited = false; ; waited = true) {
    const conditions = args.read()
    const elapsed = Date.now() - startedAt
    // Before readiness: a lane that comes ready for the next tab says nothing
    // about the one the send was tapped on.
    if (conditions.target !== target || args.abandoned?.()) {
      return { ...mobileNativeChatSendUnready(conditions, elapsed), missing: 'session' }
    }
    const remainingMs = args.deadline - MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS - Date.now()
    const client = readyClient(conditions)
    if (client) {
      // A send that had to wait starts its writes only with the reserve left.
      // A late timer (a suspended JS thread) can wake it with less, and then
      // even the clear and the body may not both fit. The reserve covers two
      // writes; a send of more (Codex's Tab, several photos) can still run
      // short on a slow relay, as it could before any wait.
      return !waited || remainingMs >= 0
        ? { ready: true, client }
        : mobileNativeChatSendUnready(conditions, elapsed, true, startedAt)
    }
    const state = conditions.client?.getState()
    // A refused pairing never comes back by itself; waiting only delays the news.
    if (state === 'auth-failed') {
      return mobileNativeChatSendUnready(conditions, elapsed)
    }
    // The tap is the user asking for the link now. A relay cooling down after
    // the desktop's peer dropped re-dials at once instead of at the end of its
    // backoff (the 'user-send' reason, mobile-relay-reconnect-controller.ts).
    if (conditions.client && state !== 'connected' && nudged !== conditions.client) {
      nudged = conditions.client
      conditions.client.notifyForeground('user-send')
    }
    if (remainingMs <= 0) {
      return mobileNativeChatSendUnready(conditions, elapsed, false, startedAt)
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(MOBILE_NATIVE_CHAT_SEND_READY_POLL_MS, remainingMs))
    )
  }
}

// The relay's verdict names the desktop's state outright; it outranks a bare
// "did not come back" because it says what to do about it.
const RELAY_REACHABILITY_REASON: Partial<Record<RelayHostReachability, string>> = {
  'host-offline': "your desktop is offline. Check it's awake and Orca is running",
  'signed-out': 'Orca on your desktop is signed out. Sign in there to reconnect',
  'credential-refused': 'relay access expired. Re-pair with your desktop',
  unreachable: "this phone can't reach the Relay. Check your connection"
}

function connectionReason(unready: MobileNativeChatSendUnready, within: string): string {
  // A wait the app spent in the background is the app's, not the desktop's: no
  // timer ran, so neither the wait nor the link's redial could (2026-10-09).
  if (unready.late) {
    return unready.away ? SEND_BUDGET_SPENT_AWAY : 'your desktop came back too late to send it. Send it again'
  }
  const relayReason = unready.reachability
    ? RELAY_REACHABILITY_REASON[unready.reachability]
    : undefined
  if (relayReason) {
    return relayReason
  }
  if (unready.away) {
    return SEND_BUDGET_SPENT_AWAY
  }
  if (!within) {
    return 'not connected to your desktop'
  }
  return unready.neverConnected
    ? `could not reach your desktop${within}`
    : `the connection to your desktop dropped and did not come back${within}`
}

/** The one line a send that never wrote leaves behind, saying where to look. */
export function mobileNativeChatSendUnreadyMessage(
  action: string,
  unready: MobileNativeChatSendUnready,
  lane: MobileNativeChatSendLane = 'terminal'
): string {
  const waitedS = Math.round(unready.waitedMs / 1_000)
  const within = waitedS >= 1 ? ` within ${waitedS} s` : ''
  switch (unready.missing) {
    case 'session':
      return `${action} not sent (session changed)`
    case 'pairing':
      return `${action} not sent: pairing invalid. Re-pair with your desktop`
    case 'input':
      if (lane === 'session') {
        return within
          ? `${action} not sent: the session on your desktop did not load${within}`
          : `${action} not sent: the session on your desktop has not loaded yet`
      }
      return within
        ? `${action} not sent: the desktop terminal did not take input from this phone${within}`
        : `${action} not sent: the desktop terminal is not taking input from this phone yet`
    case 'connection':
      return `${action} not sent: ${connectionReason(unready, within)}`
    default: {
      const exhaustive: never = unready.missing
      return exhaustive
    }
  }
}
