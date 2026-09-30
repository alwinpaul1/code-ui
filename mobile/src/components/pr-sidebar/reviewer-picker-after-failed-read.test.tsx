// The reviewer picker after its people read FAILED.
//
// The drawer read github.listAssignableUsers once per open and drew a failure as bare text: no
// Retry, and no second read when the host reconnected (the RPC client is the same object across
// reconnects, so nothing in the effect's inputs moved). A read that failed because the link was
// dropping left the drawer a dead end until the user closed and reopened it (review round 3,
// 2026-09-30). These drive the REAL drawer and the REAL read over a host that refuses, drops, or
// answers each request as the case scripts it.
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../../transport/rpc-client'
import type { RpcResponse } from '../../transport/types'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check', RotateCw: 'RotateCw' }))
vi.mock('../BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))

const { ThemeProvider } = await import('../../theme/theme-context')
const { darkColors, lightColors } = await import('../../theme/tokens')
const { ReviewerPickerDrawer } = await import('./ReviewerPickerDrawer')

type Reply = () => Promise<RpcResponse>

const PEOPLE = [
  { login: 'alice', name: 'Alice', avatarUrl: 'https://example.invalid/a.png' },
  { login: 'bob', name: null, avatarUrl: 'https://example.invalid/b.png' }
]
const answered: Reply = async () => ({ id: 'r', ok: true, result: PEOPLE })
const refused: Reply = async () => ({
  id: 'r',
  ok: false,
  error: { code: 'runtime_timeout', message: 'GitHub did not answer in time' }
})
const dropped: Reply = async () => {
  throw new Error('Connection interrupted')
}

const FAILURES = [
  ['the host refuses the read', refused, 'GitHub did not answer in time'],
  ['the request is dropped with the link', dropped, 'Connection interrupted']
] as const

/** Each people read takes the next scripted reply; the last one repeats. */
function host(replies: Reply[]) {
  const sendRequest = vi.fn(async (method: string) => {
    if (method !== 'github.listAssignableUsers') {
      throw new Error(`unexpected ${method}`)
    }
    const next = replies.length > 1 ? replies.shift()! : replies[0]!
    return next()
  })
  return { client: { sendRequest } as unknown as RpcClient, reads: () => sendRequest.mock.calls.length }
}

let renderer: ReactTestRenderer | null = null

function picker(props: {
  client: RpcClient
  lastConnectedAt: number | null
  visible?: boolean
  scheme?: 'light' | 'dark'
}) {
  return (
    <ThemeProvider initialPreference={props.scheme ?? 'light'}>
      <ReviewerPickerDrawer
        visible={props.visible ?? true}
        onClose={() => undefined}
        client={props.client}
        worktreeId="repo::/wt"
        lastConnectedAt={props.lastConnectedAt}
        seededLogins={[]}
        isRequested={() => false}
        onToggle={() => undefined}
      />
    </ThemeProvider>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
  })
}

async function open(props: Parameters<typeof picker>[0]): Promise<void> {
  await act(async () => {
    renderer = create(picker(props))
  })
  await settle()
}

async function rerender(props: Parameters<typeof picker>[0]): Promise<void> {
  await act(async () => {
    renderer!.update(picker(props))
  })
  await settle()
}

function texts(): string[] {
  return renderer!.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => [node.props.children].flat().join(''))
}

function people(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('Request ')
    )
    .map((node) => String(node.props.accessibilityLabel))
}

