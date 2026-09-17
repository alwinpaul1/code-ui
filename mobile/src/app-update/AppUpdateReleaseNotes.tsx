import { MobileMarkdown } from '../components/MobileMarkdown'
import { AlertScrollRegion } from '../ui/alert/AlertText'

/** Prose at 13, the alert message size, so the notes and the line above them
 *  read as one column. The renderer's base is 15; its line height follows
 *  from its own inline-chip invariant (mobile-markdown-prose-scale.ts), which
 *  is why the leading is not set here. */
export const RELEASE_NOTES_TEXT_SCALE = 13 / 15

/**
 * The release body as MARKDOWN, through the same renderer the .md tab and the
 * chat use, in the card's capped scroll region. `markdown` is the body already
 * reshaped for the card (release-notes-markdown.ts) and memoised by the caller
 * on the body text, so the renderer's per-source parse cache sees one string
 * per release, not one per render.
 */
export function AppUpdateReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <AlertScrollRegion>
      <MobileMarkdown content={markdown} textScale={RELEASE_NOTES_TEXT_SCALE} />
    </AlertScrollRegion>
  )
}
