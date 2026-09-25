import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import type { RpcClient } from '../transport/rpc-client'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import { RESUME_RPC_TIMEOUT_MS } from '../session/ai-vault-resume-preparation'
import { triggerError } from '../platform/haptics'
import { agentHistorySessionScan } from './mobile-agent-history-operations'
import type { AgentSessionSearchHit } from './agent-history-search-reply-schema'
import { searchHitKey } from './agent-history-search-state'

// The screen's own scan size (use-mobile-agent-history-state.ts), so the lookup below costs what
// a tab switch costs.
const HIT_LOOKUP_SESSION_LIMIT = 500

/**
 * The loaded history row a search hit stands for: same agent, same session id, and the session
 * itself rather than one of its subagent transcripts, which share the parent's id.
 */
export function findSearchHitSession(
  sessions: readonly AiVaultSession[],
  hit: Pick<AgentSessionSearchHit, 'agent' | 'sessionId'>
): AiVaultSession | null {
  return (
    sessions.find(
      (session) =>
        session.agent === hit.agent && session.sessionId === hit.sessionId && !session.subagent
    ) ?? null
  )
}

/**
 * The full history row for a hit, so the Resume button runs the history list's own resume.
 *
 * A hit over the relay carries no file path and no resume command (the host redacts both for a
 * paired client), so it cannot be resumed from itself. The row is usually already loaded; when it
 * is not (a hit older than the 500 the screen holds), one scan narrowed to the hit's own folder
 * finds it, the same `aiVault.listSessions` the screen runs on every open.
 */
export async function resolveSearchHitSession(
  client: RpcClient,
  hit: AgentSessionSearchHit,
  loaded: readonly AiVaultSession[]
): Promise<AiVaultSession> {
  const onScreen = findSearchHitSession(loaded, hit)
  if (onScreen) {
    return onScreen
  }
  if (!hit.cwd) {
    throw new Error(
      'This session is not in the loaded history, and the host did not say which folder it ran in.'
    )
  }
  const reply = await agentHistorySessionScan.request(
    client,
    { limit: HIT_LOOKUP_SESSION_LIMIT, force: false, scopePaths: [hit.cwd] },
    { timeoutMs: RESUME_RPC_TIMEOUT_MS }
  )
  const result = interpretOrThrowRefusalMessage(
    () => agentHistorySessionScan.interpret(reply),
    'Unable to load agent sessions'
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the same reader and the same cast as the screen's own scan (use-mobile-agent-history-state.ts); the row found here goes to the same resume path those rows do.
  const found = findSearchHitSession(result.sessions as AiVaultSession[], hit)
  if (!found) {
    throw new Error(
      "The host's session history no longer lists this session, so it cannot be resumed from here."
    )
  }
  return found
}

type HitResumeParams = {
  client: RpcClient | null
  connected: boolean
  sessions: readonly AiVaultSession[]
  onResumeSession: (session: AiVaultSession) => Promise<void>
  onResumeMessage: (message: string) => void
}

/**
 * Resume from a search hit through the history list's own resume. `resolvingKey` names the hit
 * being looked up or resumed, so its row shows the spinner and every row's button waits.
 */
export function useSearchHitResume({
  client,
  connected,
  sessions,
  onResumeSession,
  onResumeMessage
}: HitResumeParams): {
  resumeHit: (hit: AgentSessionSearchHit) => Promise<void>
  resolvingKey: string | null
} {
  const [resolvingKey, setResolvingKey] = useState<string | null>(null)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const resumeHit = useCallback(
    async (hit: AgentSessionSearchHit): Promise<void> => {
      if (inFlightRef.current) {
        return
      }
      if (!client || !connected) {
        onResumeMessage('Waiting for host...')
        triggerError()
        return
      }
      inFlightRef.current = true
      setResolvingKey(searchHitKey(hit))
      try {
        const session = await resolveSearchHitSession(client, hit, sessions)
        await onResumeSession(session)
      } catch (error) {
        triggerError()
        onResumeMessage(
          error instanceof Error && error.message ? error.message : 'Failed to resume session.'
        )
      } finally {
        inFlightRef.current = false
        if (mountedRef.current) {
          setResolvingKey(null)
        }
      }
    },
    [client, connected, sessions, onResumeSession, onResumeMessage]
  )

  return { resumeHit, resolvingKey }
}
