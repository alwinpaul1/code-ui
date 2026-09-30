// An expanded commit in History whose file-list read failed or was refused.
//
// The failure was cached as `[]` and drawn as "No file changes", a false claim about the commit,
// with no error and no retry; and because a cached list is truthy, nothing read it again until
// the row was collapsed and re-expanded or the connection changed (reproduced on main 0b2c7a92).
// The read now leaves an error marker: "Couldn't load files" with Retry, one log line naming the
// cause, and a fresh read on the next connection. A commit that really has no files keeps "No file
// changes".

import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { MobileGitHistoryList } from './MobileGitHistoryList'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: ({
    data,
    renderItem
  }: {
    data: { id: string }[]
    renderItem: (info: { item: { id: string } }) => ReactElement
  }) =>
    createElement(
      'FlatList',
      null,
      data.map((item) => createElement('Row', { key: item.id }, renderItem({ item })))
    ),
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))
vi.mock('../transport/client-context', () => ({ useForceReconnect: () => () => Promise.resolve() }))

const HISTORY = {
  ok: true,
  result: {
    items: [
      { id: 'commit-1', displayId: 'c0mm1t1', subject: 'Fix it', author: 'Ada', parentIds: [] }
    ]
  }
}
const FILES = { ok: true, result: { entries: [{ path: 'src/app.ts', added: 3, removed: 1 }] } }
const NO_FILES = { ok: true, result: { entries: [] } }
const REFUSED = { ok: false, error: { code: 'runtime_error', message: 'bad object commit-1' } }

describe('an expanded commit whose file list could not be read', () => {
  let renderer: ReactTestRenderer | null = null
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockRestore()
  })

  function clientAnswering(compare: () => Promise<unknown>) {
    const sendRequest = vi.fn((method: string) =>
      method === 'git.history' ? Promise.resolve(HISTORY) : compare()
    )
    return { client: { sendRequest } as unknown as RpcClient, sendRequest }
  }

  function list(client: RpcClient | null, connState: ConnectionState, scheme: 'light' | 'dark') {
    return createElement(
      ThemeProvider,
      { initialPreference: scheme },
      createElement(MobileGitHistoryList, {
        client,
        connState,
        worktreeId: 'wt-1',
        hostId: 'host-1',
        bottomInset: 0
      })
    )
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve()
      }
    })
  }

  async function mountAndExpand(client: RpcClient, scheme: 'light' | 'dark' = 'light') {
    await act(async () => {
      renderer = create(list(client, 'connected', scheme))
    })
    await flush()
    const header = renderer!.root.findAll(
      (node) =>
        (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === undefined
    )[0]!
    await act(async () => {
      header.props.onPress()
    })
    await flush()
  }

  async function rerender(client: RpcClient | null, connState: ConnectionState) {
    await act(async () => {
      renderer?.update(list(client, connState, 'light'))
    })
    await flush()
  }

  function tree(): string {
    return JSON.stringify(renderer?.toJSON())
  }

  function retryFiles() {
    return renderer!.root.findAll(
      (node) =>
        (node.type as unknown) === 'Pressable' &&
        node.props.accessibilityLabel === 'Retry loading the files of this commit'
    )[0]
  }

  function compareCalls(sendRequest: ReturnType<typeof vi.fn>): number {
    return sendRequest.mock.calls.filter(([method]) => method === 'git.commitCompare').length
  }

  it('says the files could not be loaded, not "No file changes", when the read times out', async () => {
    const { client } = clientAnswering(() => Promise.reject(new Error('runtime_timeout')))
    await mountAndExpand(client)

    expect(tree()).not.toContain('No file changes')
    expect(tree()).toContain("Couldn't load files")
    expect(retryFiles()).toBeDefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('runtime_timeout')
  })

  it('says the files could not be loaded when the host refuses the read', async () => {
    const { client } = clientAnswering(() => Promise.resolve(REFUSED))
    await mountAndExpand(client)

    expect(tree()).not.toContain('No file changes')
    expect(tree()).toContain("Couldn't load files")
    expect(String(warn.mock.calls[0]?.[0])).toContain('bad object commit-1')
  })

  it('reads the files again on Retry and shows them', async () => {
    let fail = true
    const { client, sendRequest } = clientAnswering(() =>
      fail ? Promise.reject(new Error('runtime_timeout')) : Promise.resolve(FILES)
    )
    await mountAndExpand(client)
    fail = false
    await act(async () => {
      retryFiles()?.props.onPress()
    })
    await flush()

    expect(compareCalls(sendRequest)).toBe(2)
    expect(tree()).toContain('src/app.ts')
    expect(tree()).not.toContain("Couldn't load files")
  })

  it('reads the files again once on the next connection, and not while the host is down', async () => {
    let fail = true
    const { client, sendRequest } = clientAnswering(() =>
      fail ? Promise.reject(new Error('connection closed')) : Promise.resolve(FILES)
    )
    await mountAndExpand(client)
    // Renders on the same connection do not turn the failure into a loop.
    await rerender(client, 'connected')
    await rerender(client, 'reconnecting')
    await rerender(client, 'disconnected')
    expect(compareCalls(sendRequest)).toBe(1)
    expect(tree()).toContain("Couldn't load files")

    fail = false
    await rerender(client, 'connected')
    expect(compareCalls(sendRequest)).toBe(2)
    expect(tree()).toContain('src/app.ts')
  })

  it('still says "No file changes" for a commit that has none', async () => {
    const { client } = clientAnswering(() => Promise.resolve(NO_FILES))
    await mountAndExpand(client)

    expect(tree()).toContain('No file changes')
    expect(tree()).not.toContain("Couldn't load files")
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the failed read from the %s theme', async (scheme, palette) => {
    const { client } = clientAnswering(() => Promise.reject(new Error('runtime_timeout')))
    await mountAndExpand(client, scheme)

    const message = renderer!.root.findAll(
      (node) => (node.type as unknown) === 'Text' && node.props.children === "Couldn't load files"
    )[0]
    expect(message).toBeDefined()
    expect(message!.props.style.color).toBe(palette.textMuted)
    expect(retryFiles()!.props.style.backgroundColor).toBe(palette.bgRaised)
    const retryText = retryFiles()!.findAll(
      (node) => (node.type as unknown) === 'Text' && node.props.children === 'Retry'
    )[0]
    expect(retryText!.props.style.color).toBe(palette.text)
  })
})
