import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileComputerAwake } from './use-mobile-computer-awake'

function ok(settings: Record<string, unknown>) {
  return { id: 'r', ok: true as const, result: { settings }, _meta: { runtimeId: 'rt' } }
}

function makeClient(initial: Record<string, unknown>) {
  let stored = { ...initial }
  const sendRequest = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'settings.get') {
      return ok(stored)
    }
    if (method === 'settings.update') {
      stored = { ...stored, ...params }
      return ok(stored)
    }
    throw new Error(`unexpected ${method}`)
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest, stored: () => stored }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useMobileComputerAwake', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  function mount(client: RpcClient, enabled = true) {
    let latest: ReturnType<typeof useMobileComputerAwake> | null = null
    function Harness(props: { enabled: boolean }): null {
      latest = useMobileComputerAwake({ client, enabled: props.enabled })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness, { enabled }))
    })
    return {
      api: () => latest!,
      update: (next: boolean) =>
        act(() => renderer!.update(createElement(Harness, { enabled: next })))
    }
  }

  it('reads the current mode from the host when opened', async () => {
    const { client, sendRequest } = makeClient({
      computerAwakeMode: 'auto',
      keepComputerAwakeWhileAgentsRun: true
    })
    const { api } = mount(client)
    expect(api().mode).toBeNull()
    await flush()
    expect(api().mode).toBe('auto')
    expect(api().supported).toBe(true)
    expect(sendRequest).toHaveBeenCalledWith('settings.get')
  })

  it('reports unsupported when the host omits both keys', async () => {
    const { client } = makeClient({ defaultTaskSource: 'github' })
    const { api } = mount(client)
    await flush()
    expect(api().supported).toBe(false)
    expect(api().mode).toBeNull()
  })

  it('does nothing while closed', async () => {
    const { client, sendRequest } = makeClient({ computerAwakeMode: 'on' })
    mount(client, false)
    await flush()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it.each(['on', 'auto', 'off'] as const)(
    'case %s: writes both host keys and shows what the host echoed back',
    async (mode) => {
      const { client, sendRequest, stored } = makeClient({
        computerAwakeMode: mode === 'off' ? 'on' : 'off',
        keepComputerAwakeWhileAgentsRun: mode === 'off'
      })
      const { api } = mount(client)
      await flush()
      let accepted = false
      await act(async () => {
        accepted = await api().setMode(mode)
      })
      expect(accepted).toBe(true)
      expect(sendRequest).toHaveBeenCalledWith('settings.update', {
        computerAwakeMode: mode,
        keepComputerAwakeWhileAgentsRun: mode !== 'off'
      })
      expect(stored().computerAwakeMode).toBe(mode)
      expect(api().mode).toBe(mode)
      expect(api().saving).toBe(false)
      expect(api().error).toBeNull()
    }
  )

  it('rolls back and reports when the host refuses', async () => {
    const { client, sendRequest } = makeClient({ computerAwakeMode: 'on' })
    const { api } = mount(client)
    await flush()
    sendRequest.mockImplementationOnce(async () => ({
      id: 'r',
      ok: false as const,
      error: { code: 'nope', message: 'settings locked' },
      _meta: { runtimeId: 'rt' }
    }))
    let accepted = true
    await act(async () => {
      accepted = await api().setMode('off')
    })
    expect(accepted).toBe(false)
    expect(api().mode).toBe('on')
    expect(api().error).toBe('settings locked')
  })
})
