import { useEffect, useRef, useSyncExternalStore } from 'react'
import { ccrSendTargetForTab, ccrSessionForTab, type CcrSendTarget } from './ccr-session-cache'
import { ccrSessionFactsForTab, ccrSessionFactsVersion, markCcrSessionFactsRead, subscribeCcrSessionFacts } from './ccr-session-facts'
import { CCR_SESSION_WRITES, markCcrSessionRead } from './ccr-session-writes'
import { defaultLog } from './ccr-session-shared'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

/** The Anthropic session a Claude chat's header names, and where a rename of it would go. */
export type CcrSessionHeader = {
  sessionId: string
  /** The session's own title, or null when it has none yet. */
  title: string | null
  /** The tab's write target read NOW (ccrSendTargetForTab), as the send lane reads it. */
  resolveTarget: () => CcrSendTarget
}

type MarkRead = (target: CcrSendTarget, eventId: string | null) => Promise<boolean>

const defaultMarkRead: MarkRead = async (target, eventId) => {
  const deps = await loadDefaultCcrPipelineDeps()
  const log = deps.log ?? defaultLog
  return markCcrSessionRead({ fetch: deps.fetch, accounts: deps.accounts, log: (line) => log(line, false) }, target, eventId)
}

/**
 * The matched session's title for the header (ccr-session-facts.ts). Null when the tab is not a
 * Claude chat (`enabled` is the same gate the model pill uses, so a Codex tab never gets here),
 * not matched, or matched to another session than the one its facts were read for. The row is
 * fetched by the model pill's re-read (use-ccr-session-model.ts); nothing is fetched here.
 *
 * Only with CCR_SESSION_WRITES on. The header's title and Rename's target must be the same thing:
 * while the switch is off Rename renames the workspace (MobileSessionHeaderMenu.tsx), so a header
 * showing the session title would never change on a rename and the dialog would open on a name the
 * header does not show. Off, this is null and the header shows the worktree name, as before; the
 * facts are still kept, so turning the switch on brings the title back.
 *
 * With CCR_SESSION_WRITES on, an open chat whose row says `unread` is marked read once per
 * session, up to the newest event the phone holds, as the Claude app does on open. Off, nothing.
 */
export function useCcrSessionHeader(args: {
  enabled: boolean
  tabId: string | null
  epoch: number | null
  agentSessionId?: string | null
  configDir?: string | null
  /** The newest event of the chat's link, for mark_read's `event_id`. */
  newestEventId?: string | null
  /** For tests: the switch (CCR_SESSION_WRITES) and the mark_read request. */
  writesOn?: boolean
  markRead?: MarkRead
}): CcrSessionHeader | null {
  useSyncExternalStore(subscribeCcrSessionFacts, ccrSessionFactsVersion, ccrSessionFactsVersion)
  const { enabled, tabId, epoch } = args
  const agentSessionId = args.agentSessionId ?? null
  const configDir = args.configDir ?? null
  const sessionId = enabled && tabId ? ccrSessionForTab(tabId, epoch, agentSessionId, configDir) : null
  const facts = tabId ? ccrSessionFactsForTab(tabId, sessionId) : null
  const resolveTarget = () => ccrSendTargetForTab(tabId ?? '', epoch, agentSessionId, configDir)

  const latest = useRef({ resolveTarget, newestEventId: args.newestEventId ?? null, markRead: args.markRead ?? defaultMarkRead })
  latest.current = { resolveTarget, newestEventId: args.newestEventId ?? null, markRead: args.markRead ?? defaultMarkRead }
  const marked = useRef<string | null>(null)
  const writesOn = args.writesOn ?? CCR_SESSION_WRITES
  const unreadSession = writesOn && facts?.unread === true ? facts.sessionId : null
  useEffect(() => {
    if (!unreadSession || marked.current === unreadSession) {
      return
    }
    marked.current = unreadSession
    const { resolveTarget: target, newestEventId, markRead } = latest.current
    void markRead(target(), newestEventId)
      .then((done) => {
        if (done) {
          markCcrSessionFactsRead(unreadSession)
        }
      })
      .catch((error: unknown) => {
        console.warn(`[ccr-write] mark_read could not run: ${error instanceof Error ? error.message : String(error)}`)
      })
  }, [unreadSession])

  if (!facts || !writesOn) {
    return null
  }
  return { sessionId: facts.sessionId, title: facts.title, resolveTarget }
}
