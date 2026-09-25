import type { RpcClient } from '../transport/rpc-client'
import {
  openMobileNativeChatSendBudget,
  typeMobileNativeChatCommandWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import { healMobileNativeChatStaleInput } from './mobile-native-chat-stale-input'

/** A command whose ack was lost may have run; a retry could run it twice. */
export const COMMAND_UNCONFIRMED = 'Command unconfirmed — check chat before retrying'

/**
 * A slash command typed into Codex's composer, key by key: a stale paste is
 * healed first so the command is not glued onto it. Every failure says why,
 * because the picker that sent it stays open on a false result with nothing
 * else to tell the user (2026-09-25).
 */
export async function typeCodexChatCommand(args: {
  client: RpcClient
  terminal: string
  command: string
  deviceToken: string | null
  onSendError: (message: string) => void
}): Promise<MobileNativeChatSendOutcome> {
  const { client, terminal, command, deviceToken, onSendError } = args
  const deadline = openMobileNativeChatSendBudget()
  if (!(await healMobileNativeChatStaleInput({ client, terminal, deviceToken, deadline }))) {
    onSendError('Message not sent')
    return 'rejected'
  }
  const typed = await typeMobileNativeChatCommandWithOutcome({
    client,
    terminal,
    command,
    ...(deviceToken ? { mobileClient: { id: deviceToken, type: 'mobile' as const } } : {}),
    deadline
  })
  if (typed !== 'accepted') {
    onSendError(typed === 'unknown' ? COMMAND_UNCONFIRMED : 'Message not sent')
  }
  return typed
}
