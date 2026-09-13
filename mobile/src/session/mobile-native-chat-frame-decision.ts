/** What the chat overlay puts on screen this render. */
export type MobileNativeChatFrame =
  /** Render the chat: its messages, or its empty state and composer. */
  | 'draw'
  /** Replay the last frame drawn for this surface, bridging a brief reload. */
  | 'hold'
  /** Render nothing, letting the terminal underneath own the screen. */
  | 'terminal'

export function mobileNativeChatFrameToShow(args: {
  /** The source has nothing to show right now: not a chat tab, or reloading empty. */
  blank: boolean
  /** This tab is a chat tab. */
  showNativeChat: boolean
  /** A frame was drawn for this surface earlier and can be replayed. */
  hasHeldFrame: boolean
  /** A terminal pane is mounted for the active tab, so yielding shows something. */
  hasTerminalUnderneath: boolean
}): MobileNativeChatFrame {
  if (!args.blank) {
    return 'draw'
  }
  if (args.hasHeldFrame) {
    return 'hold'
  }
  // Nothing to hold. The hold exists to bridge two REAL frames, so with no
  // earlier frame there is nothing to protect and blanking is pure loss: a
  // freshly created agent tab has no transcript yet, so it reloads empty
  // forever and the whole body stayed black, composer and all (reported from
  // the phone on 0.5.68, and still on 0.5.69).
  //
  // Yielding is only an answer when there is something to yield TO. An
  // agent-session tab has no terminal pane at all, so returning nothing left
  // the frame empty; that is the half 0.5.69 missed. Draw unless a terminal is
  // actually mounted under us and this is not a chat tab.
  if (args.showNativeChat) {
    return 'draw'
  }
  return args.hasTerminalUnderneath ? 'terminal' : 'draw'
}
