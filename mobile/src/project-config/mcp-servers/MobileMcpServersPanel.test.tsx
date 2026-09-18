import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const fakes = vi.hoisted(() => ({ client: null as RpcClient | null, filesWrite: true }))
vi.mock('../../transport/client-context', () => ({
  useHostClient: () => ({ client: fakes.client, clientId: 'c1', state: 'connected' })
}))
// The host's answer to "may a phone call files.write?" (host-mobile-capabilities.ts).
// Faked so this suite tests what the screen does with the answer, not the probe.
vi.mock('../../transport/host-mobile-capabilities', () => ({
  useHostMobileCapability: (_hostId: string, key: string) => key === 'files.write' && fakes.filesWrite
}))

import { MobileMcpServersPanel } from './MobileMcpServersPanel'
import { PROJECT_CONFIG_READ_ONLY_NOTICE } from '../ProjectConfigReadOnlyNotice'

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

function buttonLabels(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => node.props?.accessibilityRole === 'button')
    .map((node) => String(node.props.accessibilityLabel))
}

const ONE_SERVER = JSON.stringify({ mcpServers: { local: { command: 'npx' } } })

describe('MobileMcpServersPanel', () => {
  beforeEach(() => {
    fakes.filesWrite = true
  })

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

  // 2026-09-18: Orca 1.4.205's mobile-scope dispatch gate refuses every
  // files.write from a phone, so Save was offered and every tap was refused.
  describe('on a host whose mobile gate refuses files.write', () => {
    beforeEach(() => {
      fakes.filesWrite = false
    })

    it('is a viewer: no Add server, no Save, no Remove, rows not editable, and one line says so', async () => {
      const renderer = await render(mockClient({ '.mcp.json': ONE_SERVER }))
      const labels = buttonLabels(renderer)
      expect(labels).not.toContain('Add server')
      expect(labels).not.toContain('Save')
      expect(renderer.root.findAll((node) => node.props?.accessibilityLabel === 'Remove local')).toHaveLength(0)
      const row = renderer.root
        .findAllByType('Pressable' as never)
        .find((node) => node.findAllByType('Text' as never).some((t) => t.props.children === 'local'))
      expect(row?.props.disabled).toBe(true)
      expect(allText(renderer).filter((t) => t === PROJECT_CONFIG_READ_ONLY_NOTICE)).toHaveLength(1)
      // The server itself is still shown: read-only, not empty.
      expect(allText(renderer)).toContain('local')
      act(() => renderer.unmount())
    })

    it('still offers Create for a missing .mcp.json, which files.createFile allows', async () => {
      const renderer = await render(mockClient({}))
      expect(buttonLabels(renderer)).toContain('Create .mcp.json')
      act(() => renderer.unmount())
    })
  })

  it('is editable exactly as before once the host is known to let files.write through', async () => {
    fakes.filesWrite = true
    const renderer = await render(mockClient({ '.mcp.json': ONE_SERVER }))
    const labels = buttonLabels(renderer)
    expect(labels).toContain('Add server')
    expect(labels).toContain('Save')
    expect(renderer.root.findAll((node) => node.props?.accessibilityLabel === 'Remove local')).toHaveLength(1)
    expect(allText(renderer)).not.toContain(PROJECT_CONFIG_READ_ONLY_NOTICE)
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
