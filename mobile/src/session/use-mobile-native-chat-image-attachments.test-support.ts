import { expect, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import type { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

// Shared by the image-attachment suites. The picker mock cannot live here:
// vi.mock is hoisted per test file, so each suite declares its own.
export function ok(id: string, result: unknown): RpcSuccess {
  return { id, ok: true, result, _meta: { runtimeId: 'r' } }
}
export function methodNotFound(id: string): RpcResponse {
  return {
    id,
    ok: false,
    error: { code: 'method_not_found', message: 'no' },
    _meta: { runtimeId: 'r' }
  }
}
export function sendResult(accepted: boolean): RpcSuccess {
  return { id: 'send', ok: true, result: { send: { accepted } }, _meta: { runtimeId: 'r' } }
}

/** Answers a request by its method, for a case where the order of requests is what it tests. */
export type RespondByMethod = (
  method: string,
  params: Record<string, unknown>
) => RpcResponse | Promise<RpcResponse>

// A connected client: a send reads the live state before it writes
// (mobile-native-chat-send-readiness.ts), so the double carries it too.
// Answers from the queue in turn, or by method when handed a function.
export function makeClient(
  responses: (RpcResponse | Promise<RpcResponse>)[] | RespondByMethod
): Pick<RpcClient, 'sendRequest' | 'getState' | 'notifyForeground'> & {
  calls: { method: string; params: Record<string, unknown> }[]
} {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  return {
    calls,
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params: params as Record<string, unknown> })
      // A photo send for Claude looks at the screen for its chips; these doubles have no
      // screen, which is a host that cannot show one, and the send goes on as before.
      if (method === 'terminal.read' && typeof responses !== 'function') {
        return methodNotFound('screen')
      }
      if (typeof responses === 'function') {
        return responses(method, params as Record<string, unknown>)
      }
      const response = responses.shift()
      if (!response) {
        throw new Error(`unexpected request: ${method}`)
      }
      return response
    })
  }
}

export type HookArgs = Parameters<typeof useMobileNativeChatImageAttachments>[0]
export type Hook = ReturnType<typeof useMobileNativeChatImageAttachments>

/** The follow a terminal tab's send hands its message send: the terminal it was verified
 *  against and the tab predicate (mobile-native-chat-send-follow.ts). */
export const FOLLOWING_TAB = expect.objectContaining({
  terminal: expect.any(String),
  reminted: false,
  tabChanged: expect.any(Function)
})

export const SCOPE_A = 'h\0w\0tab-a'
export const SCOPE_B = 'h\0w\0tab-b'

export function baseArgs(overrides: Partial<HookArgs> & Pick<HookArgs, 'client'>): HookArgs {
  return {
    agent: 'claude',
    structuredNativeChat: false,
    // No dialog on screen: these suites are about the paste and the text, and
    // their clients answer in order (mobile-native-chat-send-under-dialog.test.ts
    // drives the look itself).
    refuseUnderDialog: async () => null,
    activeHandleRef: { current: 'term-1' },
    deviceTokenRef: { current: null },
    getActiveWorktreeConnectionId: async () => null,
    connState: 'connected',
    scopeKey: SCOPE_A,
    enabled: true,
    showToast: vi.fn(),
    onSendError: vi.fn(),
    baseSend: vi.fn().mockResolvedValue('accepted'),
    readSeededLaunchDraft: () => null,
    sleep: async () => {},
    ...overrides
  }
}

/** Claude's composer once its photo paste has been read: the input holds the `[Image #N]`
 *  chips (Claude Code 2.1.288 `f1e`). A photo send waits for them before it types the
 *  caption (mobile-native-chat-image-send-settle.ts), so a fake desktop that shows
 *  only an empty box is one whose photo never attached. */
export function composerHoldingChips(count = 1): string[] {
  const chips = Array.from({ length: count }, (_, i) => `[Image #${i + 1}]`).join('')
  return EMPTY_COMPOSER.map((row) => (row.trim() === '❯' ? `❯ ${chips}` : row))
}
