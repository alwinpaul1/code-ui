import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'

type Send = (text: string) => Promise<boolean>

/**
 * Whether a Claude tab on the Anthropic lane posts `text` to Anthropic or types it into the
 * terminal. A slash command (or any line-leading `/token`) goes the terminal way, as it did before
 * the lane existed: whether Claude Code runs a command that arrives over Remote Control is
 * unverified (docs/claude-app-parity-gaps.md §1.4), and the terminal path knows commands.
 */
export function claudeComposerSendGoes(text: string): 'anthropic' | 'terminal' {
  return classifyMobileNativeChatSend('claude', text) === 'chat' ? 'anthropic' : 'terminal'
}

const routed = new WeakMap<Send, WeakMap<Send, Send>>()

/**
 * The composer's send on a chat tab: through Anthropic (use-ccr-composer-send.ts) when the tab is
 * on that lane, the composer holds no attachments and the words are not a slash command, else the
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
