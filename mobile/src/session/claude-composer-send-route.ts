import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'
import { shellCommandOfSend } from './mobile-native-chat-shell-command'

type Send = (text: string) => Promise<boolean>

/**
 * Whether a Claude tab on the Anthropic lane posts `text` to Anthropic or types it into the
 * terminal. A slash command (or any line-leading `/token`) goes the terminal way, as it did before
 * the lane existed: whether Claude Code runs a command that arrives over Remote Control is
 * unverified (docs/claude-app-parity-gaps.md §1.4), and the terminal path knows commands.
 *
 * A `!` shell command goes the terminal way too. The phone asks "Run on the desktop?" before it
 * (use-mobile-native-chat-shell-command-confirm.tsx), and only a `!` typed into Claude Code's
 * EMPTY input enters bash mode. Posted to Anthropic it is a plain user event, and nothing shows
 * Claude Code runs one of those as bash (unverified, as for slash commands); queued while Claude
 * works it waits on the phone as text, and at the turn's end it can come back to the composer
 * joined to the draft by a blank line (ccr-local-queue.ts). Inferred from the 2026-10-16 report
 * (Run, and nothing ran), whose phone log had rolled over before it could be read.
 */
export function claudeComposerSendGoes(text: string): 'anthropic' | 'terminal' {
  if (shellCommandOfSend(text, 'claude') !== null) {
    return 'terminal'
  }
  return classifyMobileNativeChatSend('claude', text) === 'chat' ? 'anthropic' : 'terminal'
}

const routed = new WeakMap<Send, WeakMap<Send, Send>>()

/**
 * The composer's send on a chat tab: through Anthropic (use-ccr-composer-send.ts) when the tab is
 * on that lane, the composer holds no attachments and the words are not a slash or `!` command, else the
 * terminal path (it carries files and types commands).
 * The same pair always yields the same function, so the composer's `onSend` keeps its identity.
 */
/** `attachments` is read only on the Anthropic lane: off it, the terminal send is all there is. */
export function claudeComposerSend(anthropic: Send | undefined, terminal: Send, attachments: () => number): Send {
  if (!anthropic || attachments() > 0) {
    return terminal
  }
  let byTerminal = routed.get(anthropic)
  if (!byTerminal) {
    byTerminal = new WeakMap()
    routed.set(anthropic, byTerminal)
  }
  let send = byTerminal.get(terminal)
  if (!send) {
    send = (text) => (claudeComposerSendGoes(text) === 'anthropic' ? anthropic(text) : terminal(text))
    byTerminal.set(terminal, send)
  }
  return send
}
