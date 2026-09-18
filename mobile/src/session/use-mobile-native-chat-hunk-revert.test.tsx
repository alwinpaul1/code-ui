import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEditFile, type NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { MobileNativeChatRevertHunk } from './mobile-diff-hunk-revert-request'

// The host's answer to "may a phone call files.write?" — see
// host-mobile-capabilities.ts. Faked here so this suite tests the binding,
// not the probe; the probe has its own suite.
const gate = vi.hoisted(() => ({ filesWrite: true, asked: [] as string[] }))
vi.mock('../transport/host-mobile-capabilities', () => ({
  useHostMobileCapability: (hostId: string, key: string) => {
    gate.asked.push(`${hostId}:${key}`)
    return key === 'files.write' ? gate.filesWrite : false
  }
}))

import { useMobileNativeChatHunkRevert } from './use-mobile-native-chat-hunk-revert'

const card: NativeChatEditFile = finalizeEditFile({
  path: '/w/src/app.ts',
  oldPath: null,
  changeKind: 'edited',
  lineNumbersKnown: true,
  lines: [
    { kind: 'del', text: 'x', oldLineNumber: 1, newLineNumber: null },
    { kind: 'add', text: 'y', oldLineNumber: null, newLineNumber: 1 }
  ]
})

function Harness(props: {
  client: RpcClient | null
  worktreeId: string
  nativeChatSessionId: string | null
  activeSessionTabId: string | null
  onHandler: (handler: MobileNativeChatRevertHunk | undefined) => void
}): null {
  const handler = useMobileNativeChatHunkRevert({
    client: props.client,
    hostId: 'host-1',
    worktreeId: props.worktreeId,
    nativeChatSessionId: props.nativeChatSessionId,
    getActiveSessionTabId: () => props.activeSessionTabId
  })
  props.onHandler(handler)
  return null
}

describe('the chat view’s hunk revert handler', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    gate.filesWrite = true
    gate.asked.length = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('offers no revert at all on a host whose mobile gate refuses files.write', () => {
    // Orca 1.4.205: every files.write from a mobile-scope token is refused, so
    // a card that offered "Revert this hunk" failed on every tap (2026-09-18).
    gate.filesWrite = false
    const handlers: (MobileNativeChatRevertHunk | undefined)[] = []
    act(() => {
      renderer = create(
        createElement(Harness, {
          client: { sendRequest: vi.fn() } as unknown as RpcClient,
          worktreeId: 'wt-1',
          nativeChatSessionId: 'sess-1',
          activeSessionTabId: 'tab-1',
          onHandler: (handler) => handlers.push(handler)
        })
      )
    })
    expect(handlers[0]).toBeUndefined()
    expect(gate.asked).toContain('host-1:files.write')
  })

  it('offers the revert, exactly as before, once the host has said files.write gets through', () => {
    gate.filesWrite = true
    const handlers: (MobileNativeChatRevertHunk | undefined)[] = []
    act(() => {
      renderer = create(
        createElement(Harness, {
          client: { sendRequest: vi.fn() } as unknown as RpcClient,
          worktreeId: 'wt-1',
          nativeChatSessionId: 'sess-1',
          activeSessionTabId: 'tab-1',
          onHandler: (handler) => handlers.push(handler)
        })
      )
    })
    expect(typeof handlers[0]).toBe('function')
  })

  it('fails plainly, without reaching for a socket, while the desktop is not connected', async () => {
    const handlers: (MobileNativeChatRevertHunk | undefined)[] = []
    act(() => {
      renderer = create(
        createElement(Harness, {
          client: null,
          worktreeId: 'wt-1',
          nativeChatSessionId: 'sess-1',
          activeSessionTabId: 'tab-1',
          onHandler: (handler) => handlers.push(handler)
        })
      )
    })
    await expect(handlers[0]!(card, 0, 'msg:0:0:0')).resolves.toEqual({
      status: 'failed',
      message: 'Not connected to the desktop.'
    })
  })

  it('sends the chat tab and session as the path’s provenance, and keeps one identity across renders', async () => {
    const sendRequest = vi.fn(
      async (): Promise<RpcResponse> => ({
        id: 'rpc',
        ok: true,
        result: { exists: false, isDirectory: false },
        _meta: { runtimeId: 'r' }
      })
    )
    const client = { sendRequest } as unknown as RpcClient
    const handlers: (MobileNativeChatRevertHunk | undefined)[] = []
    const props = {
      client,
      worktreeId: 'wt-1',
      nativeChatSessionId: 'sess-1',
      activeSessionTabId: 'tab-1',
      onHandler: (handler: MobileNativeChatRevertHunk | undefined) => handlers.push(handler)
    }
    act(() => {
      renderer = create(createElement(Harness, props))
    })
    act(() => {
      renderer!.update(createElement(Harness, { ...props, activeSessionTabId: 'tab-2' }))
    })
    expect(handlers[1]).toBe(handlers[0])
    await handlers[1]!(card, 0, 'msg:0:0:0')
    // The latest tab, not the one the handler was made under.
    expect(sendRequest.mock.calls[0]?.[1]).toEqual({
      worktree: 'id:wt-1',
      pathText: '/w/src/app.ts',
      nativeChatContext: { tabId: 'tab-2', sessionId: 'sess-1' }
    })
  })
})
