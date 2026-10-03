import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { decodeAgentHudChannelText } from './agent-hud-channel'
import { TICK_PROMPT, tickRows } from './fixtures/claude-scheduled-tick-2.1.286'

// A loop's tick fires UserPromptSubmit like a typed prompt (Claude Code
// 2.1.286's payload has no field saying it was scheduled), and the chat drew
// it as a user bubble. What does say so is the transcript: Claude Code writes
// a `scheduled_task_fire` row holding the tick's words, whitespace folded and
// cut at 200 characters, just before it enqueues the prompt. The hook marks
// its copy `sc=1` when a row like that among the transcript's last lines holds
// this very prompt, folded the same way.
// Verified against 2.1.286's row order in a real transcript (2026-10-01), not
// a live run: a write that lands after the hook reads only means no mark, and
// the chat then matches the words against the loop's CronCreate call.

function runHook(prompt: string, transcriptLines: string[] | null, shell = '/bin/sh'): string {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-tick-'))
  const tty = join(dir, 'tty')
  const input: Record<string, unknown> = { session_id: 'abc', hook_event_name: 'UserPromptSubmit', prompt }
  if (transcriptLines !== null) {
    const transcriptPath = join(dir, 'session.jsonl')
    writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`)
    input.transcript_path = transcriptPath
  }
  execFileSync(shell, ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CUIHUD_TTY: tty }
  })
  // An empty prompt writes no beacon at all (the hook exits before the tty write).
  return existsSync(tty) ? decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n') : ''
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

  // A prompt under 200 characters is in the row whole, so only the same words
  // are its tick. The prefix rule is for the cut one: applied to a short loop
  // prompt it marked a typed message that merely started with it, and a
  // marked copy mid-turn has no other way onto the screen (review of 8233ed8b).
  it('does not mark a typed prompt that starts with a short loop prompt', () => {
    expect(runHook('status report please, and also fix the bug', tickRows('status'))).not.toContain('sc=')
    expect(runHook('/foo bar', tickRows('/foo'))).not.toContain('sc=')
  })

  it('counts a short prompt of multibyte letters by its letters, not its bytes', () => {
    const accents = 'é'.repeat(120)
    expect(runHook(`${accents} and more`, tickRows(accents))).not.toContain('sc=')
    expect(runHook(accents, tickRows(accents))).toContain(' sc=1')
  })

  // The fire row's words are FOLDED: Claude Code 2.1.286 and 2.1.288 write `prompt` as
  // `V3(task.prompt, 200)`, whitespace runs become one space and the ends are trimmed
  // (fixtures/claude-scheduled-tick-2.1.286.ts, fireRowWords). The hook's own copy keeps its line
  // breaks as `\\n`, so a prompt with one inside its first 200 characters was never marked, and the
  // chat drew the tick as a user bubble (reported 2026-10-03, 0.9.112, a heredoc watcher loop).
  describe('on a tick whose prompt has whitespace the fire row folds', () => {
    const HEREDOC = [
      "Round G watcher v2 (3 Oct). Use ssh -o ConnectTimeout=15 host bash -s <<'EOF' (login shell tcsh; never put 2>&1 inside a quoted ssh command;",
      'cd /scratch/proj && squeue -u me 2>&1 | head -20',
      'echo "done" & wait',
      'EOF',
      'Report "No change" when nothing moved. Path C:\\tmp\\a, snow \u2603 end.'
    ].join('\n')

    it('marks a loop tick whose prompt has a line break in its first 200 characters', () => {
      expect(runHook(HEREDOC, [reply, tickRows(HEREDOC)[0]!])).toContain(' sc=1')
      expect(runHook(HEREDOC, [reply, ...tickRows(HEREDOC)])).toContain(' sc=1')
    })

    it.each(['sh', 'bash', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])])('marks the heredoc tick under %s too', (shell) => {
      expect(runHook(HEREDOC, [reply, tickRows(HEREDOC)[0]!], shell)).toContain(' sc=1')
    })

    it('marks a short two-line loop prompt, which the row holds whole on one line', () => {
      const prompt = 'Check the build\nthen report in one line'
      expect(tickRows(prompt)[0]).toContain('Check the build then report in one line')
      expect(runHook(prompt, [reply, tickRows(prompt)[0]!])).toContain(' sc=1')
    })

    it('marks a tick whose prompt has a tab, a double space and a leading blank line', () => {
      const prompt = '\n  Poll\tthe  host   and report\r\n'
      expect(runHook(prompt, [reply, tickRows(prompt)[0]!])).toContain(' sc=1')
    })

    it('marks a cut tick with its line breaks past the first 200 characters', () => {
      const prompt = `${'word '.repeat(60)}\nsecond line\n${'z'.repeat(50)}`
      expect(runHook(prompt, [reply, tickRows(prompt)[0]!])).toContain(' sc=1')
    })

    it('does not mark a typed multi-line prompt that is not the loop’s', () => {
      expect(runHook('Stop the watch now\nand tell me why', [reply, tickRows(HEREDOC)[0]!])).not.toContain('sc=')
    })

    it('does not mark a typed prompt that opens like a cut loop prompt and goes on differently', () => {
      const typed = `${HEREDOC.slice(0, 120)}\nbut cancel everything instead`
      expect(runHook(typed, [tickRows(HEREDOC)[0]!])).not.toContain('sc=')
    })

    it('does not mark a typed prompt that starts with a short two-line loop prompt', () => {
      const loop = 'status\nreport'
      expect(runHook(`${loop}\nplease, and also fix the bug`, [tickRows(loop)[0]!])).not.toContain('sc=')
      expect(runHook('status', [tickRows(loop)[0]!])).not.toContain('sc=')
    })

    it('marks nothing for an empty prompt or one of only whitespace', () => {
      for (const prompt of ['', ' ', '\n\n', '\t \r\n']) {
        expect(runHook(prompt, [reply, tickRows('x')[0]!])).not.toContain('sc=')
        expect(runHook(prompt, [reply, tickRows(prompt)[0]!])).not.toContain('sc=')
      }
    })

    it('marks a one-line, one-character loop prompt', () => {
      expect(runHook('x', [tickRows('x')[0]!])).toContain(' sc=1')
    })
  })

  it('marks a short loop prompt’s own words', () => {
    expect(runHook('status', tickRows('status'))).toContain(' sc=1')
  })

  it('takes the row as cut at 200 characters, multibyte or escaped ones too', () => {
    const wide = `${'é"\\\n'.repeat(60)}${'ü'.repeat(20)} and then the rest of the loop prompt`
    expect(runHook(wide, tickRows(wide))).toContain(' sc=1')
    expect(runHook(`${wide.slice(0, 199)}`, tickRows(wide))).not.toContain('sc=')
  })

  // A sentinel loop (`/loop` with no prompt, or a loop.md) stores a sentinel as
  // its prompt, but the fire row holds the literal `/loop` or `/loop (loop.md)`
  // (`mon` writes U(task), 2.1.286 @48710795), never the words the turn holds,
  // which Claude Code resolves the sentinel into at fire time. With no words to
  // compare, BOTH must hold: the last fire row of the 8-line tail is one of
  // those two literals, AND the prompt opens as the resolved words do. Either
  // alone marks typed prompts: any prompt typed within eight lines after a
  // sentinel tick, or any prompt that merely opens like a tick.
  describe('on a tick whose fire row holds /loop', () => {
    const OPENERS = [
      '# Autonomous loop tick\nRun the autonomous check and report in one line.',
      '# Autonomous loop tick (dynamic pacing)\nRun the check, then pick the next delay.',
      '# Autonomous loop check\nYou are in a loop. Each tick runs the check below.',
      '# /loop tick — loop.md tasks\nWork through the tasks below and report.',
      '# /loop tick — loop.md absent (dynamic pacing)\nNo file; pick the next delay.'
    ]
    const FIRES = ['/loop', '/loop (loop.md)']

    it.each(OPENERS)('marks the resolved words %#, whatever the sentinel', (words) => {
      for (const fire of FIRES) {
        const beacon = runHook(words, [reply, tickRows(words, fire)[0]!])
        expect(beacon).toContain(' sc=1')
        expect(parseAgentHudBeaconPayload(beacon)?.desktopPrompt).toMatchObject({ scheduled: true })
      }
    })

    it('marks it with a tool row between the fire row and the hook', () => {
      expect(runHook(OPENERS[0]!, [tickRows(OPENERS[0]!, '/loop')[0]!, toolRow, toolRow])).toContain(' sc=1')
    })

    it('leaves a prompt typed with other words after a sentinel fire unmarked', () => {
      expect(runHook('Stop the watch now', [reply, tickRows(OPENERS[0]!, '/loop')[0]!])).not.toContain('sc=1')
    })

    it('leaves a typed /loop command unmarked, bare or with a prompt', () => {
      const fire = tickRows(OPENERS[0]!, '/loop')[0]!
      expect(runHook('/loop check the build every 5m', [reply, fire])).not.toContain('sc=1')
      expect(runHook('/loop', [reply, fire])).not.toContain('sc=1')
      expect(runHook('/loop (loop.md)', [reply, tickRows(OPENERS[0]!, '/loop (loop.md)')[0]!])).not.toContain('sc=1')
    })

    it('leaves a prompt that opens like a tick unmarked when no sentinel fire row is near', () => {
      expect(runHook(OPENERS[0]!, [reply, toolRow])).not.toContain('sc=1')
      expect(runHook(OPENERS[0]!, [tickRows('Check the build host', 'Check the build host')[0]!])).not.toContain('sc=1')
    })

    it('leaves a sentinel fire row further back than the last eight lines unmarked', () => {
      const rows = [tickRows(OPENERS[0]!, '/loop')[0]!, ...Array.from({ length: 8 }, () => toolRow)]
      expect(runHook(OPENERS[0]!, rows)).not.toContain('sc=1')
    })

    it('does not take a near-literal for the sentinel row', () => {
      for (const fire of ['/loop now', '/loops', '<<autonomous-loop>>', '/loop (loop.md) x']) {
        expect(runHook(OPENERS[0]!, [reply, tickRows(OPENERS[0]!, fire)[0]!])).not.toContain('sc=1')
      }
    })

    it('marks nothing without a readable transcript, or from an empty one', () => {
      expect(runHook(OPENERS[0]!, null)).not.toContain('sc=1')
      expect(runHook(OPENERS[0]!, [''])).not.toContain('sc=1')
    })
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
