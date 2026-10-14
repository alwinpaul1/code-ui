import type { ReactNode } from 'react'
import {
  ChatTextSelectableContext,
  ChatTextSelectionReportContext,
  type ChatTextSelectionReport
} from './chat-text-selectable-context'

/** The chat's two selection contexts together: whether text takes a hold now, and where a
 *  document reports a selection opening or closing (chat-text-selectable-context.ts). */
export function ChatTextSelectionProvider({
  selectable,
  report,
  children
}: {
  selectable: boolean
  report: ChatTextSelectionReport
  children: ReactNode
}): ReactNode {
  return (
    <ChatTextSelectableContext.Provider value={selectable}>
      <ChatTextSelectionReportContext.Provider value={report}>{children}</ChatTextSelectionReportContext.Provider>
    </ChatTextSelectableContext.Provider>
  )
}
