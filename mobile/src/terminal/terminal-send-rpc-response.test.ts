import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '../transport/types'
import {
  isTerminalSendResultAccepted,
  isTerminalSendRpcAccepted
} from './terminal-send-rpc-response'

const runtimeMeta = { runtimeId: 'test-runtime' } as const

describe('terminal send RPC response', () => {
  it('Given accepted terminal send result When checked Then reports success', () => {
    // Given
    const result = { send: { handle: 'terminal-1', accepted: true, bytesWritten: 1 } }

    // When / Then
    expect(isTerminalSendResultAccepted(result)).toBe(true)
  })

  it('Given rejected terminal send result When checked Then reports failure', () => {
    // Given
    const result = { send: { handle: 'terminal-1', accepted: false, bytesWritten: 0 } }

    // When / Then
    expect(isTerminalSendResultAccepted(result)).toBe(false)
  })

  it('Given absent or malformed terminal send result When checked Then reports failure', () => {
    // Given: a refusal envelope carries no result at all, and a fulfilled one may carry the
    // wrong shape.
    const absent = undefined
    const malformed = {}

    // When / Then
    expect(isTerminalSendResultAccepted(absent)).toBe(false)
    expect(isTerminalSendResultAccepted(malformed)).toBe(false)
  })

  // CODE UI keeps the envelope form for its own raw sends (see the module).
  it('Given a whole envelope When checked Then a refusal and a malformed success both report failure', () => {
    const accepted: RpcResponse = {
      id: '1',
      ok: true,
      result: { send: { handle: 'terminal-1', accepted: true, bytesWritten: 1 } },
      _meta: runtimeMeta
    }
    const rpcFailure: RpcResponse = {
      id: '1',
      ok: false,
      error: { code: 'terminal_error', message: 'failed' },
      _meta: runtimeMeta
    }
    const malformedSuccess: RpcResponse = { id: '2', ok: true, result: {}, _meta: runtimeMeta }

    expect(isTerminalSendRpcAccepted(accepted)).toBe(true)
    expect(isTerminalSendRpcAccepted(rpcFailure)).toBe(false)
    expect(isTerminalSendRpcAccepted(malformedSuccess)).toBe(false)
  })
})
