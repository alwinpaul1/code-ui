import { useMemo } from 'react'
import { View } from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatTaskList } from '../../../src/shared/native-chat-task-list'
import { useTheme } from '../theme/theme-context'
import { MobileNativeChatTaskList } from './MobileNativeChatTaskList'
import {
  mobileTaskListPredecessors,
  mobileTaskListState
} from './mobile-native-chat-task-list-rows'

export function useMobileNativeChatTaskProgress(messages: readonly NativeChatMessage[]) {
  const predecessors = useMemo(() => mobileTaskListPredecessors(messages), [messages])
  const composerList = useMemo(() => mobileTaskListState(messages).list, [messages])
  return { predecessors, composerList }
}

/** Collapsed Tasks n/m strip above the composer. Hidden when there is no plan. */
export function MobileNativeChatComposerTasks({
  list
}: {
  list: NativeChatTaskList | null
}): React.JSX.Element | null {
  const { space } = useTheme()
  if (!list || list.tasks.length === 0) {
    return null
  }
  return (
    <View style={{ paddingHorizontal: space.md, paddingBottom: space.xs }}>
      <MobileNativeChatTaskList list={list} presentation="composer" />
    </View>
  )
}
