import type { DictationChatAccount } from '../hooks/use-anthropic-dictation'
import type { MobileNativeChatController } from './mobile-native-chat-controller-contract'

/**
 * The Anthropic account a take on the session screen dictates with. A Claude chat (the controller
 * hands it `nativeChatClaudeArtifacts` exactly when useClaudeTabAccount has a scope for it) names
 * its own account, the one its artifacts are listed under, or null when several are signed in and
 * none is matched to it. Anything else (a terminal, a Codex chat) names no chat, and dictation uses
 * the first account signed in. Review of 2026-10-17: every take used that first account.
 */
export function dictationChatAccount(
  controller: Pick<MobileNativeChatController, 'nativeChatClaudeArtifacts' | 'nativeChatArtifactAccountId'>
): DictationChatAccount | undefined {
  return controller.nativeChatClaudeArtifacts ? { accountId: controller.nativeChatArtifactAccountId ?? null } : undefined
}
