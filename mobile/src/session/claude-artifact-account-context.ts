import { createContext, useContext } from 'react'

/**
 * The Anthropic account a Claude tab's chat belongs to, for the rows that name an artifact by the
 * title the account's own list gives it (claude-artifact-list-store.ts): the Artifact card and the
 * artifact links in Claude's words. Resolved once in the chat controller (useClaudeTabAccount, the
 * same account the session's Artifacts sheet lists) and handed down through this context rather
 * than through every row's props. Null where no account is known (a Codex tab, a Claude tab not
 * matched yet, a test): the rows then use the call's own title and read no list.
 *
 * No react-native import here: the chat's rows import this file, and their tests load no native
 * module (the same reason as agent-image-share-context.ts).
 */
export const ClaudeArtifactAccountContext = createContext<string | null>(null)

export function useClaudeArtifactAccount(): string | null {
  return useContext(ClaudeArtifactAccountContext)
}
