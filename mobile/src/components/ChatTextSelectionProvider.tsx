import type { ReactNode } from 'react'
import { ChatHeldSelectionContext, type ChatHeldSelections } from './chat-held-selection'
import {
  ChatTextHoldSelectsContext,
  ChatTextSelectableContext,
  ChatTextSelectionReportContext,
  type ChatTextSelectionReport
} from './chat-text-selectable-context'

/** The chat's selection contexts together: whether text stays selectable now, whether a hold may
 *  start a selection now, where a document reports a selection opening or closing
 *  (chat-text-selectable-context.ts), and the selection held outside the rows
 *  (chat-held-selection.ts). */
export function ChatTextSelectionProvider({
  selectable,
  holdSelects,
  report,
  held,
  children
}: {
  selectable: boolean
  /** False while the list scrolls, even with a selection open (ChatTextHoldSelectsContext). */
  holdSelects: boolean
  report: ChatTextSelectionReport
  held: ChatHeldSelections
  children: ReactNode
}): ReactNode {
  return (
    <ChatTextSelectableContext.Provider value={selectable}>
      <ChatTextHoldSelectsContext.Provider value={holdSelects}>
        <ChatTextSelectionReportContext.Provider value={report}>
          <ChatHeldSelectionContext.Provider value={held}>{children}</ChatHeldSelectionContext.Provider>
        </ChatTextSelectionReportContext.Provider>
      </ChatTextHoldSelectsContext.Provider>
    </ChatTextSelectableContext.Provider>
  )
}
