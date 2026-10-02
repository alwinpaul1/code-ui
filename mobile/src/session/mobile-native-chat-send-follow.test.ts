import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  AFTER_REVIEW_NOTICE,
  composerWithTextInDraft,
  composerWithTextInRows,
  EMPTY_COMPOSER
} from './fixtures/claude-composer-2.1.287'
import {
  NAMED_RULES,
  queuedScreen2_1_285,
  takenScreen2_1_285
} from './fixtures/claude-queued-named-rule-2.1.285'
import { agentComposerOnScreen, hostTerminalOfTab } from './mobile-native-chat-send-follow'
import type { MobileSessionTab } from './mobile-session-route-types'

// What proves a terminal the tab was given holds Claude's composer: the `❯` row
// between its two rules (readClaudeInput). The box shapes are Claude Code
// 2.1.287's and 2.1.285's (fixtures/): transcribed from Orca's history log and a
// live capture, the words replaced by stand-ins.

const RULE = '─'.repeat(190)

const answering = (lines: string[] | Error | 'not-a-screen') =>
  ({
    sendRequest: vi.fn(async () => {
      if (lines instanceof Error) {
        throw lines
      }
      return {
        id: 'read',
        ok: true,
        result:
          lines === 'not-a-screen'
            ? { terminal: { source: 'stream', lines: [] } }
            : { terminal: { lines, source: 'screen' } },
        _meta: { runtimeId: 'r' }
      }
    }),
    getState: () => 'connected'
  }) as never

describe('agentComposerOnScreen', () => {
  it.each([
    ['an empty box', EMPTY_COMPOSER],
    ['a box holding a typed message', composerWithTextInRows('look at the diff')],
    ['a box whose text Orca moved out into the draft', composerWithTextInDraft()],
    ['a box under the review notice', AFTER_REVIEW_NOTICE],
    [
      'a box under a named rule, with a queued message above it',
      queuedScreen2_1_285(NAMED_RULES.captured1152)
    ],
    [
      'a box under a named rule, once the queue is taken',
      takenScreen2_1_285(NAMED_RULES.captured1152)
    ]
  ])('is true for %s, reading the terminal asked about as a screen', async (_name, lines) => {
    const client = answering(lines)
    expect(await agentComposerOnScreen({ client, terminal: 'term-2', agent: 'claude' })).toBe(true)
    expect((client as { sendRequest: ReturnType<typeof vi.fn> }).sendRequest).toHaveBeenCalledWith(
      'terminal.read',
      expect.objectContaining({ terminal: 'term-2', screen: true }),
      expect.anything()
    )
  })

  // A new PTY's screen is blank until the agent paints (the runtime's emulator is per
  // PTY), and a plain shell has no box: no evidence in either.
  it.each([
    ['no rows at all (a PTY that has drawn nothing)', []],
    ['one blank row', ['']],
    ['a shell prompt', ['alwin@mac Code UI % ']],
    ['a lone rule', [RULE]],
    ['a bash-mode box, which has no `❯` row', [RULE, '! ', RULE, '  ? for shortcuts']],
    ['a menu Claude is asking, whose `❯ 1.` row is no input', [RULE, '❯ 1. Yes', '  2. No', RULE]],
    ['a box cut off before its bottom rule', [RULE, '❯ ']],
    ['an `❯` row with no rule above it', ['❯ ', RULE]],
    // A restored PTY's emulator is seeded with the old scrollback (new incarnation, new
    // handle): the old box with the new process's rows under it.
    ['the old box over a zsh prompt', [...EMPTY_COMPOSER, 'alwin@mac Code UI % ']],
    ['the old box over a bash prompt', [...EMPTY_COMPOSER, 'alwin@host:~$ ']],
    ['the old box over a `$ ` prompt', [...EMPTY_COMPOSER, '$ ']],
    ['the old box over a `> ` prompt', [...EMPTY_COMPOSER, '> ']],
    [
      'the old box over a restore banner at column 0',
      [...EMPTY_COMPOSER, 'Restored session 2026-10-01 14:02 · the previous process exited']
    ],
    [
      'the old box over a zsh prompt with an RPROMPT',
      [...EMPTY_COMPOSER, 'alwin@mac Code UI %                                          14:02:11']
    ],
    [
      'the old box over a prompt, with its own footer rows kept above',
      [...EMPTY_COMPOSER.slice(0, -1), 'alwin@mac ~ % ', EMPTY_COMPOSER.at(-1)!]
    ],
    // Every composer screen in fixtures/ has footer rows; a box with none is not shown to be whole.
    ['a box with nothing under it', EMPTY_COMPOSER.slice(0, -2)],
    ['a box with only blank rows under it', [...EMPTY_COMPOSER.slice(0, -2), '', '']]
  ])('is false for %s', async (_name, lines) => {
    expect(
      await agentComposerOnScreen({ client: answering(lines), terminal: 'term-2', agent: 'claude' })
    ).toBe(false)
  })

  it.each([
    [
      'a stream fallback an older host sends, which is old repaints and not the screen',
      answering('not-a-screen')
    ],
    ['a read that fails', answering(new Error('relay down'))]
  ])('is false for %s', async (_name, client) => {
    expect(await agentComposerOnScreen({ client, terminal: 'term-2', agent: 'claude' })).toBe(false)
  })

  // An agent whose composer the phone cannot locate: a send never follows its tab to a
  // new terminal, and the screen is not even read.
  it.each(['omp', null, undefined])(
    'is false for a composer-shaped screen when the agent is %s, without reading it',
    async (agent) => {
      const client = answering(EMPTY_COMPOSER)
      expect(await agentComposerOnScreen({ client, terminal: 'term-2', agent })).toBe(false)
      expect(
        (client as { sendRequest: ReturnType<typeof vi.fn> }).sendRequest
      ).not.toHaveBeenCalled()
    }
  )

  // Codex draws its input with `›`, and so does a sent prompt, a popup's selected row and an
  // approval's selected option (codex-terminal-queued-messages.ts): its footer under that row
  // is the proof (codexComposerLive), so a Claude composer is not it.
  it('reads the screen for Codex, and a Claude composer is not Codex\'s', async () => {
    const client = answering(EMPTY_COMPOSER)
    expect(await agentComposerOnScreen({ client, terminal: 'term-2', agent: 'codex' })).toBe(false)
    expect(
      (client as { sendRequest: ReturnType<typeof vi.fn> }).sendRequest
    ).toHaveBeenCalledTimes(1)
  })
})