function retryButton(): ReactTestInstance | undefined {
  return renderer!.root
    .findAll(
      (node) =>
        String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Retry loading people'
    )
    .at(0)
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const raw = node.props.style
  const list = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('the reviewer picker after its people read failed', () => {
  it.each(FAILURES)(
    'offers Retry when %s, and shows the people once Retry reads again',
    async (_case, failure, reason) => {
      const desktop = host([failure, answered])
      await open({ client: desktop.client, lastConnectedAt: 1 })
      expect(texts()).toContain(reason)
      expect(people()).toEqual([])
      expect(retryButton()).toBeDefined()

      await act(async () => {
        retryButton()!.props.onPress()
      })
      await settle()
      expect(desktop.reads()).toBe(2)
      expect(people()).toEqual(['Request alice', 'Request bob'])
      expect(retryButton()).toBeUndefined()
    }
  )

  it.each(FAILURES)(
    'reads again by itself when the host reconnects after %s',
    async (_case, failure) => {
      const desktop = host([failure, answered])
      await open({ client: desktop.client, lastConnectedAt: 1 })
      expect(desktop.reads()).toBe(1)

      await rerender({ client: desktop.client, lastConnectedAt: 2 })
      expect(desktop.reads()).toBe(2)
      expect(people()).toEqual(['Request alice', 'Request bob'])
    }
  )

  it.each(FAILURES)(
    'reads once per new connection, never once per render, while %s every time',
    async (_case, failure) => {
      const desktop = host([failure])
      await open({ client: desktop.client, lastConnectedAt: 1 })
      await rerender({ client: desktop.client, lastConnectedAt: 1 })
      await rerender({ client: desktop.client, lastConnectedAt: 1 })
      expect(desktop.reads()).toBe(1)

      await rerender({ client: desktop.client, lastConnectedAt: 2 })
      await rerender({ client: desktop.client, lastConnectedAt: 2 })
      expect(desktop.reads()).toBe(2)
      expect(retryButton()).toBeDefined()

      await rerender({ client: desktop.client, lastConnectedAt: 3 })
      expect(desktop.reads()).toBe(3)
    }
  )

  it('does not read the people again on a reconnect once they are shown', async () => {
    const desktop = host([answered])
    await open({ client: desktop.client, lastConnectedAt: 1 })
    await rerender({ client: desktop.client, lastConnectedAt: 2 })
    expect(desktop.reads()).toBe(1)
    expect(people()).toEqual(['Request alice', 'Request bob'])
  })

  it('reads nothing on a reconnect while the picker is closed', async () => {
    const desktop = host([refused])
    await open({ client: desktop.client, lastConnectedAt: 1 })
    await rerender({ client: desktop.client, lastConnectedAt: 1, visible: false })
    await rerender({ client: desktop.client, lastConnectedAt: 2, visible: false })
    expect(desktop.reads()).toBe(1)
  })

  it('reads once, not twice, when reopened after the host reconnected while it was closed', async () => {
    const desktop = host([refused, answered])
    await open({ client: desktop.client, lastConnectedAt: 1 })
    await rerender({ client: desktop.client, lastConnectedAt: 1, visible: false })
    await rerender({ client: desktop.client, lastConnectedAt: 2, visible: false })
    await rerender({ client: desktop.client, lastConnectedAt: 2, visible: true })
    expect(desktop.reads()).toBe(2)
    expect(people()).toEqual(['Request alice', 'Request bob'])
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints Retry from the %s theme', async (scheme, palette) => {
    const desktop = host([refused])
    await open({ client: desktop.client, lastConnectedAt: 1, scheme })
    const button = retryButton()
    expect(button).toBeDefined()
    expect(styleOf(button!).backgroundColor).toBe(palette.bgRaised)
    const label = renderer!.root
      .findAll((node) => String(node.type) === 'Text' && node.props.children === 'Retry')
      .at(0)
    expect(label).toBeDefined()
    expect(styleOf(label!).color).toBe(palette.text)
    expect(renderer!.root.findByType('RotateCw' as never).props.color).toBe(palette.text)
    const reason = renderer!.root
      .findAll(
        (node) =>
          String(node.type) === 'Text' && node.props.children === 'GitHub did not answer in time'
      )
      .at(0)
    expect(styleOf(reason!).color).toBe(palette.textSecondary)
  })
})
