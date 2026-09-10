import { useMemo } from 'react'

/**
 * FlashList is a PureComponent. Its own typings say it plainly: "If any of your
 * `renderItem`, Header, Footer, etc. functions depend on anything outside of
 * the `data` prop, stick it here and treat it immutably."
 *
 * The chat list's header draws the running-background-tasks row, the queue and
 * the unanchored turn status — none of which live in `data`, which is only the
 * messages. Without this marker the header keeps whatever it last rendered, so
 * the "N running tasks" row went stale while the background-tasks sheet, which
 * re-derives on its own tick, showed the true set.
 */
export function nativeChatListHeaderExtraData(inputs: {
  agentStatus: unknown
  backgroundTaskReport: unknown
  hostBackgroundTasks: unknown
  queuedMessages: unknown
  unanchoredTurnStatus: unknown
  turnActivity: unknown
}): readonly unknown[] {
  return [
    inputs.agentStatus,
    inputs.backgroundTaskReport,
    inputs.hostBackgroundTasks,
    inputs.queuedMessages,
    inputs.unanchoredTurnStatus,
    inputs.turnActivity
  ]
}

/** The memoised marker the list takes, so it only changes when the header's
 *  own inputs do — a fresh array every render would defeat the PureComponent
 *  it exists to wake. */
export function useNativeChatListHeaderExtraData(inputs: {
  agentStatus: unknown
  backgroundTaskReport: unknown
  hostBackgroundTasks: unknown
  queuedMessages: unknown
  unanchoredTurnStatus: unknown
  turnActivity: unknown
}): readonly unknown[] {
  const {
    agentStatus,
    backgroundTaskReport,
    hostBackgroundTasks,
    queuedMessages,
    unanchoredTurnStatus,
    turnActivity
  } = inputs
  return useMemo(
    () =>
      nativeChatListHeaderExtraData({
        agentStatus,
        backgroundTaskReport,
        hostBackgroundTasks,
        queuedMessages,
        unanchoredTurnStatus,
        turnActivity
      }),
    [
      agentStatus,
      backgroundTaskReport,
      hostBackgroundTasks,
      queuedMessages,
      turnActivity,
      unanchoredTurnStatus
    ]
  )
}
