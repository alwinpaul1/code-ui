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
    edits = 0
  })

  /** Stands in for the composer's own edit counter, which only a keystroke bumps. */
  let edits = 0

  function mount(client: RpcClient, initial: { enabled: boolean; text: string }) {
    const handleRef = { current: 'term-1' }
    const deviceTokenRef = { current: 'dev' }
    let latest: ReturnType<typeof useMobileNativeChatDraftMirror> | null = null
    function Harness(props: { enabled: boolean; text: string }): null {
      latest = useMobileNativeChatDraftMirror({
        client,
        handleRef,
        deviceTokenRef,
        getComposerEditGeneration: () => edits,
        ...props
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness, initial))
    })
    return {
      /** A keystroke: the composer's counter moves, then the text arrives. */
      type: (props: { enabled: boolean; text: string }) => {
        edits += 1
        act(() => renderer!.update(createElement(Harness, props)))
      },
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
    const { type } = mount(client, { enabled: true, text: '' })
    type({ enabled: true, text: 'fi' })
    await flush()
    type({ enabled: true, text: 'fix' })
    await flush()
    const texts = sendRequest.mock.calls.map(([method, params]) => {
      expect(method).toBe('terminal.send')
      expect(params.enter).toBe(false)
      expect(params.terminal).toBe('term-1')
      return params.text
    })
    // The clear and the first text go out as one frame (one relay round trip).
    expect(texts).toEqual([CTRL_U + 'fi', 'x'])
  })

  it('forgets the line on settleBeforeSend so the emptied composer sends nothing', async () => {
    const { client, sendRequest } = makeClient()
    const { type, api } = mount(client, { enabled: true, text: '' })
    type({ enabled: true, text: 'go' })
    await flush()
    await act(async () => {
      await api().settleBeforeSend()
    })
    sendRequest.mockClear()
    type({ enabled: true, text: '' })
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
    // The next edit after a send starts a fresh line.
    type({ enabled: true, text: 'a' })
    await flush()
    expect(sendRequest.mock.calls.map(([, params]) => params.text)).toEqual([CTRL_U + 'a'])
  })

  it('sends nothing while disabled', async () => {
    const { client, sendRequest } = makeClient()
    const { type } = mount(client, { enabled: false, text: '' })
    type({ enabled: false, text: 'typing' })
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('does not type a stored draft into the desktop when it hydrates a render late', async () => {
    // 2026-09-13, reported from the phone: opening the chat typed leftover text
    // into the desktop Claude Code composer ("t toggle and terminal mode toggle
    // regressions"). The baseline was captured on the first render, but the
    // stored draft is read from disk and arrives after it, so the mirror read
    // the hydrate as something the user had just typed.
    const { client, sendRequest } = makeClient()
    const { update } = mount(client, { enabled: true, text: '' })
    await flush()
    update({ enabled: true, text: 'Chat toggle and terminal mode toggle regressions' })
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('still echoes what the user types after a draft hydrated late', async () => {
    const { client, sendRequest } = makeClient()
    const { update, type } = mount(client, { enabled: true, text: '' })
    await flush()
    update({ enabled: true, text: 'restored' })
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
    type({ enabled: true, text: 'restored!' })
    await flush()
    expect(sendRequest).toHaveBeenCalled()
  })
})
