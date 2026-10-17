/**
 * Where an artifact opens: the in-app viewer (app/artifact.tsx, MobileArtifactViewer.tsx), as the
 * Claude Android app 1.261013.20 opens one in its own screen (sq30.java) rather than the browser.
 */
export const CLAUDE_ARTIFACT_ROUTE = '/artifact'

/** Opens a claude.ai artifact in the viewer. The card, the chips in Claude's words and the
 *  session's Artifacts sheet all call this. `accountId` is the Code UI account the opener knows the
 *  artifact by (the gallery's selected account, a chat's tab account): the viewer opens it signed
 *  in to claude.ai as that account (use-artifact-viewer-session.ts). expo-router is loaded with import(): it has no Node
 *  entry, and every test that draws the chat would fail to import it (open-anthropic-accounts.ts). */
export function openClaudeArtifact(link: { url: string; title?: string | null; accountId?: string | null }): void {
  const params: Record<string, string> = { url: link.url }
  if (link.accountId) {
    params.account = link.accountId
  }
  const title = link.title?.trim()
  if (title) {
    params.title = title
  }
  void import('expo-router').then(
    ({ router }) => router.push({ pathname: CLAUDE_ARTIFACT_ROUTE, params }),
    (error: unknown) => console.warn(`[artifacts] could not open the artifact viewer: ${error instanceof Error ? error.message : String(error)}`)
  )
}