describe('the captured Claude screens under fixtures/', () => {
  const dir = new URL('./fixtures/', import.meta.url)
  const screens = readdirSync(fileURLToPath(dir))
    .filter((name) => name.startsWith('claude-screen-') && name.endsWith('.txt'))
    .map((name) => {
      const rows = readFileSync(new URL(name, dir), 'utf8').split('\n')
      return [
        name,
        rows.slice(rows.findIndex((row) => /^=== screen: .* ===$/.test(row)) + 1)
      ] as const
    })

  // Claude Code 2.1.278 to 2.1.283: every row under the box is indented two spaces.
  it.each(screens.filter(([name]) => !name.includes('permission')))(
    'follows %s',
    async (_name, lines) => {
      expect(
        await agentComposerOnScreen({
          client: answering([...lines]),
          terminal: 'term-2',
          agent: 'claude'
        })
      ).toBe(true)
    }
  )

  it('refuses the subagent permission dialog, which has no box', async () => {
    const [, lines] = screens.find(([name]) => name.includes('permission'))!
    expect(
      await agentComposerOnScreen({
        client: answering([...lines]),
        terminal: 'term-2',
        agent: 'claude'
      })
    ).toBe(false)
  })
})

describe('hostTerminalOfTab', () => {
  const tab = (id: string, terminal: string | null): MobileSessionTab =>
    ({ type: 'terminal', id, title: id, terminal, isActive: false }) as MobileSessionTab
  const scope = (id: string): string => `h\0w\0${id}`

  it('names the terminal the host snapshot gives the tab with that scope key', () => {
    const tabs = [tab('a', 'term-1'), tab('b', 'term-2')]
    expect(hostTerminalOfTab(tabs, 'h', 'w', scope('b'))).toBe('term-2')
  })

  it.each([
    ['a tab the snapshot does not have (closed)', [tab('a', 'term-1')], scope('b')],
    ['a tab whose handle the host has not named yet', [tab('b', null)], scope('b')],
    ['no tabs at all', [], scope('b')],
    [
      'a session tab, which has no terminal',
      [{ type: 'agent-session', id: 'b' } as MobileSessionTab],
      scope('b')
    ],
    ["another worktree's scope", [tab('b', 'term-2')], 'h\0other\0b']
  ])('is null for %s', (_name, tabs, scopeKey) => {
    expect(hostTerminalOfTab(tabs, 'h', 'w', scopeKey)).toBeNull()
  })
})
