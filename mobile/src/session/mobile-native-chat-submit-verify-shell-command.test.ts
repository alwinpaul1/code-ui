// A confirmed `!` message is a shell command, and Claude does not draw it the way it draws a
// prompt. Claude Code 2.1.287 (read from the binary, MODELLED here: no bash-mode run was
// captured and nothing was typed):
//  - while it is in the input the box row is `!` and a no-break space, then the command with
//    the `!` stripped (`qw`, `gP`/`Hv`: claude-composer-bash-mode.test.ts);
//  - once submitted it is drawn in the conversation by `pnt` as a column-0 row, `! ` (a plain
//    space, `bashBorder`) and the command, and stored as `<bash-input>cmd</bash-input>`;
//  - the prompt hook does not fire for it, so there is no beacon copy to wait for.
// verifyClaudeSubmit used to compare the words of `!ls` against an input that holds `ls` and
// a `❯` echo row that never appears, so every confirmed run ended 'unknown' and the chat said
// "Delivery unconfirmed — check chat before retrying", where a retry would run it twice.

import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { claudeSentBashRows } from './claude-composer-screen'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import { verifyClaudeSubmit } from './mobile-native-chat-submit-verify'

const RULE = '─'.repeat(190)
const bashBox = (command: string): string[] => ['⏺ Done.', RULE, `! ${command}`, RULE, '  ! for bash mode']
const withBashEcho = (command: string): string[] => [`! ${command}`, ...EMPTY_COMPOSER]

type Look = { lines: string[] } | 'fail'
function scene(looks: readonly Look[]) {
  let now = 0
  let index = 0
  const sendRequest = vi.fn(async () => {
    const look = looks[Math.min(index, looks.length - 1)]!
    index += 1
    if (look === 'fail') {
      throw new Error('Request timed out')
    }
    return { id: 'r', ok: true, result: { terminal: { source: 'screen', tail: look.lines, draft: '' } } }
  })
  return {
    client: { sendRequest } as unknown as RpcClient,
    wait: async (ms: number) => {
      now += ms
    },
    clock: () => now
  }
}
const verify = (s: ReturnType<typeof scene>, text: string) =>
  verifyClaudeSubmit({
    client: s.client,
    terminal: 'term',
    text,
    seenNonces: new Set(),
    wait: s.wait,
    now: s.clock
  })

describe('reading the shell command Claude drew in the conversation', () => {
  it('reads a column-0 `! cmd` row above the composer', () => {
    expect(claudeSentBashRows(withBashEcho('ls -la'))).toEqual(['ls -la'])
  })

  it('does not read the bash box itself, a quoted row, or a prompt row', () => {
    expect(claudeSentBashRows(bashBox('ls'))).toEqual([])
    expect(claudeSentBashRows(['  ! ls', ...EMPTY_COMPOSER])).toEqual([])
    expect(claudeSentBashRows(['❯ ls', ...EMPTY_COMPOSER])).toEqual([])
  })

  it('reads nothing with no composer on the screen, and from an empty one', () => {
    expect(claudeSentBashRows([])).toEqual([])
    expect(claudeSentBashRows(['! ls'])).toEqual([])
  })
})

describe('checking that Claude ran a confirmed `!` message', () => {
  it('says sent once the command is drawn in the conversation', async () => {
    const s = scene([{ lines: withBashEcho('ls -la') }])
    expect(await verify(s, '!ls -la')).toEqual({ kind: 'sent' })
  })

  it('says sent when the command was seen in the bash box and the box is empty after', async () => {
    const s = scene([{ lines: bashBox('ls -la') }, { lines: EMPTY_COMPOSER }])
    expect(await verify(s, '! ls -la')).toEqual({ kind: 'sent' })
  })

  it('compares the command with the `!` and its space taken off, as Claude draws it', async () => {
    const s = scene([{ lines: withBashEcho('git status') }])
    expect(await verify(s, '! git status')).toEqual({ kind: 'sent' })
  })

  it('also says sent when bash mode did not engage and the text went as a prompt', async () => {
    const s = scene([{ lines: [`❯ !ls -la`, ...EMPTY_COMPOSER] }])
    expect(await verify(s, '!ls -la')).toEqual({ kind: 'sent' })
  })

  it('does not take another command in the conversation for this one', async () => {
    const s = scene([{ lines: withBashEcho('pwd') }])
    expect((await verify(s, '!ls -la')).kind).toBe('unknown')
  })

  it('says unverified when no look could be had, as every send does', async () => {
    const s = scene(['fail'])
    expect((await verify(s, '!ls')).kind).toBe('unverified')
  })
})
