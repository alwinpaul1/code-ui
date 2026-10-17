import type { DictationChatAccount } from '../hooks/use-anthropic-dictation'
import type { DictationAccountLookup } from '../dictation/dictation-account-lookup'
import type { MobileNativeChatController } from './mobile-native-chat-controller-contract'
import type { ClaudeTabAccountScope } from './use-claude-tab-account'
import { newestTranscriptMessageAt, transcriptMessageIds } from './ccr-session-match'
import { lookUpDictationSessionAccount } from './dictation-session-account'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

type LookUp = (scope: ClaudeTabAccountScope, tab: { messageIds: readonly string[]; newestMessageAt: number | null }) => Promise<DictationAccountLookup>

/** The real lookup: the pipeline's own match, with the real deps (loaded on first use). */
const lookUpOnDemand: LookUp = (scope, tab) => lookUpDictationSessionAccount(scope, tab, loadDefaultCcrPipelineDeps)

/**
 * The Anthropic account a take on the session screen dictates with. A Claude chat (the controller
 * hands it `nativeChatClaudeArtifacts` exactly when useClaudeTabAccount has a scope for it) hands
 * dictation a lookup of the tab's own session, which takes the tab's kept match or config-dir
 * binding at once and otherwise asks Anthropic, and finds the account exactly or says why it
 * cannot (the user, 2026-10-17: "it must exactly tell"). Anything else (a terminal, a Codex chat)
 * names no chat, and dictation uses the first account signed in.
 */
export function dictationChatAccount(
  controller: Pick<MobileNativeChatController, 'nativeChatClaudeArtifacts'> &
    Partial<Pick<MobileNativeChatController, 'nativeChatSession' | 'nativeChatArtifactAccountId'>>,
  lookUp: LookUp = lookUpOnDemand
): DictationChatAccount | undefined {
  const claude = controller.nativeChatClaudeArtifacts
  if (!claude) {
    return undefined
  }
  // Not nativeChatArtifactAccountId: with one account signed in it names that one unproven.
  const messages = controller.nativeChatSession?.messages ?? []
  return {
    accountId: null,
    resolve: () => lookUp(claude.account, { messageIds: transcriptMessageIds(messages), newestMessageAt: newestTranscriptMessageAt(messages) })
  }
}
