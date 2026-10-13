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
  /** The active tab is a PTY tab, so the terminal frame owns the screen when
   *  this is not a chat, whether or not its pane has mounted yet. */
  ptyTab: boolean
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
  // the frame empty; that is the half 0.5.69 missed. A chat tab draws; a PTY tab
  // that is not a chat yields to its terminal frame; anything else draws unless
  // a terminal is actually mounted under us.
  if (args.showNativeChat) {
    return 'draw'
  }
  // A PTY tab that is not a chat is the terminal's, mounted or not. Drawing
  // here put an empty chat and a "Waiting for terminal…" composer over an
  // Antigravity tab whose pane had not mounted, above the terminal's own input
  // bar (0.9.131, 2026-10-13). The "nothing to yield to" fallback below is for
  // agent-session tabs, which never have a pane.
  if (args.ptyTab) {
    return 'terminal'
  }
  return args.hasTerminalUnderneath ? 'terminal' : 'draw'
}
