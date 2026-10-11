import { useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { branchContextStatusRead } from './mobile-diff-review-operations'
import { sessionDiffTotals, type SessionDiffTotals } from './mobile-native-chat-session-bar-model'

export type SessionDiffRead = (client: RpcClient, worktreeId: string) => Promise<SessionDiffTotals | null>

/** git.status through the branch context's read, which already skips a
 *  refusal: a host that will not say leaves the pill out, never an error. */
export const readSessionDiffTotals: SessionDiffRead = async (client, worktreeId) => {
  const reply = await branchContextStatusRead.request(client, { worktree: `id:${worktreeId}` })
  const status = branchContextStatusRead.interpret(reply)
  return sessionDiffTotals(status.accepted ? status.value : null)
}

/**
 * The worktree's uncommitted +/- for the diff pill.
 *
 * Read when the chat opens, again each time the agent finishes a turn (the
 * moment its edits are on disk), and again on every new connection to the
 * host — so a read that failed while the relay was dialling is retried by
 * itself once the connection is up (root CLAUDE.md, "Nothing stays stale").
 * One read per such event, never one per render. A failed read keeps the
 * last answer rather than dropping a pill that was right a turn ago.
 */
export function useSessionDiffTotals(args: {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  agentWorking: boolean
  read?: SessionDiffRead
}): SessionDiffTotals | null {
  const { client, connState, hostId, worktreeId, agentWorking, read = readSessionDiffTotals } = args
  const lastConnectedAt = useLastConnectedAt(hostId)
  const [totals, setTotals] = useState<SessionDiffTotals | null>(null)
  // Bumped when a turn ends: working → idle.
  const [turnsEnded, setTurnsEnded] = useState(0)
  const [wasWorking, setWasWorking] = useState(agentWorking)
  if (wasWorking !== agentWorking) {
    setWasWorking(agentWorking)
    if (!agentWorking) {
      setTurnsEnded((count) => count + 1)
    }
  }
  const readRef = useRef(read)
  readRef.current = read
  const ready = client !== null && connState === 'connected'

  useEffect(() => {
    setTotals(null)
  }, [worktreeId])

  useEffect(() => {
    if (!ready || !client) {
      return
    }
    let live = true
    readRef
      .current(client, worktreeId)
      .then((next) => {
        if (live) {
          setTotals(next)
        }
      })
      .catch(() => {
        // Keep the last answer; the next turn end or connection reads again.
      })
    return () => {
      live = false
    }
  }, [ready, client, worktreeId, lastConnectedAt, turnsEnded])

  return totals
}
