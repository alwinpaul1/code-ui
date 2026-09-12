import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildClaudeHudSettingsJson,
  CLAUDE_HUD_STOP_HOOK_SCRIPT
} from './agent-hud-launch-args'

/** Captured from a live Claude Code 2.1.267 Stop hook on 2026-09-10, with one
 *  background shell still running. Not invented: an invented payload would
 *  agree with an invented parser and both would stay wrong. */
const PAYLOAD = readFileSync(
  join(__dirname, 'fixtures/claude-stop-payload-background-task-2.1.267.json'),
  'utf8'
)

function runStopHook(payload: string, tty: string): string {
  execFileSync('sh', ['-c', CLAUDE_HUD_STOP_HOOK_SCRIPT], {
    input: payload,
    env: { ...process.env, CUIHUD_TTY: tty },
    timeout: 20_000
  })
  return readFileSync(tty, 'utf8')
}

describe('what the agent itself says is still running', () => {
  it('names the running background task the phone could otherwise only guess at', () => {
    // The phone infers background tasks from the transcript because nothing
    // else told it. That inference cannot see a completion recorded mid-turn,
    // so tasks pile up: measured 2026-09-10 against this session's own
    // transcript, the reader claimed 36 running when 3 were. The agent knows
    // exactly, and says so at every Stop.
    const tty = join(process.env.TMPDIR ?? '/tmp', `cuihud-stop-${process.pid}.txt`)
    execFileSync('sh', ['-c', `: > ${tty}`])

    const written = runStopHook(PAYLOAD, tty)

    expect(written).toContain('CUIHUD1')
    expect(written).toContain('run=b0q56d8gf')
  })

  it('says the set is empty rather than saying nothing, so the phone can clear the row', () => {
    // An absent field means "no answer"; an empty one means "nothing running".
    // Without the difference a finished last task would look unreported.
    const tty = join(process.env.TMPDIR ?? '/tmp', `cuihud-stop-empty-${process.pid}.txt`)
    execFileSync('sh', ['-c', `: > ${tty}`])

    const written = runStopHook('{"background_tasks":[]}', tty)

    expect(written).toContain('run=')
  })

  it('ignores a task the agent reports as no longer running', () => {
    const tty = join(process.env.TMPDIR ?? '/tmp', `cuihud-stop-done-${process.pid}.txt`)
    execFileSync('sh', ['-c', `: > ${tty}`])

    const written = runStopHook(
      '{"background_tasks":[{"id":"bAAA","status":"completed"},{"id":"bBBB","status":"running"}]}',
      tty
    )

    expect(written).toContain('run=bBBB')
    expect(written).not.toContain('bAAA')
  })

  it('leaves idle teammates off the list, since the desk shows them as no running task', () => {
    // 2026-09-12, Claude Code 2.1.268: four council reviewers spawned as
    // teammates a day earlier sat idle, `ListAgents` said `idle`, /tasks on
    // the desk showed nothing running — and the phone said "4 running tasks",
    // each titled by a bare id and called a Shell. The Stop payload lists a
    // teammate with `status: running` for as long as it exists (the four ids
    // below are the ones the beacon carried; `TaskOutput` named their type
    // `in_process_teammate`). A teammate is a peer to talk to, not a task
    // that finishes; the row is for work that will report back.
    const tty = join(process.env.TMPDIR ?? '/tmp', `cuihud-stop-teammates-${process.pid}.txt`)
    execFileSync('sh', ['-c', `: > ${tty}`])

    const written = runStopHook(
      JSON.stringify({
        background_tasks: [
          { id: 'tma4w24hz', type: 'in_process_teammate', status: 'running', description: 'fable-advisor' },
          { id: 'tkjnlai2k', type: 'in_process_teammate', status: 'running', description: 'council-opus' },
          { id: 'b0q56d8gf', type: 'shell', status: 'running', description: 'Sleep for 120 seconds' },
          { id: 't1fe406gg', type: 'in_process_teammate', status: 'running', description: 'council-fable' },
          { id: 'tcwll1evo', type: 'in_process_teammate', status: 'running', description: 'council-sonnet' }
        ]
      }),
      tty
    )

    expect(written).toContain('run=b0q56d8gf')
    for (const teammate of ['tma4w24hz', 'tkjnlai2k', 't1fe406gg', 'tcwll1evo']) {
      expect(written).not.toContain(teammate)
    }
  })

  it('is installed alongside the status line, so one launch flag carries both', () => {
    const settings = JSON.parse(buildClaudeHudSettingsJson()) as {
      statusLine?: unknown
      hooks?: { Stop?: { hooks?: { type?: string; command?: string }[] }[] }
    }
    expect(settings.statusLine).toBeDefined()
    const stop = settings.hooks?.Stop?.[0]?.hooks?.[0]
    expect(stop?.type).toBe('command')
    expect(stop?.command).toBe(CLAUDE_HUD_STOP_HOOK_SCRIPT)
  })
})
