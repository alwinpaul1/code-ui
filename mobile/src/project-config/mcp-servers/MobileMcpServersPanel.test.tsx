import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { RpcClient } from '../../transport/rpc-client'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'View' }))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  Plus: 'Plus',
  Terminal: 'Terminal',
  Trash2: 'Trash2'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), canGoBack: () => false, replace: vi.fn() }) }))
vi.mock('../../components/BottomDrawer', () => ({ BottomDrawer: 'View' }))

const fakes = vi.hoisted(() => ({ client: null as RpcClient | null }))
vi.mock('../../transport/client-context', () => ({
  useHostClient: () => ({ client: fakes.client, clientId: 'c1', state: 'connected' })
}))

import { MobileMcpServersPanel } from './MobileMcpServersPanel'

function mockClient(reads: Record<string, unknown>): RpcClient {
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'session.tabs.list') {
      return { ok: true, result: { tabs: [] } }
    }
    if (method === 'files.read') {
      const value = reads[params.relativePath as string]
      if (value === undefined) {
        return { ok: false, error: { code: 'runtime_error', message: 'ENOENT: no such file or directory' } }
      }
      return { ok: true, result: { content: value, truncated: false, byteLength: String(value).length } }
    }
    return { ok: true, result: {} }
  })
  return { getState: () => 'connected', sendRequest } as unknown as RpcClient
}

async function render(client: RpcClient): Promise<ReactTestRenderer> {
  fakes.client = client
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      createElement(MobileMcpServersPanel, { hostId: 'h1', worktreeId: 'w1', name: 'my-repo' })
    )
    await Promise.resolve()
    await Promise.resolve()
  })
  return renderer
}

function allText(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType('Text' as never).map((node) => String(node.props.children))
}

describe('MobileMcpServersPanel', () => {
  it('offers Create when .mcp.json does not exist yet', async () => {
    const renderer = await render(mockClient({}))
    expect(allText(renderer)).toContain('No .mcp.json in this worktree yet.')
    act(() => renderer.unmount())
  })

  it('degenerate: an .mcp.json with zero servers shows the empty state, not an error', async () => {
    const renderer = await render(mockClient({ '.mcp.json': JSON.stringify({ mcpServers: {} }) }))
    expect(allText(renderer)).toContain('No MCP servers configured.')
    act(() => renderer.unmount())
  })

  it('lists a server and masks its env value, never showing the secret', async () => {
    const renderer = await render(
      mockClient({
        '.mcp.json': JSON.stringify({
          mcpServers: { local: { command: 'npx', env: { API_KEY: 'sk-super-secret' } } }
        })
      })
    )
    const text = allText(renderer)
    expect(text).toContain('local')
    expect(text).toContain('API_KEY=<set>')
    expect(text.join(' ')).not.toContain('sk-super-secret')
    act(() => renderer.unmount())
  })

  it('shows a line number for malformed JSON and never renders an editable list over it', async () => {
    const renderer = await render(mockClient({ '.mcp.json': '{\n  "mcpServers": {\n' }))
    const text = allText(renderer).join(' ')
    expect(text).toMatch(/Line \d+:/)
    act(() => renderer.unmount())
  })

  it('a jailed path read error is shown as the host’s refusal, not a blank screen', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'session.tabs.list') {
        return { ok: true, result: { tabs: [] } }
      }
      if (method === 'files.read') {
        return { ok: false, error: { code: 'runtime_error', message: 'invalid_relative_path' } }
      }
      return { ok: true, result: {} }
    })
    const client = { getState: () => 'connected', sendRequest } as unknown as RpcClient
    const renderer = await render(client)
    expect(allText(renderer).join(' ')).toMatch(/outside the project/i)
    act(() => renderer.unmount())
  })
})
