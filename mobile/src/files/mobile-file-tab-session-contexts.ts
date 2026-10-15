import type { RuntimeNativeChatFileContext } from '../../../src/shared/runtime-types'

type SessionTabLike = {
  type: string
  id: string
  agentStatus?: { providerSession?: { id?: string | null } | null } | null
}

/**
 * The agent sessions in a worktree that can vouch for a path outside it.
 *
 * Orca grants a file outside every workspace on two kinds of evidence: a
 * terminal's recent output, which it honours only under the temp dir
 * (localTerminalArtifactRoots), and a native chat session's transcript, which
 * it honours anywhere the session's assistant text named the path
 * (nativeChatTranscriptIncludesPath). A desktop-opened tab does not say which
 * session it came from, so every agent terminal tab with a provider session is
 * offered; the host still grants only a path that session itself wrote. Orca
 * looks the context up among `terminal` tabs only, so nothing else is named.
 */
export function nativeChatFileContextsOf(
  tabs: readonly SessionTabLike[]
): RuntimeNativeChatFileContext[] {
  const contexts: RuntimeNativeChatFileContext[] = []
  for (const tab of tabs) {
    const sessionId = tab.type === 'terminal' ? tab.agentStatus?.providerSession?.id : null
    if (sessionId) {
      contexts.push({ tabId: tab.id, sessionId })
    }
  }
  return contexts
}
