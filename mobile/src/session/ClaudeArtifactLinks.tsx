import { useMemo, type ReactNode } from 'react'
import { MarkdownArtifactLinksContext, type MarkdownArtifactLinks } from '../components/markdown-artifact-links'
import { findClaudeArtifactLinks, parseClaudeArtifactLink, type ClaudeArtifactListItem } from './claude-artifacts'
import { useClaudeArtifactAccount } from './claude-artifact-account-context'
import { useClaudeArtifactList } from './claude-artifact-list-store'
import { openClaudeArtifact } from './open-claude-artifact'

/**
 * claude.ai artifact links in an agent's words, as the Claude Android app 1.261013.20 treats them
 * (ht1.java): drawn by a label instead of their address and opened in the app's own viewer. The
 * label is the link's own words when they say more than the address; else the page's title from the
 * account's list; else the app's `ccr_artifact_link_chip_untitled`, "Artifact · <the first 8
 * characters of the link's id>", the id being the link's last path segment. A screen reader hears
 * `ccr_artifact_link_chip_a11y`, "Artifact, <label>".
 */
export function claudeArtifactMarkdownLinks(
  items: readonly ClaudeArtifactListItem[],
  open: (link: { url: string; title?: string | null; accountId?: string | null }) => void = openClaudeArtifact,
  /** The chat's account: the viewer opens the link signed in as it. */
  accountId: string | null = null
): MarkdownArtifactLinks {
  return {
    resolve: (href) => {
      const link = parseClaudeArtifactLink(href)
      if (link === null) {
        return null
      }
      const title = items.find((item) => item.uuid === link.uuid)?.title ?? null
      const id = new URL(link.url).pathname.replace(/\/+$/, '').split('/').pop() ?? ''
      const label = title ?? `Artifact · ${id.slice(0, 8)}`
      return {
        label,
        describe: (words) => `Artifact, ${words}`,
        open: () => open(accountId ? { url: link.url, title, accountId } : { url: link.url, title })
      }
    }
  }
}

/** Gives the words inside it their artifact links. The account's list is read only when the words
 *  hold such a link, so a chat with none never asks for it. */
export function ClaudeArtifactLinks({ text, children }: { text: string; children: ReactNode }) {
  const holdsLinks = useMemo(() => findClaudeArtifactLinks(text).length > 0, [text])
  const account = useClaudeArtifactAccount()
  const { items } = useClaudeArtifactList(holdsLinks ? account : null)
  const links = useMemo(() => claudeArtifactMarkdownLinks(items, openClaudeArtifact, account), [items, account])
  return <MarkdownArtifactLinksContext.Provider value={links}>{children}</MarkdownArtifactLinksContext.Provider>
}
