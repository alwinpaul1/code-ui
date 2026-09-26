import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeAgentHudChannelText } from './agent-hud-channel'
import { CLAUDE_HUD_STATUSLINE_SCRIPT, CLAUDE_HUD_STOP_HOOK_SCRIPT } from './agent-hud-launch-args'
import { deriveBackgroundTasks } from './mobile-background-tasks'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// Two shapes Claude Code writes that the beacon scripts and the reader did not
// know, read out of the 2.1.281, 2.1.282 and 2.1.283 bundles on 2026-09-26.
//
// 1. The Stop hook's `background_tasks` does not carry the task's own type:
//    `lLt` writes `type: c3e(r.type)` through the alias table
//    `{ local_agent: "subagent", local_bash: "shell", in_process_teammate:
//    "teammate", … }` (`kpr` in 2.1.281, `jCr` in 2.1.283). The captured
//    2.1.267 payload beside agent-hud-stop-hook.test.ts already reads
//    `"type":"shell"` for a local_bash task. A teammate arrives as `teammate`,
//    and the hook dropped only `in_process_teammate`.
// 2. `qMn` has a fourth sentence for a command moved to the background:
//    "Command was moved to the background (ID: …) so that a message that
//    arrived while it was running can reach you; it was not interrupted." A
//    message queued while a command runs — a phone send mid-turn — moves the
//    command there. No transcript on this machine holds one yet (every
//    background result from 2.1.212 to 2.1.282 was counted), so the record
//    below is the bundle's template filled in.

const SHELLS: readonly string[] = ['sh', 'bash', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])]
const statusJson = readFileSync(fileURLToPath(new URL('./fixtures/claude-statusline-2.1.266.json', import.meta.url)), 'utf8')

function run(script: string, input: string, shell = 'sh'): string {
  const tty = join(mkdtempSync(join(tmpdir(), 'cuihud-shapes-')), 'pty')
  // HOME and CLAUDE_CONFIG_DIR point at an empty directory: the status line
  // runs the user's own status line when a settings file names one.
  const home = mkdtempSync(join(tmpdir(), 'cuihud-home-'))
  execFileSync(shell, ['-c', script], {
    input,
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: home, CUIHUD_TTY: tty },
    timeout: 20_000
  })
  return decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n')
}

const deliverSentence = (id: string) =>
  `Command was moved to the background (ID: ${id}) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: /private/tmp/claude-501/x/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`

describe("the Stop hook's list leaves teammates off under the type Claude Code writes", () => {
  it('drops a task typed `teammate`, as the alias table names an in-process teammate', () => {
    const written = run(
      CLAUDE_HUD_STOP_HOOK_SCRIPT,
      JSON.stringify({
        session_id: '967668df-a7d9-40e7-964b-7812815c010d',
        background_tasks: [
          { id: 'tma4w24hz', type: 'teammate', status: 'running', description: '[teammate]' },
          { id: 'b0q56d8gf', type: 'shell', status: 'running', description: '[shell]' },
          { id: 'abe66e505fe909946', type: 'subagent', status: 'running', description: '[agent]', agent_type: 'general-purpose' }
        ]
      })
    )

    expect(written).toContain('run=b0q56d8gf,abe66e505fe909946')
    expect(written).not.toContain('tma4w24hz')
  })
})

describe('a command moved to the background so a message could reach Claude', () => {
  it('is a launch the reader counts running', () => {
    const turn: NativeChatMessage[] = [
      {
        id: 'call',
        role: 'assistant',
        timestamp: Date.parse('2026-09-26T01:00:00.000Z'),
        source: 'transcript',
        blocks: [{ type: 'tool-call', name: 'Bash', input: { command: '[command]', description: '[long build]' } }]
      },
      {
        id: 'result',
        role: 'tool',
        timestamp: Date.parse('2026-09-26T01:02:00.000Z'),
        source: 'transcript',
        blocks: [{ type: 'tool-result', output: deliverSentence('bdlv3r8ms') }]
      }
    ]

    const tasks = deriveBackgroundTasks(turn, Date.parse('2026-09-26T01:03:00.000Z'), { state: 'working' })

    expect(tasks.running.map((task) => [task.id, task.kind, task.title])).toEqual([['bdlv3r8ms', 'shell', '[long build]']])
  })

  for (const shell of SHELLS) {
    it(`is a shell the status line beacons as launched and live (${shell})`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'cuihud-transcript-'))
      const transcript = join(dir, 'session.jsonl')
      writeFileSync(
        transcript,
        `${JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ tool_use_id: 'toolu_01Z', type: 'tool_result', content: deliverSentence('bdlv3r8ms'), is_error: false }] },
          uuid: '8f0c2b8f-2b1f-4b2e-9c1e-7a9d1f0e2c13',
          timestamp: '2026-09-26T01:02:00.000Z'
        })}\n`
      )
      const parsed = JSON.parse(statusJson)
      parsed.transcript_path = transcript

      const beacon = run(CLAUDE_HUD_STATUSLINE_SCRIPT, JSON.stringify(parsed), shell)

      const field = (name: string) => beacon.split(' ').find((part) => part.startsWith(`${name}=`))?.replace(/[^A-Za-z0-9_,=-]/g, '')
      expect(field('bg')).toBe('bg=bdlv3r8ms')
      expect(field('live')).toBe('live=bdlv3r8ms')
    })
  }
})
