import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatDraftMirror } from './use-mobile-native-chat-draft-mirror'

// A tapped queued message is pulled back into the agent's own input by its
// recall key and loaded into the phone composer from there
// (queued-message-tap-to-composer.test.ts). The desktop input already holds the
// words, so the mirror must take them as what it has written: setting the
// composer to them is an edit, and the mirror otherwise reads it as a fresh line
// to clear and type, which retypes the message over itself, or on a
// several-line message clears one line with Ctrl+U and glues the rest.

const CTRL_U = '\x15'

function makeClient() {
  const sendRequest = vi.fn().mockResolvedValue({ id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'rt' } })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('the draft mirror after a queued message comes back to the composer', () => {
  let renderer: ReactTestRenderer | null = null
  let edits = 0
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    edits = 0
  })

  function mount(client: RpcClient) {
    let latest: ReturnType<typeof useMobileNativeChatDraftMirror> | null = null
    function Harness(props: { text: string }): null {
      latest = useMobileNativeChatDraftMirror({
        client,
        enabled: true,
        handleRef: { current: 'term-1' },
        deviceTokenRef: { current: 'dev' },
        agentRef: { current: 'claude' },
        getComposerEditGeneration: () => edits,
        ...props
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness, { text: '' }))
    })
    return {
      /** What the controller does with a recall: adopt, then set the composer (an edit). */
      recall: (text: string) => {
        latest!.adoptRecalledInput('term-1', text)
        edits += 1
        act(() => renderer!.update(createElement(Harness, { text })))
      },
      type: (text: string) => {
        edits += 1
        act(() => renderer!.update(createElement(Harness, { text })))
      },
      api: () => latest!
    }
  }

  const writes = (sendRequest: ReturnType<typeof vi.fn>): string[] =>
    sendRequest.mock.calls.map(([, params]) => (params as { text: string }).text)

  it('writes nothing when the composer takes the words the desktop input already holds', async () => {
    const { client, sendRequest } = makeClient()
    const { recall } = mount(client)
    recall('then also say goodbye in French')
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('edits the recalled line in place, without clearing it first', async () => {
    const { client, sendRequest } = makeClient()
    const { recall, type } = mount(client)
    recall('say goodbye')
    await flush()
    type('say goodbye!')
    await flush()
    expect(writes(sendRequest)).toEqual(['!'])
    expect(writes(sendRequest).join('')).not.toContain(CTRL_U)
  })

  it('leaves a several-line recall alone until the send replaces it', async () => {
    const { client, sendRequest } = makeClient()
    const { recall, type, api } = mount(client)
    recall('alpha first queued\nbravo second queued')
    await flush()
    type('alpha first queued\nbravo second queued, edited')
    await flush()
    // The mirror holds one line; a Ctrl+U would clear one row of two.
    expect(sendRequest).not.toHaveBeenCalled()
    // The send takes the line over; after it the mirror works as before.
    await act(async () => api().settleBeforeSend())
    type('')
    type('next')
    await flush()
    expect(writes(sendRequest).join('')).toBe(`${CTRL_U}next`)
  })
})
