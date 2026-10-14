import { useMemo } from 'react'

/** Android's FlashList default, and the floor here: never prepare less than
 *  the library would on its own. */
const DEFAULT_DRAW_DISTANCE_DP = 250
/** A ceiling so a tablet or a foldable does not mount half a conversation
 *  ahead of the reader. */
const MAX_DRAW_DISTANCE_DP = 1200

/**
 * How far past the visible window FlashList prepares cells, in dp.
 *
 * One screen-height of runway, whatever the screen. The default 250dp is under
 * a third of a phone screen, and every newly exposed message is drawn fresh —
 * markdown, code blocks and all — so a scroll outruns what is ready and the
 * content lands late.
 *
 * Deliberately measured against the WINDOW, not the visible list: the keyboard
 * shrinks the list but not how far a flick travels, so sizing off the visible
 * area would cut the runway exactly when the reported jitter shows up.
 */
export function chatListDrawDistanceDp(windowHeightDp: number): number {
  if (!(windowHeightDp > 0)) {
    return DEFAULT_DRAW_DISTANCE_DP
  }
  return Math.round(
    Math.min(MAX_DRAW_DISTANCE_DP, Math.max(DEFAULT_DRAW_DISTANCE_DP, windowHeightDp))
  )
}

/** The item type of every row that holds no selection: they recycle among themselves. */
export const CHAT_ROW_ITEM_TYPE = 'message'

/**
 * FlashList's item type for a chat row: one shared type, except for the row holding a selection.
 *
 * In FlashList 2.3.2's RenderStackManager.sync a row leaving the window goes into its type's pool
 * and a message entering the window in the same sync takes it. With one type for every message, a
 * scroll handed the row holding a selection, TextViews and all, to another message, and the
 * highlight came back on words nobody selected (the user's phone, 2026-10-14 13:30; the Claude app
 * keeps a selection on its words). 8827567bf gave every message its own type, which stopped all
 * recycling. Now only the row holding a selection has its own type: no other message can take it,
 * and (with no pool cap on the list) it stays drawn when it leaves the window, so the selection
 * is still there when the reader comes back. Every other row recycles as FlashList means it to.
 */
export function chatRowItemType(row: { id: string }, held: ReadonlySet<string>): string {
  return held.has(row.id) ? `held:${row.id}` : CHAT_ROW_ITEM_TYPE
}

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

/**
 * `maintainVisibleContentPosition` is a NATIVE scroll-anchoring config: handing
 * the list a new object re-sends it to the native scroll view. Written inline
 * it was a fresh object on every render — and with the keyboard up the chat
 * re-renders on every keystroke and every streamed frame, so the anchoring was
 * being reconfigured under an active scroll, which is where the jitter came
 * from. Memoised, it changes only when the flag actually flips.
 */
export function useChatListContentPosition(detachedFromTail: boolean): { disabled: boolean } {
  return useMemo(() => ({ disabled: !detachedFromTail }), [detachedFromTail])
}

/** Both markers the chat list needs to stay still: what wakes its header, and
 *  the native scroll-anchoring config that must not be rebuilt per render. */
export function useChatListRenderStability(inputs: {
  agentStatus: unknown
  backgroundTaskReport: unknown
  hostBackgroundTasks: unknown
  queuedMessages: unknown
  unanchoredTurnStatus: unknown
  turnActivity: unknown
  /** The reader has the list (`detachedFromTail`), not the jump button's flag. */
  detachedFromTail: boolean
}): { headerExtraData: readonly unknown[]; contentPosition: { disabled: boolean } } {
  return {
    headerExtraData: useNativeChatListHeaderExtraData(inputs),
    contentPosition: useChatListContentPosition(inputs.detachedFromTail)
  }
}
