import { createElement } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatSettledTurns } from '../../../src/shared/native-chat-turn-status'
import { useMobileNativeChatTurnDisclosure } from './use-mobile-native-chat-turn-disclosure'

export function userMessage(id: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text: id }],
    timestamp: null,
    source: 'transcript'
  }
}

// A component, not a host string: React Native's ElementType has no string members.
export function Result(_props: {
  disclosure: ReturnType<typeof useMobileNativeChatTurnDisclosure>
}): null {
  return null
}

export function Harness({
  messages,
  enabled,
  isWorking = true,
  settledTurns,
  awaitingInput,
  scopeKey = 'host\0worktree\0tab-a'
}: {
  messages: readonly NativeChatMessage[]
  enabled: boolean
  isWorking?: boolean
  settledTurns?: NativeChatSettledTurns
  /** A prompt card (approval, question, ask) is waiting on the user. */
  awaitingInput?: boolean
  scopeKey?: string
}): React.JSX.Element {
  const disclosure = useMobileNativeChatTurnDisclosure({
    messages,
    enabled,
    isWorking,
    settledTurns,
    awaitingInput,
    scopeKey
  })
  return createElement(Result, { disclosure })
}
