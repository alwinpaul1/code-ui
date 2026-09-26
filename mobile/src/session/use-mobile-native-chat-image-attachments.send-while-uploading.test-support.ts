import { vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcResponse } from '../transport/types'
import {
  baseArgs,
  makeClient,
  methodNotFound,
  sendResult,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

// Shared by the suites on a send tapped while a photo is still uploading. The
// picker mock cannot live here: vi.mock is hoisted per test file.

export const LANES = ['terminal', 'structured'] as const
export type Lane = (typeof LANES)[number]

export function failed(id: string, message: string): RpcResponse {
  return { id, ok: false, error: { code: 'failed', message }, _meta: { runtimeId: 'r' } }
}

export function deferred(): {
  promise: Promise<RpcResponse>
  resolve: (response: RpcResponse) => void
} {
  let resolve: (response: RpcResponse) => void = () => {}
  const promise = new Promise<RpcResponse>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** A host that answers each upload from the queue a case sets up and every
 *  terminal write at once, so a send that writes too early shows in what it
 *  pasted, not in which canned answer it happened to take. A case that needs
 *  a write held open passes its own `write`. */
export function uploadHost(
  saves: (RpcResponse | Promise<RpcResponse>)[],
  link: { state: ConnectionState } = { state: 'connected' },
  write: () => RpcResponse | Promise<RpcResponse> = () => sendResult(true)
) {
  const host = makeClient((method) => {
    if (method === 'clipboard.startImageUpload') {
      return methodNotFound('start')
    }
    if (method === 'clipboard.saveImageAsTempFile') {
      const save = saves.shift()
      if (!save) {
        throw new Error('unexpected upload')
      }
      return save
    }
    if (method === 'terminal.send') {
      return write()
    }
    throw new Error(`unexpected request: ${method}`)
  })
  const client = {
    ...host,
    getState: () => link.state,
    // A link that was up before this case began, as every case's is.
    getLastConnectedAt: () => 1
  }
  const pasted = (): string[] =>
    host.calls
      .filter((call) => call.method === 'terminal.send')
      .map((call) => String(call.params.text))
  return { client: client as unknown as RpcClient, pasted }
}

/** Lets the upload's own awaits run, so its request is out before the next step. */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export function laneArgs(
  lane: Lane,
  client: RpcClient,
  overrides: Partial<HookArgs> = {}
): HookArgs {
  return baseArgs({
    client,
    structuredNativeChat: lane === 'structured',
    beginImageSend: vi.fn(() => null),
    baseSend: vi.fn().mockResolvedValue('accepted'),
    ...overrides
  })
}

/** What the send put in front of the agent: the pasted path on a terminal,
 *  the attachment handed to the session on a structured lane. */
export function sentPaths(lane: Lane, args: HookArgs, pasted: () => string[]): string[] {
  if (lane === 'terminal') {
    return pasted().flatMap((text) => text.match(/\/tmp\/[\w-]+\.png/g) ?? [])
  }
  const calls = vi.mocked(args.baseSend).mock.calls
  return calls.flatMap((call) => (call[3] ?? []).map((attachment) => attachment.path))
}
