import { createContext } from 'react'
import { markdownInlinePlainText } from './markdown-plain-text'

/**
 * Links in a document that open in the app rather than the browser, and draw as words of their
 * own rather than their address: claude.ai artifact links in Claude's replies, which the Claude
 * Android app 1.261013.20 draws as an artifact chip (ht1.java) and opens in its viewer. The chat
 * provides it around an agent's words only (session/ClaudeArtifactLinks.tsx); everywhere else no
 * provider stands, and every link draws and opens as it always has.
 */
export type MarkdownArtifactLink = {
  /** The words drawn for a link whose own words are only its address (`[url](url)`, or a bare URL). */
  label: string
  /** What a screen reader says for the link drawn with `words` (the app's
   *  `ccr_artifact_link_chip_a11y`, "Artifact, <words>"). */
  describe: (words: string) => string
  open: () => void
}

export type MarkdownArtifactLinks = {
  /** The link's artifact, or null for any other address. */
  resolve: (href: string) => MarkdownArtifactLink | null
}

export const MarkdownArtifactLinksContext = createContext<MarkdownArtifactLinks | null>(null)

/** Whether a Markdown link's words say nothing but its address: such a link draws the artifact's
 *  label instead, as the app does (a link whose words differ keeps them). */
export function linkWordsAreAddress(words: string, href: string): boolean {
  return markdownInlinePlainText(words).trim() === href.trim()
}

/** The words a Markdown link to an artifact draws: its own, unless they are only its address. */
export function artifactLinkWords(artifact: MarkdownArtifactLink, words: string, href: string): string {
  return linkWordsAreAddress(words, href) ? artifact.label : markdownInlinePlainText(words)
}
