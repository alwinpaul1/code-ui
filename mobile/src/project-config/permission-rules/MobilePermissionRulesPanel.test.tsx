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
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'dark',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'View' }))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  Plus: 'Plus',
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

import { MobilePermissionRulesPanel } from './MobilePermissionRulesPanel'
import { PROJECT_CONFIG_READ_ONLY_NOTICE } from '../ProjectConfigReadOnlyNotice'

function mockClient(reads: Record<string, unknown>): RpcClient {
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
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
      createElement(MobilePermissionRulesPanel, { hostId: 'h1', worktreeId: 'w1', name: 'my-repo' })
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

/** The tappable "Add rule" row under each category (not the add modal's title). */
function addRuleRows(renderer: ReactTestRenderer) {
  return renderer.root
    .findAllByType('Pressable' as never)
    .filter((node) => node.findAllByType('Text' as never).some((t) => t.props.children === 'Add rule'))
}

const ONE_ALLOW_RULE = JSON.stringify({ permissions: { allow: ['Bash(npm run *)'] } })

describe('MobilePermissionRulesPanel', () => {
  beforeEach(() => {
    fakes.filesWrite = true
  })

  // 2026-09-18: Orca 1.4.205's mobile-scope dispatch gate refuses every
  // files.write from a phone, so Save was offered and every tap was refused.
  describe('on a host whose mobile gate refuses files.write', () => {
    beforeEach(() => {
      fakes.filesWrite = false
    })

    it('is a viewer: no Add rule, no Remove, no Save, and one line says so', async () => {
      const renderer = await render(mockClient({ '.claude/settings.json': ONE_ALLOW_RULE }))
      const text = allText(renderer)
      expect(addRuleRows(renderer)).toHaveLength(0)
      expect(buttonLabels(renderer)).not.toContain('Save')
      expect(
        renderer.root.findAll((node) => node.props?.accessibilityLabel === 'Remove Bash(npm run *)')
      ).toHaveLength(0)
      expect(text.filter((t) => t === PROJECT_CONFIG_READ_ONLY_NOTICE)).toHaveLength(1)
      // The rule itself is still listed: read-only, not empty.
      expect(text).toContain('Bash(npm run *)')
      act(() => renderer.unmount())
    })

    it('still offers Create for a missing settings file, which files.createFile allows', async () => {
      const renderer = await render(mockClient({}))
      expect(buttonLabels(renderer)).toContain('Create')
      act(() => renderer.unmount())
    })
  })

  it('is editable exactly as before once the host is known to let files.write through', async () => {
    fakes.filesWrite = true
    const renderer = await render(mockClient({ '.claude/settings.json': ONE_ALLOW_RULE }))
    const text = allText(renderer)
    expect(addRuleRows(renderer)).toHaveLength(3)
    expect(buttonLabels(renderer)).toContain('Save')
    expect(
      renderer.root.findAll((node) => node.props?.accessibilityLabel === 'Remove Bash(npm run *)')
    ).toHaveLength(1)
    expect(text).not.toContain(PROJECT_CONFIG_READ_ONLY_NOTICE)
    act(() => renderer.unmount())
  })

  it('states whether an edit applies live or needs a restart, not assuming either', async () => {
    const renderer = await render(mockClient({ '.claude/settings.json': '{}' }))
    expect(
      allText(renderer).some((t) => t.includes('re-reads an existing settings file live'))
    ).toBe(true)
    act(() => renderer.unmount())
  })

  it('degenerate: settings.json with no permissions key shows three empty categories, not an error', async () => {
    const renderer = await render(mockClient({ '.claude/settings.json': JSON.stringify({ model: 'opus' }) }))
    const text = allText(renderer)
    expect(text).toContain('Allow')
    expect(text).toContain('Deny')
    expect(text).toContain('Ask')
    expect(text.filter((t) => t === 'No rules.')).toHaveLength(3)
    act(() => renderer.unmount())
  })

  it('lists rules under their category', async () => {
    const renderer = await render(
      mockClient({
        '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Read', 'Bash(npm run *)'] } })
      })
    )
    const text = allText(renderer)
    expect(text).toContain('Read')
    expect(text).toContain('Bash(npm run *)')
    act(() => renderer.unmount())
  })

  it('offers Create when the destination file does not exist yet', async () => {
    const renderer = await render(mockClient({}))
    expect(allText(renderer).some((t) => t.includes('does not exist yet'))).toBe(true)
    expect(allText(renderer)).toContain('Create')
    act(() => renderer.unmount())
  })

  it('switching destination reads the other file (.claude/settings.local.json)', async () => {
    const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'files.read') {
        if (params.relativePath === '.claude/settings.json') {
          return { ok: true, result: { content: '{}', truncated: false, byteLength: 2 } }
        }
        return { ok: false, error: { code: 'runtime_error', message: 'ENOENT: no such file' } }
      }
      return { ok: true, result: {} }
    })
    const client = { getState: () => 'connected', sendRequest } as unknown as RpcClient
    const renderer = await render(client)
    const localToggle = renderer.root
      .findAllByType('Pressable' as never)
      .find((node) => node.findAllByType('Text' as never).some((t) => t.props.children === 'Local'))
    expect(localToggle).toBeDefined()
    await act(async () => {
      localToggle!.props.onPress()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledWith('files.read', {
      worktree: 'id:w1',
      relativePath: '.claude/settings.local.json'
    })
    act(() => renderer.unmount())
  })

  it('shows a line number for malformed JSON and refuses to render the rule lists over it', async () => {
    const renderer = await render(mockClient({ '.claude/settings.json': '{\n  "permissions": {\n' }))
    expect(allText(renderer).join(' ')).toMatch(/Line \d+:/)
    act(() => renderer.unmount())
  })

  it('a jailed path read error is shown as the host’s refusal', async () => {
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
