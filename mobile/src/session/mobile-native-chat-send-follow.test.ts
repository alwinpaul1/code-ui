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
import {
  agentComposerOnScreen,
  claudeComposerIsLastOnScreen
} from './mobile-native-chat-send-follow'

// What proves a terminal the tab was given holds Claude's composer: the `❯` row
// between its two rules, and nothing under the box that reads as a shell's prompt.
// The box shapes are Claude Code 2.1.287's (fixtures/claude-composer-2.1.287.ts:
// transcribed from Orca's history log, the words replaced by stand-ins).

const RULE = '─'.repeat(190)

describe('claudeComposerIsLastOnScreen', () => {
  it.each([
    ['an empty box', EMPTY_COMPOSER],
    ['a box holding a typed message', composerWithTextInRows('look at the diff')],
    ['a box whose text Orca moved out into the draft', composerWithTextInDraft()],
    ['a box under the review notice', AFTER_REVIEW_NOTICE],
    ['a box whose status row under it ends in a percentage', [...EMPTY_COMPOSER, '  Context 16%']],
    // Claude Code 2.1.285: the session's name on the rule above the box, status rows under it.
    ['a box under a named rule, with a queued message above it', queuedScreen2_1_285(NAMED_RULES.captured1152)],
    ['a box under a named rule, once the queue is taken', takenScreen2_1_285(NAMED_RULES.captured1152)],
    // Modelled: the label on the bottom rule as readClaudeInput's rule test allows.
    ['a box whose bottom rule carries a label', [...EMPTY_COMPOSER.slice(0, -3), NAMED_RULES.captured1152, ...EMPTY_COMPOSER.slice(-2)]]
  ])('is true for %s', (_name, lines) => {
    expect(claudeComposerIsLastOnScreen(lines)).toBe(true)
  })

  it.each([
    ['no rows at all', []],
    ['one blank row', ['']],
    ['a lone rule', [RULE]],
    ['a shell prompt', ['alwin@mac Code UI % ']],
    ['a shell prompt under a `$`', ['~/proj (main) $ ']],
    ['a bash-mode box, which has no `❯` row', [RULE, '! ', RULE, '  ? for shortcuts']],
    ['a menu Claude is asking, whose `❯ 1.` row is no input', [RULE, '❯ 1. Yes', '  2. No', RULE]],
    ['a box cut off before its bottom rule', [RULE, '❯ ']],
    ['an `❯` row with no rule above it', ['❯ ', RULE]],
    [
      'the box Claude left behind, with a `%` shell prompt under it',
      [...EMPTY_COMPOSER, 'alwin@mac Code UI % ']
    ],
    [
      'the box Claude left behind, with a `$` shell prompt under it',
      [...EMPTY_COMPOSER, 'alwin@host:~$ ']
    ],
    ['the box Claude left behind, with a `❯` prompt under it', [...EMPTY_COMPOSER, '❯ ']]
  ])('is false for %s', (_name, lines) => {
    expect(claudeComposerIsLastOnScreen(lines)).toBe(false)
  })
})

describe('agentComposerOnScreen', () => {
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

  it("reads the terminal asked about, as a screen read, and is true for Claude's box", async () => {
    const client = answering(EMPTY_COMPOSER)
    expect(await agentComposerOnScreen({ client, terminal: 'term-2', agent: 'claude' })).toBe(true)
    expect((client as { sendRequest: ReturnType<typeof vi.fn> }).sendRequest).toHaveBeenCalledWith(
      'terminal.read',
      expect.objectContaining({ terminal: 'term-2', screen: true }),
      expect.anything()
    )
  })

  it.each([
    ['a shell', answering(['alwin@mac Code UI % '])],
    [
      'a stream fallback an older host sends, which is old repaints and not the screen',
      answering('not-a-screen')
    ],
    ['a read that fails', answering(new Error('relay down'))]
  ])('is false for %s', async (_name, client) => {
    expect(await agentComposerOnScreen({ client, terminal: 'term-2', agent: 'claude' })).toBe(false)
  })

  // Codex draws its input with `›`, and so does a sent prompt, a popup's selected row
  // and an approval's selected option (codex-terminal-queued-messages.ts): no screen
  // proves its composer is up, so a send never follows a Codex tab to a new terminal.
  it.each(['codex', 'omp', null, undefined])(
    'is false for a composer-shaped screen when the agent is %s',
    async (agent) => {
      const client = answering(EMPTY_COMPOSER)
      expect(await agentComposerOnScreen({ client, terminal: 'term-2', agent })).toBe(false)
      expect(
        (client as { sendRequest: ReturnType<typeof vi.fn> }).sendRequest
      ).not.toHaveBeenCalled()
    }
  )
})
