import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { readSendUnderDialogRefusal, SEND_UNDER_DIALOG_REFUSAL } from './mobile-native-chat-dialog-guard'
import { recallNativeQueue, type QueueEditorAgent, type QueueScreen } from './native-queue-editor'

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
  sendResult,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

/** The screen rows under the fixture's `=== screen: … ===` marker. */
function readScreen(name: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  return rows.slice(rows.findIndex((row) => /^=== screen: .* ===$/.test(row)) + 1)
}

// Claude Code 2.1.283, 2026-09-27: a subagent's Bash prompt with "Yes"
// highlighted. A message sent meanwhile would type into it, and its Enter
// would approve the command.
const SUBAGENT_PROMPT = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')
const DIALOG_AT = SUBAGENT_PROMPT.findIndex((row) => row.startsWith('─'))
/** The same moment with the dialog gone: the lead's last message and its prompt. */
const NO_DIALOG = [...SUBAGENT_PROMPT.slice(0, DIALOG_AT), '─'.repeat(99), '❯ ', '─'.repeat(99)]
// An Edit approval as the options test pins its rows: no screen reader takes
// it (its card comes from the hook), and its Enter answers it all the same.
const EDIT_PROMPT = [
  ...NO_DIALOG.slice(0, DIALOG_AT),
  ' Do you want to make this edit to about.tsx?',
  ' ❯ 1. Yes',
  '   2. Yes, allow all edits during this session (shift+tab)',
  '   3. No, and tell Claude what to do differently (esc)'
]
// Claude Code 2.1.276's plan review, a tmux capture
// (mobile-native-chat-permission-send.test.ts): its third choice is no "No",
// and an Enter approves the plan in auto mode.
const PLAN_REVIEW = [
  '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '   ❯ 1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '     3. Tell Claude what to change',
  '        shift+tab to approve with this feedback',
  '',
  '   ctrl+g to edit in VS Code · ~/.claude/plans/write-a-one-sentence-plan-expressive-possum.md'
]
// A Codex approval as the phone saw it (codex-terminal-permission.test.ts).
const CODEX_PROMPT = [
  'Would you like to run the following command?',
  '',
  '  $ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
  '  3. No, and tell Codex what to do differently (esc)',
  '',
  'Press enter to confirm or esc to cancel'
]

const read = (lines: string[], source = 'screen'): RpcResponse => ({
  id: 'read',
  ok: true,
  result: { terminal: { lines, source } },
  _meta: { runtimeId: 'r' }
})

describe('a message sent from the chat while a prompt waits on screen', () => {
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

  function setUp(screen: () => RpcResponse | Promise<RpcResponse>, overrides: Partial<HookArgs> = {}) {
    const attach = [methodNotFound('start'), ok('save', '/tmp/a.png')]
    const client = makeClient((method) =>
      method === 'terminal.read' ? screen() : method === 'terminal.send' ? sendResult(true) : attach.shift()!
    )
    const args = baseArgs({
      client: client as unknown as RpcClient,
      refuseUnderDialog: readSendUnderDialogRefusal,
      ...overrides
    })
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
    return { client, args }
  }

  it.each([
    ['the subagent Bash prompt', SUBAGENT_PROMPT],
    ['an Edit prompt no screen reader takes', EDIT_PROMPT],
    ['a plan review', PLAN_REVIEW],
    ['a Codex command approval', CODEX_PROMPT]
  ])('is refused, and keeps its draft, while %s is up', async (_name, lines) => {
    const { client, args } = setUp(() => read(lines))
    let sent: boolean | undefined
    await act(async () => {
      sent = await hook!.sendNativeChat('1 more thing: push it after')
    })
    expect(sent).toBe(false)
    expect(args.baseSend).not.toHaveBeenCalled()
    expect(client.calls.some((call) => call.method === 'terminal.send')).toBe(false)
    expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_UNDER_DIALOG_REFUSAL)
  })

  it('refuses a photo too, before its paste, and keeps the chip', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const beginImageSend = vi.fn(() => vi.fn())
    const { client, args } = setUp(() => read(SUBAGENT_PROMPT), { beginImageSend })
    await act(async () => {
      await hook!.attachImage('library')
    })
    expect(hook!.attachments).toHaveLength(1)
    await act(async () => {
      await hook!.sendNativeChat('see this')
    })
    expect(client.calls.some((call) => call.method === 'terminal.send')).toBe(false)
    expect(beginImageSend).not.toHaveBeenCalled()
    expect(args.baseSend).not.toHaveBeenCalled()
    expect(hook!.attachments).toHaveLength(1)
  })

  it('goes as before once the prompt has left the screen', async () => {
    const { args } = setUp(() => read(NO_DIALOG))
    await act(async () => {
      await hook!.sendNativeChat('push it')
    })
    expect(args.baseSend).toHaveBeenCalledWith('push it', undefined, expect.any(Number))
    expect(args.onSendError).not.toHaveBeenCalled()
  })

  // A numbered Yes/No list in the conversation is not a dialog: nothing on it
  // is selected.
  it('goes past a numbered Yes/No list in the conversation', async () => {
    const list = [...NO_DIALOG.slice(0, DIALOG_AT), '  1. Yes, merge it', '  2. No, keep the branch', ...NO_DIALOG.slice(DIALOG_AT)]
    const { args } = setUp(() => read(list))
    await act(async () => {
      await hook!.sendNativeChat('merge it')
    })
    expect(args.baseSend).toHaveBeenCalledTimes(1)
  })

  // Fails open: the look is new, and a send that cannot take it goes as every
  // send went before it.
  it.each([
    ['a rejected read', () => Promise.reject(new Error('Connection closed'))],
    ['a failed read', () => methodNotFound('read')],
    ['a stream fallback', () => read(SUBAGENT_PROMPT, 'stream')]
  ])('goes as before after %s', async (_name, screen) => {
    const { args } = setUp(screen as () => RpcResponse | Promise<RpcResponse>)
    await act(async () => {
      await hook!.sendNativeChat('push it')
    })
    expect(args.baseSend).toHaveBeenCalledTimes(1)
  })

  it('does not look on a structured session, which has no terminal dialog', async () => {
    const { client, args } = setUp(() => read(SUBAGENT_PROMPT), { structuredNativeChat: true })
    await act(async () => {
      await hook!.sendNativeChat('push it')
    })
    expect(client.calls.some((call) => call.method === 'terminal.read')).toBe(false)
    expect(args.baseSend).toHaveBeenCalledTimes(1)
  })
})

describe('a queue edit while a prompt waits on screen', () => {
  const screen = (lines: string[]): QueueScreen => ({ source: 'screen', draft: '', lines })

  it.each([
    ['claude', 'the subagent Bash prompt', SUBAGENT_PROMPT],
    ['claude', 'an Edit prompt no screen reader takes', EDIT_PROMPT],
    ['claude', 'a plan review', PLAN_REVIEW],
    ['codex', 'a Codex command approval', CODEX_PROMPT]
  ] as [QueueEditorAgent, string, string[]][])(
    'writes nothing into a %s dialog: %s',
    async (agent, _name, lines) => {
      const write = vi.fn()
      await expect(
        recallNativeQueue({ read: async () => screen(lines), write, pause: async () => {} }, agent)
      ).rejects.toThrow('unavailable')
      expect(write).not.toHaveBeenCalled()
    }
  )
})
