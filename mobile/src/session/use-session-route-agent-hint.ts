import { useEffect, useState } from 'react'
import { readSessionRouteAgentHint, type SessionRouteAgentHint } from './session-route-agent-hint'

/**
 * The tapped row's agent hint (`?agent=claude`), for as long as it is the best evidence there is:
 * until this workspace's tabs have loaded once. From then on the real active tab decides, so the
 * hint is spent for the life of the screen, and cleared from the route so a later visit through
 * the same params (a reconnect that empties the strip, a SET_PARAMS onto this screen) cannot
 * bring a stale "it's Claude" back. Spent per workspace: a screen reused for another one starts
 * over with that one's hint.
 */
export function useSessionRouteAgentHint({
  worktreeId,
  param,
  terminalsLoaded,
  clearParam
}: {
  worktreeId: string
  param: string | string[] | undefined
  terminalsLoaded: boolean
  clearParam: () => void
}): SessionRouteAgentHint {
  const [spentFor, setSpentFor] = useState<string | null>(null)
  const spent = spentFor === worktreeId || terminalsLoaded
  const hint = readSessionRouteAgentHint(param)
  useEffect(() => {
    if (terminalsLoaded) {
      setSpentFor(worktreeId)
    }
  }, [terminalsLoaded, worktreeId])
  useEffect(() => {
    if (spent && hint !== null) {
      clearParam()
    }
  }, [spent, hint, clearParam])
  return spent ? null : hint
}
