import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

  function mount(
    client: RpcClient,
    initial: { enabled: boolean; text: string },
    agent: string | null = null
  ) {
    const handleRef = { current: 'term-1' }
    const agentRef = { current: agent }
    const deviceTokenRef = { current: 'dev' }
    let latest: ReturnType<typeof useMobileNativeChatDraftMirror> | null = null
    function Harness(props: { enabled: boolean; text: string }): null {
      latest = useMobileNativeChatDraftMirror({
        client,
        handleRef,
        deviceTokenRef,
        agentRef,
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
  // A leading `!` arriving into the empty desktop input switches Claude Code 2.1.287 to bash mode
  // (and Codex has `! for shell commands`), so echoing a draft that starts with `!` put the desktop
  // in shell mode while the user was still typing, before the "Run on the desktop?" question and
  // before the send (mobile-native-chat-shell-command.ts says how it was read).
  describe.each(['claude', 'codex'])('on a %s tab, a draft that starts with !', (agent) => {
    it('is not echoed onto the desktop input', async () => {
      const { client, sendRequest } = makeClient()
      const { type } = mount(client, { enabled: true, text: '' }, agent)
      type({ enabled: true, text: '!' })
      await flush()
      type({ enabled: true, text: '!l' })
      await flush()
      type({ enabled: true, text: '!ls -la' })
      await flush()
      expect(sendRequest).not.toHaveBeenCalled()
    })

    it('stops being echoed once a ! is typed in front of an echoed draft', async () => {
      const { client, sendRequest } = makeClient()
      const { type } = mount(client, { enabled: true, text: '' }, agent)
      type({ enabled: true, text: 'ls' })
      await flush()
      sendRequest.mockClear()
      type({ enabled: true, text: '!ls' })
      await flush()
      expect(sendRequest).not.toHaveBeenCalled()
    })

    it('is echoed again, from a fresh line, once the ! is deleted', async () => {
      const { client, sendRequest } = makeClient()
      const { type } = mount(client, { enabled: true, text: '' }, agent)
      type({ enabled: true, text: '!ls' })
      await flush()
      type({ enabled: true, text: 'ls' })
      await flush()
      expect(sendRequest.mock.calls.map(([, params]) => params.text)).toEqual([CTRL_U + 'ls'])
    })

    it('is echoed when a space comes first: the agent keeps the space and it is no switch', async () => {
      const { client, sendRequest } = makeClient()
      const { type } = mount(client, { enabled: true, text: '' }, agent)
      type({ enabled: true, text: ' !ls' })
      await flush()
      expect(sendRequest).toHaveBeenCalled()
    })

    it('is echoed when the bang is not first', async () => {
      const { client, sendRequest } = makeClient()
      const { type } = mount(client, { enabled: true, text: '' }, agent)
      type({ enabled: true, text: 'wow!' })
      await flush()
      expect(sendRequest).toHaveBeenCalled()
    })
  })

  it('still echoes a draft that starts with ! on a tab that has no shell command door', async () => {
    const { client, sendRequest } = makeClient()
    const { type } = mount(client, { enabled: true, text: '' }, 'omp')
    type({ enabled: true, text: '!ls' })
    await flush()
    expect(sendRequest).toHaveBeenCalled()
  })

  // Structure: the controller is what hands the hook the tab's agent. Without it the
  // hook cannot tell a `!` draft from any other and echoes it onto the desktop.
  it('is given the tab\'s agent by the chat controller', () => {
    const controller = readFileSync(
      fileURLToPath(new URL('./use-mobile-native-chat-controller.ts', import.meta.url)),
      'utf8'
    )
      .split('\n')
      .filter((row) => !/^\s*(\/\/|\/\*|\*)/.test(row))
      .join('\n')
    const call = controller.slice(controller.indexOf('useMobileNativeChatDraftMirror({'))
    expect(call.slice(0, call.indexOf('})'))).toMatch(/agentRef: activeChatAgentRef/)
  })

})
