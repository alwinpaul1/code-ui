// A folder opened, or whose read failed, while the link was down, after the host reconnects.
//
// Tapping a folder while the host is disconnected leaves its row on "Waiting for desktop..." with
// a Retry. On reconnect only the root reloaded: the queue the reconnect effect drains
// (pendingDirectoryRetriesRef) was filled only by the manual Retry, never by opening the folder,
// so the row kept saying "Waiting for desktop..." over a healthy connection (reproduced on main
// 0b2c7a92). A folder whose read failed mid-drop stayed on its error the same way. Each is now
// read again once on the next connection, and never while the host is still down.

import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileDirEntry } from './file-tree'
import type { RpcResponse } from '../transport/types'

type MockClient = { sendRequest: ReturnType<typeof vi.fn> }

const mockTransport = vi.hoisted((): { client: MockClient | null; connectionState: string } => ({
  client: null,
  connectionState: 'connected'
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: (props: {
      data: unknown[]
      keyExtractor: (item: unknown, index: number) => string
      renderItem: (info: {
        item: unknown
        index: number
        separators: Record<string, never>
      }) => ReactNode
    }) =>
      React.createElement(
        'FlatList',
        null,
        props.data.map((item, index) =>
          React.createElement(
            'FlatListItem',
            { key: props.keyExtractor(item, index) },
            props.renderItem({ item, index, separators: {} })
          )
        )
      ),
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View'
  }
})
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  File: 'File',
  FileText: 'FileText',
  Folder: 'Folder',
  Image: 'Image',
  Search: 'Search',
  X: 'X'
}))
vi.mock('../platform/haptics', () => ({ triggerSelection: vi.fn() }))
vi.mock('../transport/client-context', () => ({
  // On the page: nothing re-dials, so the reconnect has to come from the shell by itself.
  useForceReconnect: () => null,
  useHostClient: () => ({ client: mockTransport.client, state: mockTransport.connectionState })
}))

const { MobileFileExplorerPanel } = await import('./MobileFileExplorerPanel')

function entry(name: string, isDirectory = false): MobileDirEntry {
  return { name, isDirectory }
}

function ok(result: MobileDirEntry[]): RpcResponse {
  return { id: 'response-id', ok: true, result, _meta: { runtimeId: 'runtime-id' } }
}

const TREE: Record<string, MobileDirEntry[]> = {
  '': [entry('src', true), entry('README.md')],
  src: [entry('app.ts')]
}

function workingClient(): MockClient {
  return {
    sendRequest: vi.fn(async (_method: string, params: { relativePath: string }) =>
      ok(TREE[params.relativePath] ?? [])
    )
  }
}

function srcReads(client: MockClient): number {
  return client.sendRequest.mock.calls.filter(([, params]) => params?.relativePath === 'src').length
}

describe('a folder read that could not happen while the link was down', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    mockTransport.client = null
    mockTransport.connectionState = 'connected'
  })

  function panel() {
    return createElement(MobileFileExplorerPanel, {
      hostId: 'host-a',
      worktreeId: 'worktree-a',
      name: 'Example Worktree',
      embedded: true
    })
  }

  async function mount(): Promise<void> {
    await act(async () => {
      renderer = create(panel())
    })
  }

  async function connection(client: MockClient | null, state: string): Promise<void> {
    mockTransport.client = client
    mockTransport.connectionState = state
    await act(async () => {
      renderer?.update(panel())
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  async function openSrc(): Promise<void> {
    const row = renderer!.root
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Open folder src')
    await act(async () => {
      row?.props.onPress()
    })
  }

  function text(): string {
    return renderer!.root
      .findAllByType('Text' as never)
      .flatMap((node) => node.props.children)
      .join(' ')
  }

  it('reads a folder opened while disconnected once the host reconnects', async () => {
    mockTransport.client = workingClient()
    await mount()
    await connection(null, 'disconnected')
    await openSrc()
    expect(text()).toContain('Waiting for desktop...')

    const reconnected = workingClient()
    await connection(reconnected, 'connected')

    expect(srcReads(reconnected)).toBe(1)
    expect(text()).toContain('app.ts')
    expect(text()).not.toContain('Waiting for desktop...')
  })

  it('reads a folder whose read failed with the connection again on the next connection', async () => {
    const client = workingClient()
    client.sendRequest.mockImplementation(
      async (_method: string, params: { relativePath: string }) => {
        if (params.relativePath === 'src') {
          throw new Error('Connection interrupted')
        }
        return ok(TREE[params.relativePath] ?? [])
      }
    )
    mockTransport.client = client
    await mount()
    await openSrc()
    expect(text()).toContain('Connection interrupted')

    await connection(client, 'reconnecting')
    expect(srcReads(client)).toBe(1)
    client.sendRequest.mockImplementation(
      async (_method: string, params: { relativePath: string }) =>
        ok(TREE[params.relativePath] ?? [])
    )
    await connection(client, 'connected')

    expect(srcReads(client)).toBe(2)
    expect(text()).toContain('app.ts')
  })

  it('does not read it while the host stays down, nor twice for one reconnect', async () => {
    mockTransport.client = workingClient()
    await mount()
    await connection(null, 'disconnected')
    await openSrc()
    await connection(null, 'reconnecting')
    await connection(null, 'disconnected')
    expect(text()).toContain('Waiting for desktop...')

    const reconnected = workingClient()
    await connection(reconnected, 'connected')
    await connection(reconnected, 'connected')
    await connection(reconnected, 'connected')

    expect(srcReads(reconnected)).toBe(1)
  })

  it('does not loop on a folder the host refuses on a healthy connection', async () => {
    const client = workingClient()
    client.sendRequest.mockImplementation(
      async (_method: string, params: { relativePath: string }) =>
        params.relativePath === 'src'
          ? {
              id: 'r',
              ok: false,
              error: { code: 'internal', message: 'read failed' },
              _meta: { runtimeId: 'r' }
            }
          : ok(TREE[params.relativePath] ?? [])
    )
    mockTransport.client = client
    await mount()
    await openSrc()
    await connection(client, 'connected')
    await connection(client, 'connected')

    expect(srcReads(client)).toBe(1)
    expect(text()).toContain('read failed')
  })
})
