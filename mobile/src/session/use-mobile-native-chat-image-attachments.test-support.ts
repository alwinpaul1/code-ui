import { vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
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

export function makeClient(responses: (RpcResponse | Promise<RpcResponse>)[]): Pick<
  RpcClient,
  'sendRequest'
> & {
  calls: { method: string; params: Record<string, unknown> }[]
} {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  return {
    calls,
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params: params as Record<string, unknown> })
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

export const SCOPE_A = 'h\0w\0tab-a'
export const SCOPE_B = 'h\0w\0tab-b'

export function baseArgs(overrides: Partial<HookArgs> & Pick<HookArgs, 'client'>): HookArgs {
  return {
    structuredNativeChat: false,
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
