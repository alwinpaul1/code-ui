import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../../src/shared/skills'
import type { RpcClient } from '../transport/rpc-client'

/** Re-scan when the `/` menu opens and the last scan is older than this, so a
 *  skill added or removed on the desktop shows up on the next `/` without
 *  leaving the session. Short because opening the menu is the natural refresh
 *  moment; the floor only stops a menu flicker from hammering the host. */
const SKILLS_STALE_MS = 3_000

/**
 * Installed skills and plugin commands for the `/` menu.
 *
 * Why: the static per-agent command catalog knows `/clear` and `/model`, but
 * not the user's own skills (`/beui`, `/frontend-ui-ux`, …) or plugin commands.
 * Desktop already scans every agent's skill roots for its picker via
 * `skills.discover`; mobile asks the same host the first time the composer
 * opens a slash menu and caches the answer per worktree. A host too old to
 * know the method simply leaves the list empty.
 */
export function useMobileNativeChatSkills(args: {
  client: Pick<RpcClient, 'sendRequest'> | null
  worktreeId: string
}): { nativeChatSkills: DiscoveredSkill[]; loadNativeChatSkills: () => void } {
  const { client, worktreeId } = args
  const [nativeChatSkills, setNativeChatSkills] = useState<DiscoveredSkill[]>([])
  const loadedAtRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const unsupportedRef = useRef(false)
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current++
    loadedAtRef.current = null
    inFlightRef.current = false
    unsupportedRef.current = false
    setNativeChatSkills([])
  }, [client, worktreeId])

  const loadNativeChatSkills = useCallback(() => {
    if (!client || inFlightRef.current || unsupportedRef.current) {
      return
    }
    const loadedAt = loadedAtRef.current
    if (loadedAt !== null && Date.now() - loadedAt < SKILLS_STALE_MS) {
      return
    }
    const generation = generationRef.current
    inFlightRef.current = true
    // Why: a repeat scan passes `refresh` so the host bypasses its own cache; an
    // older host ignores the flag and scans as it always did.
    const refresh = loadedAt !== null
    client
      .sendRequest('skills.discover', refresh ? { worktreeId, refresh } : { worktreeId })
      .then((response) => {
        if (generationRef.current !== generation) {
          return
        }
        if (!response.ok) {
          if (response.error.code === 'method_not_found') {
            unsupportedRef.current = true
          }
          return
        }
        loadedAtRef.current = Date.now()
        const result = response.result as Partial<SkillDiscoveryResult> | undefined
        setNativeChatSkills(Array.isArray(result?.skills) ? result.skills : [])
      })
      .catch(() => undefined)
      .finally(() => {
        if (generationRef.current === generation) {
          inFlightRef.current = false
        }
      })
  }, [client, worktreeId])

  return { nativeChatSkills, loadNativeChatSkills }
}
