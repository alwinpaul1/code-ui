// A screenshot pasted off the clipboard is a FILE chip ('Pasted image', mobile-image-source-picker.ts
// pickFromClipboard): its path rides in the words, so it leaves the composer with them and comes
// back only when they do (2026-10-10, 0.9.127: the chip sat under a sent bubble). These pin the
// edges of that take-and-restore in the text-only branch of sendNativeChat: a terminal remint, a
// held ('unknown') send, a chip added meanwhile, and a send that throws. The Opus review of
// the fix found the throw case lost the chip; it is restored before the rejection now.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({ pickMobileDocuments: vi.fn(), pickMobileImageFiles: vi.fn() }))
vi.mock('expo-clipboard', () => ({ hasImageAsync: vi.fn(async () => false), getImageAsync: vi.fn(async () => null), setStringAsync: vi.fn() }))

import { baseArgs, makeClient, SCOPE_A, sendResult, type Hook, type HookArgs } from './use-mobile-native-chat-image-attachments.test-support'

const SHELL = ['alwin@mac Code UI % ']
type BaseSend = HookArgs['baseSend']
const FILE: PendingNativeChatImage = { id: 'f1', path: '/tmp/shot.png', previewUri: 'file:///shot.png', kind: 'file', name: 'Pasted image' }
const read = (lines: string[]): RpcResponse => ({ id: 'read', ok: true, result: { terminal: { lines, source: 'screen' } }, _meta: { runtimeId: 'r' } })

describe('a pasted screenshot leaves the composer with its words, and comes back only with them', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null
  function Harness({ args }: { args: HookArgs }): null { hook = useMobileNativeChatImageAttachments(args); return null }
  beforeEach(() => {
    resetMobileNativeChatStaleInputForTests(); resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
    useNativeChatImageAttachmentsStore.getState().update(() => ({ [SCOPE_A]: [FILE] }))
  })
  afterEach(() => { act(() => renderer?.unmount()); renderer = null; hook = null })
  const chips = (): string[] => (useNativeChatImageAttachmentsStore.getState().byScope[SCOPE_A] ?? []).map((c) => c.id)

  function setUp(screens: Record<string, string[]>, baseSend: BaseSend) {
    const activeHandleRef = { current: 'term-1' as string | null }
    const host = makeClient((method, params) => {
      if (method === 'terminal.read') { return read(screens[String(params.terminal)]!) }
      if (method === 'terminal.send') { return sendResult(true) }
      throw new Error(`unexpected ${method}`)
    })
    const client = { ...host, getLastConnectedAt: () => 1 } as unknown as RpcClient
    const onSendError = vi.fn()
    const args = baseArgs({ client, activeHandleRef, baseSend, onSendError, hostTerminalOfTab: () => activeHandleRef.current })
    act(() => { renderer = create(createElement(Harness, { args })) })
    return { activeHandleRef, onSendError }
  }
  async function send(text: string): Promise<unknown> {
    let r: unknown
    await act(async () => { try { r = await hook!.sendNativeChat(text) } catch (e) { r = e } })
    return r
  }

  it('keeps the screenshot out through a send that follows the tab to a new terminal and lands', async () => {
    const during: string[][] = []
    const h: { t?: ReturnType<typeof setUp> } = {}
    let calls = 0
    const baseSend = vi.fn<BaseSend>(async (_t, _i, _d, _a, follow) => {
      during.push(chips()); calls += 1
      if (calls === 1) { h.t!.activeHandleRef.current = 'term-2'; follow!.reminted = true; return 'rejected' }
      return 'accepted'
    })
    h.t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER }, baseSend)
    expect(await send('hi')).toBe(true)
    expect(during).toEqual([[], []])
    expect(chips()).toEqual([])
  })

  it('puts the screenshot back once when the new terminal is a shell and the send is refused', async () => {
    const h: { t?: ReturnType<typeof setUp> } = {}
    const baseSend = vi.fn<BaseSend>(async (_t, _i, _d, _a, follow) => { h.t!.activeHandleRef.current = 'term-2'; follow!.reminted = true; return 'rejected' })
    h.t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': SHELL }, baseSend)
    expect(await send('hi')).toBe(false)
    expect(chips()).toEqual(['f1'])
  })

  it('puts the screenshot back once when the terminal changes twice and the send gives up', async () => {
    const h: { t?: ReturnType<typeof setUp> } = {}
    let calls = 0
    const baseSend = vi.fn<BaseSend>(async (_t, _i, _d, _a, follow) => { calls += 1; h.t!.activeHandleRef.current = calls === 1 ? 'term-2' : 'term-3'; follow!.reminted = true; return 'rejected' })
    h.t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER, 'term-3': EMPTY_COMPOSER }, baseSend)
    expect(await send('hi')).toBe(false)
    expect(chips()).toEqual(['f1'])
  })

  it("keeps the screenshot out while a send whose answer was lost is held", async () => {
    setUp({ 'term-1': EMPTY_COMPOSER }, vi.fn<BaseSend>(async () => 'unknown'))
    expect(await send('hi')).toBe(true)
    expect(chips()).toEqual([])
  })

  it('keeps a chip added during a refused send, with the screenshot back in front and no duplicate', async () => {
    const baseSend = vi.fn<BaseSend>(async () => {
      useNativeChatImageAttachmentsStore.getState().update((p) => ({ ...p, [SCOPE_A]: [...(p[SCOPE_A] ?? []), { ...FILE, id: 'f2' }] }))
      return 'rejected'
    })
    setUp({ 'term-1': EMPTY_COMPOSER }, baseSend)
    expect(await send('hi')).toBe(false)
    expect(chips()).toEqual(['f1', 'f2'])
  })

  it('puts the screenshot back when the send throws, and still rejects', async () => {
    setUp({ 'term-1': EMPTY_COMPOSER }, vi.fn<BaseSend>(async () => { throw new Error('rpc boom') }))
    const r = await send('hi')
    expect(r).toBeInstanceOf(Error)
    expect(chips()).toEqual(['f1'])
  })
})
