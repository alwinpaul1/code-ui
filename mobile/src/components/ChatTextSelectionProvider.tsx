import type { ReactNode } from 'react'
import { ChatHeldSelectionContext, type ChatHeldSelections } from './chat-held-selection'
import {
  ChatTextSelectableContext,
  ChatTextSelectionReportContext,
  type ChatTextSelectionReport
} from './chat-text-selectable-context'

/** The chat's selection contexts together: whether text takes a hold now, where a document
 *  reports a selection opening or closing (chat-text-selectable-context.ts), and the selection
 *  held outside the rows (chat-held-selection.ts). */
export function ChatTextSelectionProvider({
  selectable,
  report,
  held,
  children
}: {
  selectable: boolean
  report: ChatTextSelectionReport
  held: ChatHeldSelections
  children: ReactNode
}): ReactNode {
  return (
    <ChatTextSelectableContext.Provider value={selectable}>
      <ChatTextSelectionReportContext.Provider value={report}>
        <ChatHeldSelectionContext.Provider value={held}>{children}</ChatHeldSelectionContext.Provider>
      </ChatTextSelectionReportContext.Provider>
    </ChatTextSelectableContext.Provider>
  )
}
