import { useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { branchContextStatusRead } from './mobile-diff-review-operations'

/** What the session pills read off `git.status`: the branch and commit the worktree is on, and
 *  what the host says about its remote branch. Each member the host did not state stays unstated,
 *  never defaulted: a `hasUpstream` of false is a claim the host has to make. */
export type SessionBranchStatus = {
  branch: string | null
  head: string | null
  hasUpstream: boolean | undefined
  ahead: number | undefined
  behind: number | undefined
}

export type SessionBranchStatusRead = (
  client: RpcClient,
  worktreeId: string
) => Promise<SessionBranchStatus | null>

/** git.status through the branch context's read, which already skips a refusal: a host that will
 *  not say leaves the pills out, never an error. */
export const readSessionBranchStatus: SessionBranchStatusRead = async (client, worktreeId) => {
  const reply = await branchContextStatusRead.request(client, { worktree: `id:${worktreeId}` })
  const status = branchContextStatusRead.interpret(reply)
  // A reply that is not a status at all is accepted with no value: it says nothing.
  if (!status.accepted || !status.value) {
    return null
  }
  const { branch, head, upstreamStatus } = status.value
  return {
    branch: branch ? branch : null,
    head: head ? head : null,
    hasUpstream: upstreamStatus?.hasUpstream,
    ahead: upstreamStatus?.ahead,
    behind: upstreamStatus?.behind
  }
}

/**
 * The branch status for the session pills.
 *
 * Read when the chat opens, again each time the agent finishes a turn (the moment its commits and
 * pushes are on disk and on the remote), and again on every new connection to the host, so a read
 * that failed while the relay was dialling is retried by itself once the connection is up. One
 * read per such event, never one per render. A read that fails, or that the host will not answer,
 * keeps the last answer rather than dropping pills that were right a turn ago; the failure says
 * where to look in the log. Another worktree's answer is dropped at once.
 *
 * `turnsEnded` counts the turns that have ended since the chat opened, for the readers that want
 * to refresh on the same beat (the pull request read).
 */
export function useSessionBranchStatus(args: {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  agentWorking: boolean
  /** The chat is on screen. A terminal or file tab draws no pills, so it reads nothing. */
  enabled?: boolean
  read?: SessionBranchStatusRead
}): { status: SessionBranchStatus | null; turnsEnded: number } {
  const {
    client,
    connState,
    hostId,
    worktreeId,
    agentWorking,
    enabled = true,
    read = readSessionBranchStatus
  } = args
  const lastConnectedAt = useLastConnectedAt(hostId)
  const [answer, setAnswer] = useState<{
    worktreeId: string
    status: SessionBranchStatus
  } | null>(null)
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
  const ready = enabled && client !== null && connState === 'connected'

  useEffect(() => {
    if (!ready || !client) {
      return
    }
    let live = true
    readRef
      .current(client, worktreeId)
      .then((next) => {
        if (live && next) {
          setAnswer({ worktreeId, status: next })
        }
      })
      .catch((error: unknown) => {
        // Keep the last answer; the next turn end or connection reads again.
        console.warn('[session-pills] could not read the branch status', {
          worktreeId,
          message: error instanceof Error ? error.message : String(error)
        })
      })
    return () => {
      live = false
    }
  }, [ready, client, worktreeId, lastConnectedAt, turnsEnded])

  return { status: answer?.worktreeId === worktreeId ? answer.status : null, turnsEnded }
}
