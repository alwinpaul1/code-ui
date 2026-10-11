// The chat's whole transcript, unfiltered, for a sheet that has to look past
// its own call: the Bash sheet finds the agent's later reads of a background
// shell's output (parity gap G27). The tab's tasks provider owns it, the same
// list it reads background work from. Absent, a sheet shows only its call.

import { createContext, useContext, type ReactNode } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

const NativeChatTranscriptContext = createContext<readonly NativeChatMessage[] | null>(null)

export function NativeChatTranscriptProvider({
  messages,
  children
}: {
  messages: readonly NativeChatMessage[]
  children: ReactNode
}) {
  return <NativeChatTranscriptContext.Provider value={messages}>{children}</NativeChatTranscriptContext.Provider>
}

export function useNativeChatTranscript(): readonly NativeChatMessage[] | null {
  return useContext(NativeChatTranscriptContext)
}
