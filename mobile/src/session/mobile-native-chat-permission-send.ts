import { useCallback, type MutableRefObject } from 'react'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import type { RpcClient } from '../transport/rpc-client'
import {
  sendMobileNativeChatMessageWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

export async function sendMobileNativeChatPermissionResponse(args: {
  client: RpcClient
  terminal: string
  deviceToken: string | null
  text: string
  expectedCodexPermission?: MobileChatPermission | null
}): Promise<MobileNativeChatSendOutcome> {
  if (args.expectedCodexPermission) {
    // Recheck the visible command before sending a shortcut. A stale card
    // must not approve a different command after a reconnect or desktop click.
    try {
      const response = await args.client.sendRequest(
        'terminal.read',
        { terminal: args.terminal, screen: true },
        { timeoutMs: 4_000, budgetSpansConnect: true }
      )
      if (!response.ok) {
        return 'rejected'
      }
      const result = response.result as { terminal?: { tail?: unknown; lines?: unknown } }
      const raw = result?.terminal?.tail ?? result?.terminal?.lines
      const lines = Array.isArray(raw)
        ? raw.filter((line): line is string => typeof line === 'string')
        : []
      const current = codexPermissionFromScreen(lines)
      if (
        JSON.stringify(current) !== JSON.stringify(args.expectedCodexPermission) ||
        !current?.options.some((option) => option.send === args.text)
      ) {
        return 'rejected'
      }
    } catch {
      return 'rejected'
    }
  }
  // Why: approval choices are already complete terminal control sequences;
  // appending Return changes both numbered choices and Escape denial.
  return sendMobileNativeChatMessageWithOutcome({
    client: args.client,
    terminal: args.terminal,
    text: args.text,
    enter: false,
    ...(args.deviceToken ? { mobileClient: { id: args.deviceToken, type: 'mobile' as const } } : {})
  })
}

export function useMobileNativeChatPermissionSend(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  onSendError: (message: string) => void
  expectedCodexPermission?: MobileChatPermission | null
}): (text: string) => Promise<boolean> {
  return useCallback(
    async (text: string): Promise<boolean> => {
      const terminal = args.handleRef.current
      if (!args.client || !terminal || !args.enabled) {
        args.onSendError('Response not sent (disconnected)')
        return false
      }
      // A choice keystroke must not interleave into a mid-flight composed write
      // (image paste, paced answer) on the same PTY.
      if (!acquireMobileNativeChatTerminalWrite(terminal)) {
        args.onSendError('Response not sent')
        return false
      }
      // No stale-input heal here (unlike the text/ask sends): a choice is an
      // `enter: false` key for an active overlay that swallows the clear, so it
      // would consume the marker still protecting the next real message.
      let outcome: MobileNativeChatSendOutcome
      try {
        outcome = await sendMobileNativeChatPermissionResponse({
          client: args.client,
          terminal,
          deviceToken: args.deviceTokenRef.current,
          text,
          expectedCodexPermission: args.expectedCodexPermission
        })
      } finally {
        releaseMobileNativeChatTerminalWrite(terminal)
      }
      if (outcome === 'unknown') {
        // Why: the response may have been delivered (ack lost / path cutover) —
        // a definite "not sent" would invite a double answer.
        args.onSendError('Response unconfirmed — check chat before retrying')
      } else if (outcome === 'rejected') {
        args.onSendError('Response not sent')
      }
      return outcome === 'accepted'
    },
    [
      args.client,
      args.deviceTokenRef,
      args.enabled,
      args.expectedCodexPermission,
      args.handleRef,
      args.onSendError
    ]
  )
}
