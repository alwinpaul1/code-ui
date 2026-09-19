import { isTerminalQueryReply } from '../../../src/shared/terminal-query-reply'
import type { RpcClient } from '../transport/rpc-client'
import { terminalInputSend } from './mobile-terminal-operations'

type TerminalSubscriptionRegistry = {
  has: (handle: string) => boolean
}

type MobileTerminalQueryReplyOptions = {
  bytes: string
  client: RpcClient | null
  clientId: string | null
  connected: boolean
  handle: string
  hostSupportsQueryReplyInput: boolean
  /** Host OS from status.get; null until the capability probe answers. */
  hostPlatform?: NodeJS.Platform | null
  subscribedTerminals: TerminalSubscriptionRegistry
}

export function sendMobileTerminalQueryReply({
  bytes,
  client,
  clientId,
  connected,
  handle,
  hostSupportsQueryReplyInput,
  hostPlatform = null,
  subscribedTerminals
}: MobileTerminalQueryReplyOptions): Promise<boolean> {
  // Why: on a Windows host the reply is written into ConPTY as keyboard input.
  // ConPTY answers DA1 and cursor-position queries itself, and a cooked
  // PowerShell prompt echoes anything else — a phone-answered XTVERSION + DA1
  // showed up as "^[P>|xterm…^[[?1;2c" typed into the shell the moment `claude`
  // started. The POSIX ECHO-safe write path the host uses has no ConPTY
  // equivalent, so the phone stays silent there.
  if (hostPlatform === 'win32') {
    return Promise.resolve(false)
  }
  // Why: every subscribed mobile xterm suppresses main's responder, including
  // hidden panes, so ownership follows the subscription rather than focus.
  // Hosts without terminal.query-reply-input.v1 strip inputKind and would take
  // reply bytes as floor-stealing shell input, so drop (pre-fix behavior).
  if (
    !client ||
    !connected ||
    !hostSupportsQueryReplyInput ||
    !subscribedTerminals.has(handle) ||
    !isTerminalQueryReply(bytes)
  ) {
    return Promise.resolve(false)
  }

  return terminalInputSend
    .request(client, {
      terminal: handle,
      text: bytes,
      enter: false,
      inputKind: 'query-reply',
      ...(clientId ? { client: { id: clientId, type: 'mobile' as const } } : {})
    })
    .then(
      (reply) => terminalInputSend.interpret(reply) === true,
      () => false
    )
}
