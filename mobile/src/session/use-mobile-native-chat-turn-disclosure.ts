import { useCallback, useMemo, useState } from 'react'
import { isSubagentGroupBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatSettledTurns } from '../../../src/shared/native-chat-turn-status'
import {
  MOBILE_UNANCHORED_TURN_KEY,
  useMobileNativeChatTurnStatus,
  type NativeChatTurnStatus
} from './use-mobile-native-chat-turn-status'

const EMPTY_TURN_IDS: ReadonlySet<string> = new Set()
const EMPTY_TURN_KEYS: readonly undefined[] = []
const MAX_EXPANDED_TURNS = 128

export type MobileNativeChatTurnRow = {
  turnStatus: NativeChatTurnStatus | null
  turnExpanded: boolean
  /** Set only on a settled turn — the one row that has activity to disclose. */
  turnKey?: string
  activeTurnIsWorking: boolean
  /** The newest assistant row of a live turn with no prompt open: its last text may still grow,
   *  so a visual line still being typed at its tail is held back (Orca #26071). */
  mayStillGrow: boolean
  /** The spawn groups the reader opened; set only on a row that holds a roster, so no other row's
   *  memo sees the set change (Orca #26125). */
  subagentGroupsOpen?: ReadonlySet<string>
  /** Stable for a chat scope; the row calls it with the group id it draws. */
  onToggleSubagentGroup: (groupId: string) => void
}

/** Owns the transcript's per-turn status rows and their disclosure state, and
 *  resolves what one list row needs. Bridge-lane chats pass `enabled: false` and
 *  keep the status line's single "Working" instead. */
export function useMobileNativeChatTurnDisclosure({
  messages,
  enabled,
  isWorking,
  workingStartedAt,
  settledTurns,
  thinking = false,
  awaitingInput = false,
  scopeKey
}: {
  messages: readonly NativeChatMessage[]
  enabled: boolean
  isWorking: boolean
  workingStartedAt?: number | null
  /** Host-recorded durations; they outrank whatever this client observed. */
  settledTurns?: NativeChatSettledTurns | null
  /** A structured prompt (approval, question, ask) is waiting on the user. The
   *  live turn's "Working for N" row is withheld while it is — the agent is not
   *  working, it is waiting — but the turn is NOT settled: its clock keeps
   *  running, Stop stays, and the row comes back when the prompt resolves
   *  (Orca #20496). */
  awaitingInput?: boolean
  /** Whether the turn is reasoning right now, derived from its journal content. */
  thinking?: boolean
  /** Host/worktree/tab identity for timing and disclosure isolation. */
  scopeKey: string
}): {
  active: NativeChatTurnStatus | null
  /** True when the live turn has no user message to hang its status row under. */
  activeTurnIsUnanchored: boolean
  onToggleTurn: (turnKey: string) => void
  resolveRow: (index: number, message: NativeChatMessage) => MobileNativeChatTurnRow
} {
  const turnStatuses = useMobileNativeChatTurnStatus({
    messages,
    enabled,
    isWorking,
    workingStartedAt,
    settledTurns,
    thinking,
    scopeKey
  })
  const [expandedTurns, setExpandedTurns] = useState<{
    scopeKey: string
    turnIds: ReadonlySet<string>
  }>(() => ({ scopeKey, turnIds: new Set() }))
  const expandedTurnIds =
    expandedTurns.scopeKey === scopeKey ? expandedTurns.turnIds : EMPTY_TURN_IDS
  const toggleExpandedTurn = useCallback(
    (turnKey: string) => {
      setExpandedTurns((current) => {
        const next = new Set(current.scopeKey === scopeKey ? current.turnIds : [])
        if (!next.delete(turnKey)) {
          if (next.size >= MAX_EXPANDED_TURNS) {
            const oldest = next.values().next().value
            if (oldest) {
              next.delete(oldest)
            }
          }
          next.add(turnKey)
        }
        return { scopeKey, turnIds: next }
      })
    },
    [scopeKey]
  )
  // Resolve each row's turn boundary once — a findLast per row is quadratic on a
  // long transcript.
  const turnKeys = useMemo(() => {
    if (!enabled) {
      return EMPTY_TURN_KEYS
    }
    let turnKey: string | undefined
    return messages.map((message) => {
      if (message.role === 'user') {
        turnKey = message.id
      }
      return turnKey
    })
  }, [enabled, messages])

  // Which spawn groups the reader opened, by group id: held here and not in the row, because the
  // list remounts a row that scrolls out of its window (maxItemsInRecyclePool 0).
  const [openGroups, setOpenGroups] = useState<{ scopeKey: string; groupIds: ReadonlySet<string> }>(
    () => ({ scopeKey, groupIds: new Set() })
  )
  const openGroupIds = openGroups.scopeKey === scopeKey ? openGroups.groupIds : EMPTY_TURN_IDS
  const toggleSubagentGroup = useCallback(
    (groupId: string) => {
      setOpenGroups((current) => {
        const next = new Set(current.scopeKey === scopeKey ? current.groupIds : [])
        if (!next.delete(groupId)) {
          next.add(groupId)
        }
        return { scopeKey, groupIds: next }
      })
    },
    [scopeKey]
  )
  const latestAssistantId = useMemo(
    () => messages.findLast((row) => row.role === 'assistant')?.id ?? null,
    [messages]
  )
  const { active: liveActive, activeTurnKey, completedByTurn } = turnStatuses
  // Withheld, not settled: the timing state above still counts the turn.
  const active = awaitingInput ? null : liveActive
  const resolveRow = useCallback(
    (index: number, message: NativeChatMessage): MobileNativeChatTurnRow => {
      const turnKey = turnKeys[index]
      const turnStatus =
        !enabled || message.role !== 'user'
          ? null
          : turnKey === activeTurnKey
            ? active
            : turnKey
              ? (completedByTurn[turnKey] ?? null)
              : null
      return {
        turnStatus,
        turnExpanded: turnKey ? expandedTurnIds.has(turnKey) : false,
        // Why: the key travels and the row calls one stable handler with it. A
        // closure per row would be a new identity every render of a streaming
        // transcript, defeating the row's memo; caching one per turn would mean
        // writing a ref during render, which react-freeze can discard.
        turnKey: turnKey && turnStatus?.workedSeconds != null ? turnKey : undefined,
        // With no user boundary at all, the session's working state stays authoritative.
        activeTurnIsWorking:
          enabled &&
          isWorking &&
          (turnKey === activeTurnKey ||
            (turnKey === undefined && activeTurnKey === MOBILE_UNANCHORED_TURN_KEY)),
        // A prompt card waiting means the agent has stopped writing until it is answered.
        mayStillGrow: !awaitingInput && message.id === latestAssistantId,
        subagentGroupsOpen: message.blocks.some(isSubagentGroupBlock) ? openGroupIds : undefined,
        onToggleSubagentGroup: toggleSubagentGroup
      }
    },
    [turnKeys, enabled, activeTurnKey, active, completedByTurn, expandedTurnIds, isWorking, awaitingInput, latestAssistantId, openGroupIds, toggleSubagentGroup]
  )

  return {
    active,
    /** Stable for a given chat scope, so it never disturbs a row's memo. */
    onToggleTurn: toggleExpandedTurn,
    activeTurnIsUnanchored:
      enabled && active != null && activeTurnKey === MOBILE_UNANCHORED_TURN_KEY,
    resolveRow
  }
}
