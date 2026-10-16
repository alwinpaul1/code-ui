import type { ReactNode } from 'react'
import { chatDocumentSelectableHook, useChatDocumentSelection } from './chat-text-selectable-context'
import { MARKDOWN_ROOT_GUARDS_HOLDS, MarkdownSelectionRoot } from './markdown-selection-copy'

/**
 * A Markdown document's Texts' `selectable`, read through the hook this platform needs
 * (chatDocumentSelectableHook): on Android, where the root guards holds, it reads no scroll flag.
 */
export const useChatDocumentSelectable = chatDocumentSelectableHook(MARKDOWN_ROOT_GUARDS_HOLDS)

/**
 * The document's selection root, told by the chat's scroll flags whether a hold may start a
 * selection. The only part of a document that reads them: when a drag starts or the list settles
 * this re-renders, and `children`, built by the document, is the same element, so React redraws
 * none of it (chat-scroll-does-not-redraw-replies.test.tsx).
 */
export function ChatDocumentSelectionRoot({ document, children }: { document?: string; children: ReactNode }) {
  const { holdSelects } = useChatDocumentSelection(MARKDOWN_ROOT_GUARDS_HOLDS)
  return (
    <MarkdownSelectionRoot holdSelects={holdSelects} document={document}>
      {children}
    </MarkdownSelectionRoot>
  )
}
