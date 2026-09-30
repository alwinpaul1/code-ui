import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import { linearTeamStateListRead } from './mobile-task-item-detail-operations'
import type { LinearState, TaskItem } from './mobile-tasks-legacy-foundation'

/** The state-list read, and the connection a failed one waits on when the client has one. */
type StateListClient = Parameters<typeof linearTeamStateListRead.request>[0] &
  Partial<Pick<RpcClient, 'getLastConnectedAt' | 'onStateChange'>>

/** Why a read gave no list, worded for the Change Status sheet. */
function stateListFailure(cause: string): string {
  return `Couldn't load this team's states: ${cause}`
}

/**
 * When this host last connected, as its client reports it. Read off the client rather than the
 * tasks model: every stage the RPC recordings mount must be given each model member it reads.
 */
function useClientLastConnectedAt(client: StateListClient | null): number | null {
  const [connectedAt, setConnectedAt] = useState(() => client?.getLastConnectedAt?.() ?? null)
  useEffect(() => {
    const read = () => setConnectedAt(client?.getLastConnectedAt?.() ?? null)
    read()
    return client?.onStateChange?.(read)
  }, [client])
  return connectedAt
}

/**
 * The Linear team's workflow states for the Change Status sheet and the issue detail, and the
 * reset of the item's drafts that goes with a new item.
 *
 * A read that rejected or was refused used to set the list to [], which the sheet drew as "No
 * states available": false for a team that has states, with nothing to retry and no read again
 * when the host came back (review, 2026-09-30). A failure is now `linearStatesError`, with
 * `retryLinearStates` for a Retry, and the list is read again once per NEW connection while the
 * last read failed (CLAUDE.md "Nothing stays stale once the relay connects"), never per render.
 *
 * The drafts are cleared where they always were, after the loading flag and before the request,
 * and only for a new client, item or support flag: a Retry or a reconnect re-read must not clear
 * what the user was typing, and the RPC recording goldens pin the order of these setters.
 */
export function useLinearTeamStateList(args: {
  client: StateListClient | null
  item: Extract<TaskItem, { provider: 'linear' }> | null
  tasksSupported: boolean
  setLinearStates: (states: LinearState[]) => void
  setLinearStatesLoading: (loading: boolean) => void
  setLinearCommentDraft: (draft: string) => void
  setLinearSubIssueTitle: (title: string) => void
}): { linearStatesError: string; retryLinearStates: () => void } {
  const { client, item, tasksSupported, setLinearStates, setLinearStatesLoading } = args
  const { setLinearCommentDraft, setLinearSubIssueTitle } = args
  const [linearStatesError, setLinearStatesError] = useState('')
  const [readRun, setReadRun] = useState(0)
  const staleLedgerRef = useRef(createStaleAfterReconnectLedger())
  const readForRef = useRef<readonly unknown[] | null>(null)
  const lastConnectedAt = useClientLastConnectedAt(client)
  const teamId = item?.source.team.id ?? null

  useEffect(() => {
    const readFor = readForRef.current
    const newItem =
      readFor === null ||
      readFor[0] !== client ||
      readFor[1] !== item ||
      readFor[2] !== tasksSupported
    readForRef.current = [client, item, tasksSupported]
    setLinearStatesError('')
    if (!tasksSupported || !item || !client) {
      setLinearStates([])
      setLinearCommentDraft('')
      setLinearSubIssueTitle('')
      return
    }
    let stale = false
    const fail = (cause: string) => {
      if (stale) {
        return
      }
      console.warn('[tasks] the Linear team state list could not be read', {
        teamId: item.source.team.id,
        cause
      })
      setLinearStates([])
      setLinearStatesError(stateListFailure(cause))
    }
    setLinearStatesLoading(true)
    if (newItem) {
      setLinearCommentDraft('')
      setLinearSubIssueTitle('')
    }
    void linearTeamStateListRead
      .request(client, { teamId: item.source.team.id, workspaceId: item.source.workspaceId })
      .then((response) => {
        if (stale) {
          return
        }
        const accepted = linearTeamStateListRead.interpret(response)
        if (accepted.accepted) {
          setLinearStates(accepted.value)
          return
        }
        fail(response.ok ? 'the desktop sent a list this app cannot read' : response.error.message)
      })
      .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        if (!stale) {
          setLinearStatesLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [client, item, tasksSupported, readRun])

  useEffect(() => {
    if (teamId === null) {
      return
    }
    const status = linearStatesError ? 'error' : 'ready'
    if (shouldRefetchAfterReconnect(staleLedgerRef.current, teamId, status, lastConnectedAt)) {
      setReadRun((run) => run + 1)
    }
  }, [lastConnectedAt, linearStatesError, teamId])

  const retryLinearStates = useCallback(() => setReadRun((run) => run + 1), [])
  return { linearStatesError, retryLinearStates }
}
