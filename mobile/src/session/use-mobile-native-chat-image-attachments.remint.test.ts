import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import {
  isMobileNativeChatTerminalWriteInFlight,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import {
  SEND_TERMINAL_RESTARTED,
  type MobileNativeChatSendFollow
} from './mobile-native-chat-send-follow'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'

const pick = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: pick }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

import {
  baseArgs,
  makeClient,
  methodNotFound,
  ok,
  SCOPE_A,
  sendResult,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'
import {
  deferred,
  settle
} from './use-mobile-native-chat-image-attachments.send-while-uploading.test-support'

// The desktop can give a tab a new terminal handle while a composer send waits (a
// chip's upload, the relay, its look at the screen): a PTY restart (a new PTY, whose
// screen is blank until the agent paints) or a renderer reload (Orca 1.4.178-rc.2,
// orca-runtime.ts markRendererReloading clears `handles`, so a synthetic handle is
// re-minted for the SAME live PTY). If the agent had exited, the new terminal can be
// a plain shell, and the message and its Enter would run there as a command. The
// send follows the tab only to a handle the host's snapshot names for it, and only
// on a screen that shows Claude's composer.

const SHELL = ['alwin@mac Code UI % ']
import {
  APPROVAL_0158,
  codexExitedToShell,
  WORKING_0158
} from './fixtures/codex-composer-screens'
const RULE = '─'.repeat(190)
// Claude Code 2.1.287's `!` bash-mode box: the rules without a `❯` row (modelled from
// the 2.1.287 binary's mode prefix, not captured), so readClaudeInput does not locate it.
const BASH_MODE_BOX = [RULE, '! ', RULE, '  ? for shortcuts']
// A Codex composer as the queue reader pins it (`› ` at column 0; codex-terminal-queued-messages.ts).
const CODEX_COMPOSER = ['• Working (3s • esc to interrupt)', '', '› ', '  gpt-5 high · ~/Project']

const read = (lines: string[]): RpcResponse => ({
  id: 'read',
  ok: true,
  result: { terminal: { lines, source: 'screen' } },
  _meta: { runtimeId: 'r' }
})

type Screens = Record<string, string[] | 'unreadable'>
type BaseSend = HookArgs['baseSend']

describe('a composer send when the tab is given a new terminal while it waits', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  beforeEach(() => {
    pick.mockReset()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  /** A desktop whose terminals show `screens`, taking every write, and whose uploads come from `saves`. */
  function setUp(
    screens: Screens,
    options: {
      agent?: string | null
      /** What each terminal's look at the screen does, by terminal. */
      onLook?: Record<string, () => void>
      saves?: (RpcResponse | Promise<RpcResponse>)[]
      start?: string | null
      baseSend?: BaseSend
      sleep?: () => Promise<void>
    } = {}
  ) {
    const activeHandleRef = { current: options.start === undefined ? 'term-1' : options.start }
    const saves = options.saves ?? [ok('save', '/tmp/a.png')]
    const host = makeClient((method, params) => {
      if (method === 'terminal.read') {
        const screen = screens[String(params.terminal)]
        if (!screen || screen === 'unreadable') {
          throw new Error('screen unreadable')
        }
        return read(screen)
      }
      if (method === 'terminal.send') {
        return sendResult(true)
      }
      if (method === 'clipboard.startImageUpload') {
        return methodNotFound('start')
      }
      if (method === 'clipboard.saveImageAsTempFile') {
        return saves.shift()!
      }
      throw new Error(`unexpected request: ${method}`)
    })
    const client = { ...host, getLastConnectedAt: () => 1 } as unknown as RpcClient
    const looks: string[] = []
    const lockWhileSending: Record<string, boolean>[] = []
    const baseSend =
      options.baseSend ??
      vi.fn<BaseSend>(async () => {
        lockWhileSending.push({
          'term-1': isMobileNativeChatTerminalWriteInFlight('term-1'),
          'term-2': isMobileNativeChatTerminalWriteInFlight('term-2')
        })
        return 'accepted' as const
      })
    const onSendError = vi.fn()
    const onError = vi.fn()
    const undo = vi.fn()
    const args = baseArgs({
      client,
      agent: options.agent === undefined ? 'claude' : options.agent,
      activeHandleRef,
      baseSend,
      onSendError,
      onError,
      beginImageSend: vi.fn(() => undo),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      // The host's snapshot names whatever terminal the tab has now (a reload or restart re-mint).
      hostTerminalOfTab: () => activeHandleRef.current,
      refuseUnderDialog: async ({ terminal }) => {
        looks.push(terminal)
        options.onLook?.[terminal]?.()
        return null
      }
    })
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
    const writes = (terminal: string): string[] =>
      host.calls
        .filter((call) => call.method === 'terminal.send' && call.params.terminal === terminal)
        .map((call) => String(call.params.text))
    const followOf = (call: number): MobileNativeChatSendFollow =>
      (baseSend as unknown as { mock: { calls: unknown[][] } }).mock.calls[
        call
      ]![4] as MobileNativeChatSendFollow
    return {
      args,
      host,
      activeHandleRef,
      looks,
      lockWhileSending,
      baseSend,
      onSendError,
      onError,
      undo,
      writes,
      followOf
    }
  }

  async function send(text: string): Promise<boolean> {
    let sent = true
    await act(async () => {
      sent = await hook!.sendNativeChat(text)
    })
    return sent
  }

  async function attachPhoto(): Promise<void> {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    await act(async () => {
      await hook!.attachImage('library')
    })
  }

  const chipsOfTabA = (): number =>
    useNativeChatImageAttachmentsStore.getState().byScope[SCOPE_A]?.length ?? 0

  it("follows the tab to its new terminal when that screen shows Claude's composer, locking the new one and freeing the old", async () => {
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER },
      { onLook: { 'term-1': () => void (t.activeHandleRef.current = 'term-2') } }
    )
    expect(await send('deploy the staging build')).toBe(true)
    expect(t.baseSend).toHaveBeenCalledTimes(1)
    expect(t.baseSend).toHaveBeenCalledWith(
      'deploy the staging build',
      undefined,
      expect.any(Number),
      undefined,
      expect.anything()
    )
    expect(t.followOf(0).terminal).toBe('term-2')
    // The look ran on the new terminal too, and the lock sat on it, not on the old one.
    expect(t.looks).toEqual(['term-1', 'term-2'])
    expect(t.lockWhileSending).toEqual([{ 'term-1': false, 'term-2': true }])
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(false)
    expect(isMobileNativeChatTerminalWriteInFlight('term-2')).toBe(false)
    expect(t.onSendError).not.toHaveBeenCalled()
  })

  it('follows a photo send to the new terminal and pastes it only there', async () => {
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER },
      { onLook: { 'term-1': () => void (t.activeHandleRef.current = 'term-2') } }
    )
    await attachPhoto()
    expect(await send('this one')).toBe(true)
    expect(t.writes('term-1')).toEqual([])
    expect(t.writes('term-2').length).toBeGreaterThan(0)
    expect(t.baseSend).toHaveBeenCalledTimes(1)
    expect(t.followOf(0).terminal).toBe('term-2')
    expect(chipsOfTabA()).toBe(0)
  })

  it.each([
    ['a plain shell prompt', { 'term-2': SHELL }],
    ['a screen with nothing on it', { 'term-2': [] }],
    ['one blank row', { 'term-2': [''] }],
    ["Claude's bash-mode box", { 'term-2': BASH_MODE_BOX }],
    ['a screen that cannot be read', { 'term-2': 'unreadable' as const }]
  ])('refuses, writing nothing, when the new terminal shows %s', async (_name, screens) => {
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER, ...screens },
      { onLook: { 'term-1': () => void (t.activeHandleRef.current = 'term-2') } }
    )
    expect(await send('rm -rf build')).toBe(false)
    expect(t.baseSend).not.toHaveBeenCalled()
    expect(t.writes('term-1')).toEqual([])
    expect(t.writes('term-2')).toEqual([])
    expect(t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
    expect(t.onError).toHaveBeenCalledOnce()
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(false)
    expect(isMobileNativeChatTerminalWriteInFlight('term-2')).toBe(false)
  })

  it('refuses a photo send into a shell, keeping the chip and writing nothing', async () => {
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER, 'term-2': SHELL },
      { onLook: { 'term-1': () => void (t.activeHandleRef.current = 'term-2') } }
    )
    await attachPhoto()
    expect(await send('this one')).toBe(false)
    expect(t.host.calls.filter((call) => call.method === 'terminal.send')).toEqual([])
    expect(t.baseSend).not.toHaveBeenCalled()
    expect(chipsOfTabA()).toBe(1)
    expect(t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })

  // Another agent, or none named: the phone cannot locate its composer on a screen,
  // so a follow never goes ahead, whatever the screen shows.
  it.each([
    ['another agent', 'omp'],
    ['an agent the tab does not name', null]
  ])("refuses even a composer-shaped screen when the tab's agent is %s", async (_name, agent) => {
    const t = setUp(
      { 'term-1': CODEX_COMPOSER, 'term-2': EMPTY_COMPOSER },
      { agent, onLook: { 'term-1': () => void (t.activeHandleRef.current = 'term-2') } }
    )
    expect(await send('hello')).toBe(false)
    expect(t.baseSend).not.toHaveBeenCalled()
    expect(t.writes('term-2')).toEqual([])
    expect(t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })

  // Codex: a `›` row alone proves nothing (a sent prompt, a popup row, an approval
  // option wear it), so the follow wants its footer under it too
  // (codexComposerLive; Codex 0.158.0 screens from fixtures/codex-composer-screens.ts).
  it.each([
    ['a Codex composer', WORKING_0158, true],
    ['a Claude composer, which is not Codex', EMPTY_COMPOSER, false],
    ['a shell under the old Codex frame (modelled)', codexExitedToShell(WORKING_0158, '66% '), false],
    ['a Codex approval', APPROVAL_0158, false]
  ])('for a Codex tab, a follow onto %s', async (_name, screen, follows) => {
    const t = setUp(
      { 'term-1': WORKING_0158, 'term-2': screen },
      { agent: 'codex', onLook: { 'term-1': () => void (t.activeHandleRef.current = 'term-2') } }
    )
    expect(await send('hello')).toBe(follows)
    expect(t.baseSend.mock.calls.length > 0).toBe(follows)
    expect(t.onSendError.mock.calls).toEqual(follows ? [] : [[SEND_TERMINAL_RESTARTED]])
  })

  it('refuses when the tab is given a terminal a second time, however it looks', async () => {
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER, 'term-3': EMPTY_COMPOSER },
      {
        onLook: {
          'term-1': () => void (t.activeHandleRef.current = 'term-2'),
          'term-2': () => void (t.activeHandleRef.current = 'term-3')
        }
      }
    )
    expect(await send('hello')).toBe(false)
    expect(t.looks).toEqual(['term-1', 'term-2'])
    expect(t.baseSend).not.toHaveBeenCalled()
    expect(t.host.calls.filter((call) => call.method === 'terminal.send')).toEqual([])
    expect(t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
    for (const terminal of ['term-1', 'term-2', 'term-3']) {
      expect(isMobileNativeChatTerminalWriteInFlight(terminal)).toBe(false)
    }
  })

  it('refuses when the tab loses its terminal during the look', async () => {
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER },
      { onLook: { 'term-1': () => void (t.activeHandleRef.current = null) } }
    )
    expect(await send('hello')).toBe(false)
    expect(t.baseSend).not.toHaveBeenCalled()
    expect(t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
    expect(isMobileNativeChatTerminalWriteInFlight('term-1')).toBe(false)
  })

  // Degenerate: a tab that had no terminal when the send was tapped and has one by
  // the time the send runs is a new terminal like any other, and shown the same way.
  it.each([
    ['a composer', EMPTY_COMPOSER, true],
    ['a shell', SHELL, false]
  ])(
    'follows a tab that had no terminal when tapped only onto %s',
    async (_name, screen, follows) => {
      const save = deferred()
      const t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': screen }, { saves: [save.promise] })
      pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
      let attach: Promise<void> = Promise.resolve()
      let sending: Promise<boolean> = Promise.resolve(false)
      await act(async () => {
        attach = hook!.attachImage('library')
        await settle()
        t.activeHandleRef.current = null
        sending = hook!.sendNativeChat('look')
        await settle()
      })
      t.activeHandleRef.current = 'term-2'
      let sent = false
      await act(async () => {
        save.resolve(ok('save', '/tmp/a.png'))
        await attach
        sent = await sending
      })
      expect(sent).toBe(follows)
      expect(t.writes('term-1')).toEqual([])
      expect(t.writes('term-2').length > 0).toBe(follows)
      expect(t.onSendError.mock.calls).toEqual(follows ? [] : [[SEND_TERMINAL_RESTARTED]])
    }
  )

  it('follows a terminal the tab was given while its photo was still uploading', async () => {
    const save = deferred()
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER },
      { saves: [save.promise] }
    )
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    let attach: Promise<void> = Promise.resolve()
    let sending: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      sending = hook!.sendNativeChat('look')
      await settle()
    })
    t.activeHandleRef.current = 'term-2'
    let sent = false
    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
      sent = await sending
    })
    expect(sent).toBe(true)
    expect(t.writes('term-1')).toEqual([])
    expect(t.writes('term-2').length).toBeGreaterThan(0)
    expect(t.followOf(0).terminal).toBe('term-2')
    expect(t.onSendError).not.toHaveBeenCalled()
  })

  it('refuses a terminal the tab was given while its photo uploaded, when that is a shell', async () => {
    const save = deferred()
    const t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': SHELL }, { saves: [save.promise] })
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    let attach: Promise<void> = Promise.resolve()
    let sending: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      attach = hook!.attachImage('library')
      await settle()
      sending = hook!.sendNativeChat('look')
      await settle()
    })
    t.activeHandleRef.current = 'term-2'
    let sent = true
    await act(async () => {
      save.resolve(ok('save', '/tmp/a.png'))
      await attach
      sent = await sending
    })
    expect(sent).toBe(false)
    expect(t.host.calls.filter((call) => call.method === 'terminal.send')).toEqual([])
    expect(chipsOfTabA()).toBe(1)
    expect(t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })

  // The message send's own wait: it reads the tab's handle when it starts, and says
  // so (follow.reminted) when the tab has another before it wrote a byte.
  it("follows a terminal the tab was given during the message send's own wait", async () => {
    let calls = 0
    const holder: { t?: ReturnType<typeof setUp> } = {}
    const baseSend = vi.fn<BaseSend>(async (_text, _images, _deadline, _attachments, follow) => {
      calls += 1
      if (calls === 1) {
        holder.t!.activeHandleRef.current = 'term-2'
        follow!.reminted = true
        return 'rejected' as const
      }
      return 'accepted' as const
    })
    holder.t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER }, { baseSend })
    expect(await send('hello')).toBe(true)
    expect(baseSend).toHaveBeenCalledTimes(2)
    expect(holder.t.followOf(0).terminal).toBe('term-1')
    expect(holder.t.followOf(1).terminal).toBe('term-2')
    expect(holder.t.looks).toEqual(['term-1', 'term-2'])
    expect(holder.t.onSendError).not.toHaveBeenCalled()
  })

  it("refuses a terminal the tab was given during the message send's wait, when that is a shell", async () => {
    const holder: { t?: ReturnType<typeof setUp> } = {}
    const baseSend = vi.fn<BaseSend>(async (_text, _images, _deadline, _attachments, follow) => {
      holder.t!.activeHandleRef.current = 'term-2'
      follow!.reminted = true
      return 'rejected' as const
    })
    holder.t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': SHELL }, { baseSend })
    expect(await send('hello')).toBe(false)
    expect(baseSend).toHaveBeenCalledTimes(1)
    expect(holder.t.writes('term-2')).toEqual([])
    expect(holder.t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })

  it("refuses a second change of terminal during the message send's wait, the retry's own", async () => {
    const holder: { t?: ReturnType<typeof setUp> } = {}
    let calls = 0
    const baseSend = vi.fn<BaseSend>(async (_text, _images, _deadline, _attachments, follow) => {
      calls += 1
      holder.t!.activeHandleRef.current = calls === 1 ? 'term-2' : 'term-3'
      follow!.reminted = true
      return 'rejected' as const
    })
    holder.t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER }, { baseSend })
    expect(await send('hello')).toBe(false)
    expect(baseSend).toHaveBeenCalledTimes(2)
    expect(holder.t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })

  // The paste has gone to the old terminal by now: refuse, put the chip and the box
  // back, and let the next send's leading clear sweep what landed there.
  it("refuses, keeping the chip, when the tab is given a terminal while its photo's paste settles", async () => {
    const t = setUp(
      { 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER },
      { sleep: async () => void (t.activeHandleRef.current = 'term-2') }
    )
    await attachPhoto()
    expect(await send('this one')).toBe(false)
    expect(t.baseSend).not.toHaveBeenCalled()
    expect(t.writes('term-2')).toEqual([])
    expect(t.undo).toHaveBeenCalledOnce()
    expect(chipsOfTabA()).toBe(1)
    expect(t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })

  it("refuses, keeping the chip, when the message send finds a new terminal after the photo's paste", async () => {
    const holder: { t?: ReturnType<typeof setUp> } = {}
    const baseSend = vi.fn<BaseSend>(async (_text, _images, _deadline, _attachments, follow) => {
      holder.t!.activeHandleRef.current = 'term-2'
      follow!.reminted = true
      return 'rejected' as const
    })
    holder.t = setUp({ 'term-1': EMPTY_COMPOSER, 'term-2': EMPTY_COMPOSER }, { baseSend })
    await attachPhoto()
    expect(await send('this one')).toBe(false)
    expect(baseSend).toHaveBeenCalledTimes(1)
    expect(holder.t.writes('term-2')).toEqual([])
    expect(chipsOfTabA()).toBe(1)
    expect(holder.t.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })
})
