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

const fakes = vi.hoisted(() => ({
  client: null as RpcClient | null,
  filesWrite: 'allowed' as 'allowed' | 'forbidden' | 'unknown'
}))
vi.mock('../../transport/client-context', () => ({
  useHostClient: () => ({ client: fakes.client, clientId: 'c1', state: 'connected' })
}))
// The host's answer to "may a phone call files.write?" (host-mobile-capabilities.ts).
// Faked so this suite tests what the screen does with the answer, not the probe.
vi.mock('../../transport/host-mobile-capabilities', () => ({
  useHostMobileCapabilityVerdict: (_hostId: string, key: string) =>
    key === 'files.write' ? fakes.filesWrite : 'unknown'
}))

import { MobilePermissionRulesPanel } from './MobilePermissionRulesPanel'
import { PROJECT_CONFIG_READ_ONLY_NOTICE } from '../ProjectConfigReadOnlyNotice'
import { ThemeProvider } from '../../theme/theme-context'

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
    fakes.filesWrite = 'allowed'
  })

  // 2026-09-18: Orca 1.4.205's mobile-scope dispatch gate refuses every
  // files.write from a phone, so Save was offered and every tap was refused.
  describe('on a host whose mobile gate refuses files.write', () => {
    beforeEach(() => {
      fakes.filesWrite = 'forbidden'
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

  // Review of f877572: seeding a host with all-unknown drew the read-only
  // line for one round trip on a host that allows the write — a lie for
  // 250 ms. Until the host has answered, neither Save nor the line is drawn.
  it('draws neither Save nor the read-only line until the host has answered', async () => {
    fakes.filesWrite = 'unknown'
    const renderer = await render(mockClient({ '.claude/settings.json': ONE_ALLOW_RULE }))
    expect(buttonLabels(renderer)).not.toContain('Save')
    expect(addRuleRows(renderer)).toHaveLength(0)
    expect(allText(renderer)).not.toContain(PROJECT_CONFIG_READ_ONLY_NOTICE)
    expect(allText(renderer)).toContain('Bash(npm run *)')
    act(() => renderer.unmount())
  })

  it('is editable exactly as before once the host is known to let files.write through', async () => {
    fakes.filesWrite = 'allowed'
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

  // The write carries the rules as they were when Save was tapped; an add or remove made while it
  // is on the wire never reaches the host. Only Save was disabled (review, 2026-09-30).
  describe('while a save is on the wire', () => {
    const TWO_ALLOW_RULES = JSON.stringify({ permissions: { allow: ['Read', 'Bash(npm run *)'] } })

    async function savingPanel(scheme: 'light' | 'dark') {
      let releaseWrite!: (reply: unknown) => void
      const reads: Record<string, string> = {
        '.claude/settings.json': TWO_ALLOW_RULES,
        '.claude/settings.local.json': JSON.stringify({ permissions: { deny: ['WebFetch'] } })
      }
      const client = mockClient(reads)
      const send = client.sendRequest as unknown as ReturnType<typeof vi.fn>
      const fallback = send.getMockImplementation() as unknown as (
        method: string,
        params: Record<string, unknown>
      ) => Promise<unknown>
      send.mockImplementation(async (method: string, params: Record<string, unknown>) =>
        method === 'files.write'
          ? new Promise((resolve) => {
              releaseWrite = resolve
            })
          : fallback(method, params)
      )
      fakes.client = client
      let renderer!: ReactTestRenderer
      await act(async () => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <MobilePermissionRulesPanel hostId="h1" worktreeId="w1" name="my-repo" />
          </ThemeProvider>
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      act(() => removeRule(renderer, 'Bash(npm run *)').props.onPress())
      act(() => saveButton(renderer).props.onPress())
      return { renderer, send, release: (reply: unknown) => releaseWrite(reply) }
    }

    function removeRule(renderer: ReactTestRenderer, rule: string) {
      return renderer.root.find(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === `Remove ${rule}`
      )
    }

    /** The footer's Save (the add-rule dialog has a Save of its own). */
    function saveButton(renderer: ReactTestRenderer) {
      const footerSave = renderer.root.find(
        (node) => node.props?.block === true && /^Sav(e|ing…)$/.test(String(node.props.label))
      )
      return footerSave.findAll((node) => node.props?.accessibilityRole === 'button')[0]!
    }

    /** The block holding the three categories' rows and "Add rule" rows. */
    function ruleLists(renderer: ReactTestRenderer) {
      return renderer.root.find(
        (node) => String(node.type) === 'View' && node.props.testID === 'permission-rule-lists'
      )
    }

    it.each(['light', 'dark'] as const)(
      'will not add or remove a rule, and looks disabled until it lands (%s)',
      async (scheme) => {
        const { renderer, send, release } = await savingPanel(scheme)
        expect(saveButton(renderer).props.accessibilityLabel).toBe('Saving…')
        expect(send).toHaveBeenLastCalledWith('files.write', {
          worktree: 'id:w1',
          relativePath: '.claude/settings.json',
          content: JSON.stringify({ permissions: { allow: ['Read'] } }, null, 2) + '\n'
        })

        const lists = ruleLists(renderer)
        expect(lists.props.pointerEvents).toBe('none')
        expect(lists.props.accessibilityState).toEqual({ disabled: true })
        expect(Object.assign({}, ...[lists.props.style].flat().filter(Boolean)).opacity).toBe(0.5)
        // A tap that reaches a row anyway changes nothing, and opens no add dialog.
        act(() => removeRule(renderer, 'Read').props.onPress())
        act(() => addRuleRows(renderer)[0]!.props.onPress())
        expect(allText(renderer)).toContain('Read')
        expect(
          renderer.root.findAll((node) => node.props?.title === 'Add an allow rule')
        ).toHaveLength(0)

        await act(async () => {
          release({ ok: true, result: {} })
          await Promise.resolve()
        })
        expect(ruleLists(renderer).props.pointerEvents).toBe('auto')
        expect(saveButton(renderer).props.accessibilityState).toEqual({ disabled: true })
        act(() => renderer.unmount())
      }
    )

    it('does not mark the other destination saved when its tab is switched to mid-save', async () => {
      const { renderer, release } = await savingPanel('light')
      const localToggle = renderer.root
        .findAllByType('Pressable' as never)
        .find((node) => node.findAllByType('Text' as never).some((t) => t.props.children === 'Local'))!
      await act(async () => {
        localToggle.props.onPress()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(allText(renderer)).toContain('WebFetch')

      await act(async () => {
        release({ ok: true, result: {} })
        await Promise.resolve()
      })
      // The local file was only read: nothing to save, and nothing claimed saved over it.
      expect(allText(renderer)).toContain('WebFetch')
      expect(saveButton(renderer).props.accessibilityLabel).toBe('Save')
      expect(saveButton(renderer).props.accessibilityState).toEqual({ disabled: true })
      act(() => renderer.unmount())
    })
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
