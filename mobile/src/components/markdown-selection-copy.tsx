import type { ReactNode } from 'react'

/**
 * What wraps a Markdown document, and what a code pill's View says it copies as.
 *
 * Only Android copies an inline View as U+FFFC, so only Android (markdown-selection-copy.android.tsx,
 * which Metro picks over this file there) wraps the document in a native view that fixes it, and
 * has pills that say what they are. Everywhere else, the web page included, the document is drawn
 * as it was and a pill carries nothing: a DOM id per pill would only be noise.
 */
/** Only Android's native root can stop a hold without switching `selectable` off. */
export const MARKDOWN_ROOT_GUARDS_HOLDS = false

export function MarkdownSelectionRoot({ children }: { children: ReactNode; holdSelects?: boolean }): ReactNode {
  return children
}

export function pillCopyNativeId(_span: string, _piece: number): string | undefined {
  return undefined
}
