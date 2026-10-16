import { openExternalLink } from '../platform/external-link'

/**
 * Inside the shell's page there is no viewer route to push: a route the page does not carry
 * paints Unmatched over it (session-router-seam-census.test.ts), and the viewer's WebView has no
 * browser counterpart. claude.ai also refuses to be framed, so the page hands the link to the app's
 * external opener instead.
 */
export function openClaudeArtifact(link: { url: string; title?: string | null }): void {
  openExternalLink(link.url)
}
