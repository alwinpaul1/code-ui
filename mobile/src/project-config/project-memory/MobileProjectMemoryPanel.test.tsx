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
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'View' }))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  FileText: 'FileText'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), canGoBack: () => false, replace: vi.fn() }) }))

const fakes = vi.hoisted(() => ({ client: null as RpcClient | null }))
vi.mock('../../transport/client-context', () => ({
  useHostClient: () => ({ client: fakes.client, clientId: 'c1', state: 'connected' })
}))

import { MobileProjectMemoryPanel } from './MobileProjectMemoryPanel'

function mockClient(reads: Record<string, unknown>): RpcClient {
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'files.read') {
      const value = reads[params.relativePath as string]
      if (value === undefined) {
        return { ok: false, error: { code: 'runtime_error', message: 'ENOENT: no such file or directory' } }
      }
      if (value === 'TRUNCATED') {
        return { ok: true, result: { content: 'partial', truncated: true, byteLength: 999_999 } }
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
    renderer = create(createElement(MobileProjectMemoryPanel, { hostId: 'h1', worktreeId: 'w1', name: 'my-repo' }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return renderer
}

function allText(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType('Text' as never).map((node) => String(node.props.children))
}

describe('MobileProjectMemoryPanel', () => {
  it('lists all three candidates, whichever exist', async () => {
    const renderer = await render(mockClient({ 'CLAUDE.md': '# hi' }))
    const text = allText(renderer)
    expect(text).toContain('CLAUDE.md')
    expect(text).toContain('.claude/CLAUDE.md')
    expect(text).toContain('CLAUDE.local.md')
    act(() => renderer.unmount())
  })

  it('states auto-memory and ~/.claude/CLAUDE.md are out of reach, once', async () => {
    const renderer = await render(mockClient({}))
    const matches = allText(renderer).filter((t) => t.includes('Auto-memory'))
    expect(matches).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('shows a byte count for an existing file and "Not created yet" for a missing one', async () => {
    const renderer = await render(mockClient({ 'CLAUDE.md': '# hi' }))
    const text = allText(renderer)
    expect(text).toContain('4 bytes')
    expect(text.filter((t) => t === 'Not created yet')).toHaveLength(2)
    act(() => renderer.unmount())
  })

  it('opening a missing file offers Create, and creating it re-reads to an editable empty file', async () => {
    const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'files.read') {
        if (params.relativePath !== 'CLAUDE.md') {
          return { ok: false, error: { code: 'runtime_error', message: 'ENOENT: no such file' } }
        }
        return sendRequest.mock.calls.filter((c) => c[0] === 'files.createFile').length === 0
          ? { ok: false, error: { code: 'runtime_error', message: 'ENOENT: no such file' } }
          : { ok: true, result: { content: '', truncated: false, byteLength: 0 } }
      }
      if (method === 'files.createFile') {
        return { ok: true, result: { ok: true } }
      }
      return { ok: true, result: {} }
    })
    const client = { getState: () => 'connected', sendRequest } as unknown as RpcClient
    const renderer = await render(client)
    const rows = renderer.root.findAllByType('Pressable' as never)
    const claudeMdRow = rows.find((node) =>
      node.findAllByType('Text' as never).some((t) => t.props.children === 'CLAUDE.md')
    )
    await act(async () => {
      claudeMdRow!.props.onPress()
      await Promise.resolve()
    })
    expect(allText(renderer).some((t) => t.includes('does not exist yet'))).toBe(true)
    const createButton = renderer.root
      .findAllByType('Pressable' as never)
      .find((node) => node.findAllByType('Text' as never).some((t) => t.props.children === 'Create'))
    await act(async () => {
      createButton!.props.onPress()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledWith('files.createFile', {
      worktree: 'id:w1',
      relativePath: 'CLAUDE.md'
    })
    act(() => renderer.unmount())
  })

  it('a truncated file refuses the editor rather than risking a save that corrupts it', async () => {
    const renderer = await render(mockClient({ 'CLAUDE.md': 'TRUNCATED' }))
    const rows = renderer.root.findAllByType('Pressable' as never)
    const claudeMdRow = rows.find((node) =>
      node.findAllByType('Text' as never).some((t) => t.props.children === 'CLAUDE.md')
    )
    await act(async () => {
      claudeMdRow!.props.onPress()
      await Promise.resolve()
    })
    expect(allText(renderer).join(' ')).toMatch(/too large/i)
    expect(renderer.root.findAllByType('TextInput' as never)).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('a jailed path read error is shown as the host’s refusal on the row', async () => {
    const sendRequest = vi.fn(async (method: string) => {
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
