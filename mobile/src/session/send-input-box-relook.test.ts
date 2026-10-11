// Reported 2026-10-11, twice in a row: "Claude's input box isn't on the desktop screen, so the
// message was not typed." on a hand-started Claude Code 2.1.296 tab, idle between turns and while
// working, with 6 to 7 background agents and 5 shells in its footer. The message never reached
// Claude, and the phone's log said nothing about it.
//
// The real screen of that tab (fixtures/claude-idle-background-agents-2.1.296.ts) passes the
// detector, and 80 reads of it in a row all passed. What changes from read to read is the frame
// itself: with background agents Claude repaints its bottom area every second (their timers tick),
// and Orca's headless screen can be read between the erase and the redraw, with the box's rows
// blank. One such read was enough to refuse. A shell, transcript mode or bash mode stays that way;
// a repaint does not, so the box is looked for again before the send is refused, and a refusal
// leaves one log line that says what the screen showed.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { CLAUDE_2_1_296_IDLE_BACKGROUND_AGENTS as IDLE } from './fixtures/claude-idle-background-agents-2.1.296'
import { claudeExitedToShell, SHELL_PROMPTS } from './fixtures/claude-exited-to-shell-2.1.287'
import { readSendUnderDialogRefusal, SEND_WITHOUT_COMPOSER_REFUSAL } from './mobile-native-chat-dialog-guard'
import { makeClient } from './use-mobile-native-chat-image-attachments.test-support'

const reply = (lines: readonly string[]): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { lines: [...lines], source: 'screen' } },
  _meta: { runtimeId: 'r' }
})

/** The same frame read between Claude's erase and its redraw: the box's three rows blank. */
const MID_REPAINT = IDLE.map((row, index) => (index >= 2 && index <= 4 ? '' : row))

function look(screens: (readonly string[])[]) {
  const client = makeClient(screens.map(reply))
  return {
    client,
    refusal: readSendUnderDialogRefusal({
      client: client as unknown as RpcClient,
      terminal: 'term',
      agent: 'claude',
      requireComposer: true,
      deadline: Date.now() + 15_000
    })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a send to a Claude tab with background agents in its footer', () => {
  it('goes on the real idle screen with 7 background agents and 5 shells (Claude Code 2.1.296)', async () => {
    await expect(look([IDLE]).refusal).resolves.toBeNull()
  })

  it('looks again when a read caught Claude mid-repaint, and goes once the box is back', async () => {
    const { client, refusal } = look([MID_REPAINT, IDLE])
    await expect(refusal).resolves.toBeNull()
    expect(client.calls.filter((call) => call.method === 'terminal.read')).toHaveLength(2)
  })

  it('still refuses a screen that keeps showing no box, and logs what it saw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const shell = claudeExitedToShell(SHELL_PROMPTS.zsh)
    const { client, refusal } = look([shell, shell, shell, shell])
    await expect(refusal).resolves.toBe(SEND_WITHOUT_COMPOSER_REFUSAL)
    expect(client.calls.filter((call) => call.method === 'terminal.read').length).toBeGreaterThan(1)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]![0])
    expect(line).toMatch(/^\[send-look\] no claude input box after \d+ looks: /)
    expect(line).toContain(`${shell.length} rows`)
  })

  it('degenerate: an empty screen refuses after its looks, and says it had no rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(look([[], [], [], []]).refusal).resolves.toBe(SEND_WITHOUT_COMPOSER_REFUSAL)
    expect(String(warn.mock.calls[0]![0])).toContain('0 rows')
  })
})
