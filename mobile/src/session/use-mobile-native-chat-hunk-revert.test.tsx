import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEditFile, type NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { MobileNativeChatRevertHunk } from './mobile-diff-hunk-revert-request'
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
  onHandler: (handler: MobileNativeChatRevertHunk) => void
}): null {
  const handler = useMobileNativeChatHunkRevert({
    client: props.client,
    worktreeId: props.worktreeId,
    nativeChatSessionId: props.nativeChatSessionId,
    getActiveSessionTabId: () => props.activeSessionTabId
  })
  props.onHandler(handler)
  return null
}

describe('the chat view’s hunk revert handler', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('fails plainly, without reaching for a socket, while the desktop is not connected', async () => {
    const handlers: MobileNativeChatRevertHunk[] = []
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
    const handlers: MobileNativeChatRevertHunk[] = []
    const props = {
      client,
      worktreeId: 'wt-1',
      nativeChatSessionId: 'sess-1',
      activeSessionTabId: 'tab-1',
      onHandler: (handler: MobileNativeChatRevertHunk) => handlers.push(handler)
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
