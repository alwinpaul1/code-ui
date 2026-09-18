import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useMobileNativeChatSkills } from './use-mobile-native-chat-skills'

function Harness(props: {
  client: Pick<RpcClient, 'sendRequest'>
  onLoad: (load: () => void) => void
}): null {
  const { loadNativeChatSkills } = useMobileNativeChatSkills({ client: props.client, worktreeId: 'w1' })
  props.onLoad(loadNativeChatSkills)
  return null
}

function refused(code: string, message: string): RpcResponse {
  return { id: 'rpc', ok: false, error: { code, message }, _meta: { runtimeId: 'r' } }
}

describe('the / menu’s skills list on a host that refuses skills.discover', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  async function openMenuTwiceAcrossTheStaleWindow(reply: RpcResponse): Promise<number> {
    vi.useFakeTimers()
    const sendRequest = vi.fn(async () => reply)
    const loads: (() => void)[] = []
    act(() => {
      renderer = create(createElement(Harness, { client: { sendRequest }, onLoad: (load) => loads.push(load) }))
    })
    await act(async () => {
      loads[0]!()
      await Promise.resolve()
      await Promise.resolve()
    })
    // Past SKILLS_STALE_MS: a host that answered would be asked again here.
    await act(async () => {
      vi.advanceTimersByTime(4_000)
      loads[0]!()
      await Promise.resolve()
    })
    return sendRequest.mock.calls.length
  }

  // 2026-09-18: Orca 1.4.205's mobile-scope dispatch gate refuses
  // skills.discover from a phone. The hook latched only method_not_found, so
  // every `/` re-asked the host for an answer that could not change.
  it('asks once and stops when the mobile gate refuses, the way it already stops for an old host', async () => {
    expect(
      await openMenuTwiceAcrossTheStaleWindow(
        refused('forbidden', "Method 'skills.discover' is not available to mobile clients")
      )
    ).toBe(1)
  })

  it('still asks once and stops for a host too old to know the method', async () => {
    expect(await openMenuTwiceAcrossTheStaleWindow(refused('method_not_found', 'Unknown method: skills.discover'))).toBe(1)
  })

  it('does ask again after a refusal that could change, such as a busy host', async () => {
    expect(await openMenuTwiceAcrossTheStaleWindow(refused('runtime_busy', 'try again'))).toBe(2)
  })
})
