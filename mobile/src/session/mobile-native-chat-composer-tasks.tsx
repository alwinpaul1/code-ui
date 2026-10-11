import { useMemo } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  mobileTaskListPredecessors,
  mobileTaskListState
} from './mobile-native-chat-task-list-rows'

export function useMobileNativeChatTaskProgress(messages: readonly NativeChatMessage[]) {
  const predecessors = useMemo(() => mobileTaskListPredecessors(messages), [messages])
  const composerList = useMemo(() => mobileTaskListState(messages).list, [messages])
  return { predecessors, composerList }
}
