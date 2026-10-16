import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { HOLD_DOES_NOT_OPEN } from './markdown-link-hold'
import { artifactLinkWords, linkWordsAreAddress, type MarkdownArtifactLink, type MarkdownArtifactLinks } from './markdown-artifact-links'
import { renderLinkLabel } from './mobile-markdown-link-label'
import type { MarkdownStyles } from './mobile-markdown-styles'

export { MarkdownArtifactLinksContext, type MarkdownArtifactLinks } from './markdown-artifact-links'

/** An artifact link inside a Text run (markdown-artifact-links.ts), drawn as a link with the
 *  Markdown link's own `words` (null for a bare address), or the artifact's label where they are
 *  only its address; read out as the app's "Artifact, <words>"; opened in the app. Kept out of
 *  MobileMarkdown.tsx, which is at its line cap. */
export function renderArtifactLink(
  styles: MarkdownStyles,
  key: string,
  artifact: MarkdownArtifactLink,
  href: string,
  words: string | null
): ReactNode {
  const own = words !== null && !linkWordsAreAddress(words, href)
  return (
    <Text
      key={key}
      style={styles.link}
      onPress={artifact.open}
      accessibilityLabel={artifact.describe(words === null ? artifact.label : artifactLinkWords(artifact, words, href))}
      {...HOLD_DOES_NOT_OPEN}
    >
      {own ? renderLinkLabel(styles, words) : artifact.label}
    </Text>
  )
}

/** Opens an address: in the app when it is an artifact the surface knows, else as `otherwise` does. */
export function openArtifactOr(artifacts: MarkdownArtifactLinks | null, href: string, otherwise: () => void): void {
  const artifact = artifacts?.resolve(href) ?? null
  if (artifact) {
    artifact.open()
  } else {
    otherwise()
  }
}
