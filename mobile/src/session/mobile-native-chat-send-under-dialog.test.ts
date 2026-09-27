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
  SCOPE_A,
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
// (A transcription of the user's screenshot, not a tmux capture; see the
// fixture's header for the bytes it cannot vouch for.)
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

  // 2026-09-27 merge: a video's frames are read ahead of any chip, so a send
  // tapped mid-read waits on the store's own extraction slice
  // (use-mobile-native-chat-send-chips.ts), not on a chip. That wait must
  // finish BEFORE the dialog look, not instead of it — the screen can change
  // while the phone is busy reading frames, and the look has to be fresh.
  it('waits for a video\'s frames, then is refused if a dialog is up by the time it looks, keeping the frames and the draft', async () => {
    const { client, args } = setUp(() => read(SUBAGENT_PROMPT))
    // One frame already landed; the group is still being read.
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({
      ...prev,
      [SCOPE_A]: [
        {
          id: 'img-1',
          path: '/tmp/f1.png',
          previewUri: 'data:image/jpeg;base64,p1',
          // The same batch the extraction record below names: this is what
          // ties this already-landed chip to the read still in progress, so
          // the send recognizes it has a stake in waiting for it
          // (2026-09-27 review — settleMobileNativeChatSendChips's
          // readingBatch gate reads `chip.batch`, not `chip.videoFrame`).
          batch: 'batch-1',
          videoFrame: {
            groupId: 'g1',
            index: 1,
            total: 2,
            sourceName: 'clip.mp4',
            durationLabel: '2 s',
            intervalLabel: 'every 1 s',
            intervalMs: 1000,
            sourceSizeLabel: '30 MB',
            stoppedEarly: false
          }
        }
      ]
    }))
    useNativeChatImageAttachmentsStore
      .getState()
      .updateVideoFrameExtraction((prev) => ({ ...prev, [SCOPE_A]: { batch: 'batch-1', done: 1, total: 2 } }))

    let sending: Promise<boolean> = Promise.resolve(true)
    act(() => {
      sending = hook!.sendNativeChat('look at these')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // Still reading: the send has not looked at the screen yet.
    expect(client.calls.some((call) => call.method === 'terminal.read')).toBe(false)

    // Reading finishes — the dialog (already on screen, per setUp) is what
    // the send's look now finds, since the look only happens once this clears.
    act(() => {
      useNativeChatImageAttachmentsStore.getState().updateVideoFrameExtraction((prev) => {
        const next = { ...prev }
        delete next[SCOPE_A]
        return next
      })
    })
    let accepted = true
    await act(async () => {
      accepted = await sending
    })

    expect(accepted).toBe(false)
    expect(args.onSendError).toHaveBeenCalledExactlyOnceWith(SEND_UNDER_DIALOG_REFUSAL)
    expect(args.baseSend).not.toHaveBeenCalled()
    expect(client.calls.some((call) => call.method === 'terminal.send')).toBe(false)
    // The frame and the draft (never cleared, since sendNativeChat returned
    // false before reaching clearSent()) are both still there for a retry.
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

  // A draft the mirror typed into Codex's composer, answering by number, is
  // the chat's own text, not a dialog: before 2026-09-27's review it could
  // never be sent.
  it('lets the chat send its own draft once the mirror typed it into Codex', async () => {
    const draft = '1. Yes, use postgres\n2. No caching for now'
    const { args } = setUp(() =>
      read(['• ok', '› 1. Yes, use postgres', '  2. No caching for now', '  gpt-5.6-sol xhigh · ~/Project'])
    )
    await act(async () => {
      await hook!.sendNativeChat(draft)
    })
    expect(args.baseSend).toHaveBeenCalledWith(draft, undefined, expect.any(Number))
    expect(args.onSendError).not.toHaveBeenCalled()
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
  const screen = (lines: string[], draft = ''): QueueScreen => ({ source: 'screen', draft, lines })

  // Alt+Up has already taken the message out of Codex's queue when the screen
  // is read again; a refusal there left it unsent in the desktop input.
  it('recalls a queued Codex message that answers by number', async () => {
    const text = '1. Yes, use postgres\n2. No caching for now'
    const reads = [
      screen([
        '• Queued follow-up inputs',
        '  ↳ 1. Yes, use postgres',
        '    ⌥ + ↑ edit last queued message',
        '',
        '› Ask Codex to do anything',
        '  gpt-5.6-sol xhigh · ~/Project'
      ]),
      screen(['› 1. Yes, use postgres', '  2. No caching for now', '  gpt-5.6-sol xhigh · ~/Project'], text)
    ]
    const write = vi.fn()
    const edit = await recallNativeQueue(
      { read: async () => reads.shift() ?? reads[0]!, write, pause: async () => {} },
      'codex'
    )
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[1;3A')
    expect(edit.text).toBe(text)
  })

  // A real prompt that comes up once the recall key is out cannot be typed
  // past, and nothing can put the message back through it. Whether the recall
  // landed first is unknown, so say both places the message may be.
  it('says where the recalled message is when a prompt comes up after the recall', async () => {
    const reads = [
      screen(['• Queued follow-up inputs', '  ↳ push it', '    ⌥ + ↑ edit last queued message', '', '› Ask Codex to do anything']),
      screen(CODEX_PROMPT)
    ]
    const write = vi.fn()
    await expect(
      recallNativeQueue({ read: async () => reads.shift() ?? reads[0]!, write, pause: async () => {} }, 'codex')
    ).rejects.toThrow('A prompt came up on the desktop. The message may be in the agent input or still queued.')
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[1;3A')
  })

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
