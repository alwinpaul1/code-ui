import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { decodeAgentHudChannelText } from './agent-hud-channel'
import { TICK_PROMPT, tickRows } from './fixtures/claude-scheduled-tick-2.1.286'

// A loop's tick fires UserPromptSubmit like a typed prompt (Claude Code
// 2.1.286's payload has no field saying it was scheduled), and the chat drew
// it as a user bubble. What does say so is the transcript: Claude Code writes
// a `scheduled_task_fire` row holding the tick's first 200 characters just
// before it enqueues the prompt. The hook marks its copy `sc=1` when a row
// like that among the transcript's last lines starts this very prompt.
// Verified against 2.1.286's row order in a real transcript (2026-10-01), not
// a live run: a write that lands after the hook reads only means no mark, and
// the chat then matches the words against the loop's CronCreate call.

function runHook(prompt: string, transcriptLines: string[] | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-tick-'))
  const tty = join(dir, 'tty')
  const input: Record<string, unknown> = { session_id: 'abc', hook_event_name: 'UserPromptSubmit', prompt }
  if (transcriptLines !== null) {
    const transcriptPath = join(dir, 'session.jsonl')
    writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`)
    input.transcript_path = transcriptPath
  }
  execFileSync('/bin/sh', ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CUIHUD_TTY: tty }
  })
  return decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n')
}

const reply = JSON.stringify({ type: 'assistant', uuid: 'a-1', message: { role: 'assistant', content: [{ type: 'text', text: 'No change.' }] } })
const toolRow = JSON.stringify({ type: 'user', uuid: 'u-1', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } })

describe('the prompt hook on a loop tick', () => {
  it('marks the tick it fired for, whose row is the transcript’s last', () => {
    const beacon = runHook(TICK_PROMPT, [reply, tickRows()[0]!])
    expect(beacon).toContain(' sc=1')
    expect(parseAgentHudBeaconPayload(beacon)?.desktopPrompt).toMatchObject({ scheduled: true })
  })

  it('marks it with the tick’s own user row, or a tool row, written after it', () => {
    expect(runHook(TICK_PROMPT, [reply, ...tickRows()])).toContain(' sc=1')
    expect(runHook(TICK_PROMPT, [reply, tickRows()[0]!, toolRow, toolRow])).toContain(' sc=1')
  })

  it('does not mark a prompt the user typed after a tick', () => {
    const beacon = runHook('Stop the watch now', [reply, ...tickRows()])
    expect(beacon).not.toContain('sc=')
    expect(parseAgentHudBeaconPayload(beacon)?.desktopPrompt?.scheduled).toBeUndefined()
  })

  it('does not mark a prompt that shares only the tick’s opening words', () => {
    expect(runHook(`${TICK_PROMPT.slice(0, 120)} but cancel everything instead`, [...tickRows()])).not.toContain('sc=')
  })

  it('reads the tick’s words as words, never as a pattern', () => {
    // `*` and `[` in a loop's prompt would match anything as a shell pattern.
    const globby = 'Run tests/*.ts [all] then report? (y/n)'
    expect(runHook('Run tests/a.ts a then report! (y/n)', tickRows(globby))).not.toContain('sc=')
    expect(runHook(globby, tickRows(globby))).toContain(' sc=1')
  })

  describe('when the transcript cannot say', () => {
    it('does not mark a prompt with no transcript, or an unreadable one', () => {
      expect(runHook(TICK_PROMPT, null)).not.toContain('sc=')
      const dir = mkdtempSync(join(tmpdir(), 'cuihud-tick-'))
      const beacon = (() => {
        const tty = join(dir, 'tty')
        execFileSync('/bin/sh', ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
          input: JSON.stringify({ prompt: TICK_PROMPT, transcript_path: join(dir, 'missing.jsonl') }),
          encoding: 'utf8',
          env: { ...process.env, CUIHUD_TTY: tty }
        })
        return decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n')
      })()
      expect(beacon).toContain('up=')
      expect(beacon).not.toContain('sc=')
    })

    it('does not mark a prompt whose tick row is further back than the last eight lines', () => {
      expect(runHook(TICK_PROMPT, [tickRows()[0]!, ...Array.from({ length: 8 }, () => toolRow)])).not.toContain('sc=')
    })

    it('does not mark anything from a tick row with no words', () => {
      expect(runHook(TICK_PROMPT, [tickRows('')[0]!])).not.toContain('sc=')
    })
  })
})
