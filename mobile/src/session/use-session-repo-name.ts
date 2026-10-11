import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { isFloatingWorkspaceWorktreeId } from './floating-workspace'
import { nativeChatRepoListRead } from './mobile-session-read-operations'
import { getRepoIdFromMobileWorktreeId } from './mobile-session-route-helpers'

/** The repo's own name from a `repo.list` answer: Orca's Repo record carries `displayName`. */
export function repoDisplayNameFromList(repos: unknown, repoId: string): string | null {
  if (!Array.isArray(repos) || repoId === '') {
    return null
  }
  const repo: unknown = repos.find(
    (candidate: unknown) =>
      typeof candidate === 'object' && candidate !== null && (candidate as { id?: unknown }).id === repoId
  )
  const name = typeof repo === 'object' && repo !== null ? (repo as { displayName?: unknown }).displayName : null
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null
}

/**
 * The workspace's repo name for the header's "repo · branch" subtitle (parity gap G9). The
 * `worktree.show` record names no repo, so this reads `repo.list`, the call the chat's readability
 * probe already makes, through the same skip-on-refusal operation.
 *
 * Read once per connection: `lastConnectedAt` moves on each new one, so a read that failed while
 * the relay was dialling is retried when it comes up, and never in a loop while it is down
 * (CLAUDE.md, "Nothing stays stale once the relay connects"). A failed read keeps whatever name
 * this workspace already had and shows nothing rather than a guess.
 */
export function useSessionRepoName(input: {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  lastConnectedAt: number | null
}): string | null {
  const { client, connState, worktreeId, lastConnectedAt } = input
  const [state, setState] = useState<{ worktreeId: string; name: string | null }>(() => ({
    worktreeId,
    name: null
  }))
  const skip = isFloatingWorkspaceWorktreeId(worktreeId)
  useEffect(() => {
    if (skip || !client || connState !== 'connected') {
      return
    }
    let active = true
    nativeChatRepoListRead
      .request(client)
      .then((response) => {
        const accepted = nativeChatRepoListRead.interpret(response)
        if (!active || !accepted.accepted) {
          return
        }
        const name = repoDisplayNameFromList(accepted.value, getRepoIdFromMobileWorktreeId(worktreeId))
        setState((current) =>
          current.worktreeId === worktreeId && current.name === name ? current : { worktreeId, name }
        )
      })
      .catch(() => {
        // Non-fatal: the subtitle shows the branch alone until the next connection reads again.
      })
    return () => {
      active = false
    }
  }, [client, connState, worktreeId, lastConnectedAt, skip])
  return !skip && state.worktreeId === worktreeId ? state.name : null
}
