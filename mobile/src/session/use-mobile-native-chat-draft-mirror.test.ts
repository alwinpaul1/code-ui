import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatDraftMirror } from './use-mobile-native-chat-draft-mirror'

const CTRL_U = '\x15'

function makeClient() {
  const sendRequest = vi.fn().mockResolvedValue({
    id: 'r',
    ok: true,
    result: { send: { accepted: true } },
    _meta: { runtimeId: 'rt' }
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useMobileNativeChatDraftMirror', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  function mount(client: RpcClient, initial: { enabled: boolean; text: string }) {
    const handleRef = { current: 'term-1' }
    const deviceTokenRef = { current: 'dev' }
    let latest: ReturnType<typeof useMobileNativeChatDraftMirror> | null = null
    function Harness(props: { enabled: boolean; text: string }): null {
      latest = useMobileNativeChatDraftMirror({ client, handleRef, deviceTokenRef, ...props })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness, initial))
    })
    return {
      update: (props: { enabled: boolean; text: string }) =>
        act(() => renderer!.update(createElement(Harness, props))),
      api: () => latest!
    }
  }

  it('does not retype a draft that was already there when the mirror enabled', async () => {
    const { client, sendRequest } = makeClient()
    mount(client, { enabled: true, text: 'stored draft' })
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('clears the TUI line once, then streams typed deltas', async () => {
    const { client, sendRequest } = makeClient()
    const { update } = mount(client, { enabled: true, text: '' })
    update({ enabled: true, text: 'fi' })
    await flush()
    update({ enabled: true, text: 'fix' })
    await flush()
    const texts = sendRequest.mock.calls.map(([method, params]) => {
      expect(method).toBe('terminal.send')
      expect(params.enter).toBe(false)
      expect(params.terminal).toBe('term-1')
      return params.text
    })
    expect(texts).toEqual([CTRL_U, 'fi', 'x'])
  })

  it('forgets the line on settleBeforeSend so the emptied composer sends nothing', async () => {
    const { client, sendRequest } = makeClient()
    const { update, api } = mount(client, { enabled: true, text: '' })
    update({ enabled: true, text: 'go' })
    await flush()
    await act(async () => {
      await api().settleBeforeSend()
    })
    sendRequest.mockClear()
    update({ enabled: true, text: '' })
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
    // The next edit after a send starts a fresh line.
    update({ enabled: true, text: 'a' })
    await flush()
    expect(sendRequest.mock.calls.map(([, params]) => params.text)).toEqual([CTRL_U, 'a'])
  })

  it('sends nothing while disabled', async () => {
    const { client, sendRequest } = makeClient()
    const { update } = mount(client, { enabled: false, text: '' })
    update({ enabled: false, text: 'typing' })
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
