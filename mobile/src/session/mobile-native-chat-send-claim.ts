import type { RpcClient } from '../transport/rpc-client'
import {
  SEND_TERMINAL_RESTARTED,
  type MobileNativeChatSendFollow
} from './mobile-native-chat-send-follow'
import type { MobileNativeChatSendGate } from './mobile-native-chat-send-readiness'
import {
  acquireMobileNativeChatTerminalWriteForSend,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

/** What the claimed send's body returns when the message send found the tab on
 *  another terminal before it wrote anything (follow.reminted). */
export const SEND_REMINTED = 'reminted'

export type MobileNativeChatSendClaim = {
  /** The terminal this attempt writes to; null when the tab had none and still has none. */
  readonly terminal: string | null
  /** For the message send's own wait; null on a session tab, which has no terminal to follow. */
  readonly follow: MobileNativeChatSendFollow | null
}

/**
 * Runs a composer send's body against the terminal its TAB has, not the one it
 * was tapped on. Identity is the tab: a switch to another tab refuses; the same
 * tab given a new terminal handle (a PTY restart, a desktop graph reload) is
 * followed, once.
 *
 * Identity comes from the host: a handle counts as this tab's only when the
 * session-tab snapshot names it as the tab's `terminal` (`hostTerminal`). The
 * phone's own active handle moving without the snapshot saying so (closing the
 * active terminal re-points it at another tab's) is read as a switch and refuses.
 *
 * The screen check is not airtight (agentComposerOnScreen, claudeLiveFrame): a
 * restored PTY's emulator is seeded with the old scrollback, so a seeded box whose
 * indented footer rows came with it and with nothing drawn below by the new process
 * yet still reads as Claude. A device check must settle it: wake a sleeping Claude
 * tab and read its screen before the agent paints.
 *
 * Following is a hazard: if the agent exited, the tab's new terminal can be a
 * plain shell, and the message and its Enter would run there as a command. The
 * tab's `agent` is no evidence (a hand-started agent's type outlives its process
 * by about 30 minutes), so the send restarts from the top on the new handle (its
 * own write lock, its own look for a dialog) and then needs `verify` to show the
 * agent's composer on that screen before anything is written. A second change,
 * a screen that cannot be read and an unrecognised one all refuse, with the
 * draft and the chips kept.
 */
export async function sendFollowingTheTab(
  args: {
    readonly tappedTerminal: string | null
    readonly structured: boolean
    readonly liveTerminal: () => string | null
    readonly tabChanged: () => boolean
    /** The terminal the host's snapshot names for this tab (hostTerminalOfTab). */
    readonly hostTerminal: () => string | null
    readonly sendGate: Pick<MobileNativeChatSendGate, 'wait'>
    readonly deadline: number
    /** The look at the screen for a dialog, and for a screen with no input box;
     *  its refusal, or null. `followed` is true on the restarted attempt, where
     *  `verify` is the stricter proof of the composer and says its own word
     *  (SEND_TERMINAL_RESTARTED): the look then asks for the dialog only. */
    readonly look: (client: RpcClient, terminal: string, followed: boolean) => Promise<string | null>
    readonly verify: (client: RpcClient, terminal: string) => Promise<boolean>
    /** Says why nothing was written, and answers false. */
    readonly refuse: (message: string) => false
  },
  run: (claim: MobileNativeChatSendClaim) => Promise<boolean | typeof SEND_REMINTED>
): Promise<boolean> {
  const { structured, liveTerminal, tabChanged, refuse } = args
  let terminal = args.tappedTerminal
  let followed = false
  for (;;) {
    const held = terminal
    // Serialize clear/paste/submit per terminal while other tabs send. Shared
    // with the prompt-card writes, so a card tap cannot interleave into a
    // mid-flight paste. Taken for a composer send, which may let it go once its
    // body is written and it only reads (mobile-native-chat-send-write.ts).
    const owner = held ? acquireMobileNativeChatTerminalWriteForSend(held) : null
    if (held && !owner) {
      return refuse('Message not sent')
    }
    try {
      let moved = !structured && liveTerminal() !== held
      if (!structured && held && !moved) {
        // A dialog on screen takes typed keys as answers (2026-09-27): looked at
        // before anything is written, so a refusal leaves the draft where it is.
        const client = await args.sendGate.wait(args.deadline, tabChanged)
        const refusal = client && (await args.look(client, held, followed))
        if (!client || refusal) {
          return refusal ? refuse(refusal) : false
        }
        moved = liveTerminal() !== held
        if (!moved && followed) {
          if (!(await args.verify(client, held))) {
            return refuse(SEND_TERMINAL_RESTARTED)
          }
          moved = liveTerminal() !== held
        }
      }
      if (!moved) {
        const follow = !structured && held ? { terminal: held, tabChanged, reminted: false } : null
        const result = await run({ terminal: held, follow })
        if (result !== SEND_REMINTED) {
          return result
        }
      }
      // The tab has another terminal than the one this attempt looked at.
      if (tabChanged()) {
        return refuse('Message not sent (session changed)')
      }
      const live = liveTerminal()
      // The phone's own active handle moving (closing a terminal re-points it at
      // another tab's) is not the host giving THIS tab a terminal.
      if (live && args.hostTerminal() !== live) {
        return refuse('Message not sent (session changed)')
      }
      if (!live || followed) {
        return refuse(SEND_TERMINAL_RESTARTED)
      }
      terminal = live
      followed = true
    } finally {
      releaseMobileNativeChatTerminalWrite(held, owner ?? undefined)
    }
  }
}
