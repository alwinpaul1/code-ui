import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { getPendingModelPick } from './mobile-native-chat-model-report-authority'
import { resolveClaudeModelFallback, withSessionCommandPair, type ClaudeModelFallback } from './claude-transcript-model'
import { sessionCommandPairFor } from './claude-session-command-pair'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  peekClaudeTranscriptModel,
  requestClaudeTranscriptModelScan,
  subscribeClaudeTranscriptModelScans,
  watchClaudeTranscriptModelHost
} from './claude-transcript-model-scan'

/** How long a Claude chat must go without a beacon or a badge before the phone
 *  asks the host. A beaconed tab repaints its status line — and so beacons —
 *  every 5 s while idle (agent-hud-launch-args.ts), and the badge arrives with
 *  the first screen read, so a tab that is going to speak has spoken by then.
 *  Only a Windows host (no flag at all), a tab launched before the flag, or a
 *  session under a dialog stays quiet this long. */
export const CLAUDE_TRANSCRIPT_MODEL_SETTLE_MS = 8_000

const NONE: ClaudeModelFallback = { kind: 'none' }

type PickProgress = {
  pickAt: number
  phase: 'awaiting-start' | 'in-turn' | 'settled'
  /** When the first turn begun after the pick ended (the phone's clock). */
  settledAt: number | null
}

/** Per chat scope, how far the phone's last pick has got. Module-level so it
 *  outlives the chat/terminal flips that remount the controller, as the pending
 *  pick itself does (mobile-native-chat-model-report-authority.ts). */
const pickProgress = new Map<string, PickProgress>()

export function resetClaudeTranscriptModelPicksForTests(): void {
  pickProgress.clear()
}

/**
 * The model the pills state for a Claude chat whose agent states none itself.
 *
 * Asks the host (claude-transcript-model-scan.ts, which holds the five-minute
 * budget) only on:
 * - the chat opening, once it has stayed quiet for the settle time, and again
 *   on each new connection after that (the repo's "nothing stays stale once
 *   the relay connects"; the budget still applies);
 * - the user opening the model sheet (`requestScan`);
 * - the end of the first turn begun after the phone changed the model itself —
 *   the first moment a reply written under the switch exists. Asking at the
 *   pick could only return what answered before it, and Claude Code applies a
 *   `/model` sent mid-turn only when that turn ends. This one is forced, and
 *   when the budget holds it back the scan module runs it once it allows.
 * Never on every turn end.
 *
 * Whatever the last scan said about this exact session is stated at once, and
 * the moment a live pair arrives the answer is `none`: the beacon and the
 * badge always win.
 */
export function useClaudeTranscriptModel(args: {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  tabId: string | null
  sessionId: string | null
  /** A Claude chat on the terminal lane is on screen. */
  enabled: boolean
  connected: boolean
  /** The live pair's model: the beacon or the badge. */
  liveModel: string | null
  /** This session's beacon has been heard. */
  beacon: boolean
  agentWorking: boolean
  /** The session's rows: its own /model and /effort output lies over the scan
   *  (claude-session-command-pair.ts). Absent: none. */
  messages?: readonly NativeChatMessage[]
}): { fallback: ClaudeModelFallback; requestScan: () => void } {
  const { client, hostId, worktreeId, tabId, sessionId, enabled, connected, liveModel, beacon, agentWorking, messages } = args
  const quiet = enabled && sessionId !== null && !liveModel && !beacon
  const lastConnectedAt = useLastConnectedAt(hostId)
  const [, setVersion] = useState(0)
  useEffect(() => subscribeClaudeTranscriptModelScans(() => setVersion((value) => value + 1)), [])

  useEffect(() => (quiet ? watchClaudeTranscriptModelHost(hostId) : undefined), [hostId, quiet])

  const scan = useCallback(
    (force: boolean) => {
      if (quiet && connected && client) {
        void requestClaudeTranscriptModelScan(client, hostId, worktreeId, {
          force,
          connection: lastConnectedAt
        })
      }
    },
    [client, connected, hostId, lastConnectedAt, quiet, worktreeId]
  )
  const request = useCallback(() => scan(false), [scan])

  // The chat opening: only once it has stayed quiet for the settle time.
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const quietKey = quiet ? `${hostId}\u0000${sessionId}` : null
  useEffect(() => {
    if (!quietKey) {
      return
    }
    const timer = setTimeout(() => setSettledFor(quietKey), CLAUDE_TRANSCRIPT_MODEL_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [quietKey])
  const settled = quietKey !== null && settledFor === quietKey
  useEffect(() => {
    if (settled) {
      request()
    }
  }, [settled, lastConnectedAt, request])

  // The phone's own pick, and whether a turn begun after it has ended yet.
  const scopeKey = mobileNativeChatScopeKey(hostId, worktreeId, tabId)
  const pending = quiet && scopeKey ? getPendingModelPick(scopeKey) : null
  const workingRef = useRef(agentWorking)
  useEffect(() => {
    const wasWorking = workingRef.current
    workingRef.current = agentWorking
    if (!pending || !scopeKey) {
      return
    }
    const progress = pickProgress.get(scopeKey)
    if (progress?.pickAt !== pending.at) {
      // A pick made mid-turn: that turn began before it, so its end says
      // nothing about the switch. Wait for the next one to start.
      pickProgress.set(scopeKey, { pickAt: pending.at, phase: 'awaiting-start', settledAt: null })
      return
    }
    if (progress.phase === 'awaiting-start' && !wasWorking && agentWorking) {
      progress.phase = 'in-turn'
    } else if (progress.phase === 'in-turn' && wasWorking && !agentWorking) {
      progress.phase = 'settled'
      progress.settledAt = Date.now()
      // Forced: an answer the host cached before this turn would not confirm it.
      scan(true)
    }
  })
  const progress = scopeKey ? pickProgress.get(scopeKey) : undefined
  const pick = pending
    ? { settledAt: progress?.pickAt === pending.at ? progress.settledAt : null }
    : null

  const transcript = quiet && sessionId ? peekClaudeTranscriptModel(hostId, sessionId) : null
  const base = quiet ? resolveClaudeModelFallback({ liveModel, transcript, pick }) : NONE
  const command = useMemo(
    () => (quiet && messages ? sessionCommandPairFor(sessionId, messages, transcript?.model ?? null) : null),
    [quiet, messages, sessionId, transcript]
  )
  // A pick of the phone's own that no scan has confirmed yet shows nothing, and
  // an older command row must not bring a figure back (2026-09-18's rule).
  const next = quiet && !(pick && base.kind === 'none') ? withSessionCommandPair(base, command) : base
  // The same answer keeps the same object: the option controller memoizes the
  // pickers' props on it, and a fresh object every render would rebuild them.
  const key = JSON.stringify(next)
  const fallback = useMemo(() => next, [key])
  return { fallback, requestScan: request }
}
