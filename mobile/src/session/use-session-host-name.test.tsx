import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The menu's "Reconnect from <host>" names the desktop the user paired. The host store is the
// only place that name lives; while it has not answered, or cannot, there is no name and the line
// says only Disconnected. A name is never made up.

const store = vi.hoisted(() => ({
  load: vi.fn<() => Promise<{ id: string; name: string; endpoint: string }[]>>()
}))
vi.mock('../transport/host-store', () => ({ loadHosts: () => store.load() }))

import { useSessionHostName } from './use-session-host-name'

let shown: string | null | undefined
let renderer: ReactTestRenderer | null = null

function Harness(props: { hostId: string | undefined }) {
  shown = useSessionHostName(props.hostId)
  return null
}

async function render(hostId: string | undefined) {
  await act(async () => {
    const element = createElement(Harness, { hostId })
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

const MAC = { id: 'host-1', name: 'Alwin’s Mac', endpoint: 'ws://100.64.0.2:6768' }
const LINUX = { id: 'host-2', name: 'Build box', endpoint: 'ws://100.64.0.3:6768' }

beforeEach(() => {
  store.load.mockReset()
  shown = undefined
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the paired desktop’s name', () => {
  it('is the name the host store holds for this host, not another host’s', async () => {
    store.load.mockResolvedValue([LINUX, MAC])
    await render('host-1')
    expect(shown).toBe('Alwin’s Mac')
  })

  it('is no name for a host the store does not hold', async () => {
    store.load.mockResolvedValue([LINUX])
    await render('host-1')
    expect(shown).toBeNull()
  })

  it('is no name, and no crash, when the store cannot be read', async () => {
    store.load.mockRejectedValue(new Error('storage unavailable'))
    await render('host-1')
    expect(shown).toBeNull()
  })

  it('is no name with no host id, and asks the store nothing', async () => {
    await render(undefined)
    expect(shown).toBeNull()
    expect(store.load).not.toHaveBeenCalled()
  })

  it('drops the old host’s name the moment the route moves to another host', async () => {
    store.load.mockResolvedValueOnce([MAC, LINUX])
    await render('host-1')
    expect(shown).toBe('Alwin’s Mac')
    store.load.mockImplementationOnce(() => new Promise(() => {}))
    await render('host-2')
    expect(shown).toBeNull()
  })
})
