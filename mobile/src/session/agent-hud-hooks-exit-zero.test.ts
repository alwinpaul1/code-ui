import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT, CLAUDE_HUD_STATUSLINE_SCRIPT, CLAUDE_HUD_STOP_HOOK_SCRIPT } from './agent-hud-launch-args'
import { CLAUDE_HUD_MODEL_SWITCH_HOOK_SCRIPT, CLAUDE_HUD_SESSION_START_HOOK_SCRIPT } from './agent-hud-session-start-hook-script'

// Claude Code treats a hook that exits non-zero as a hook error, and for Stop
// feeds it back to the model (exit 2 is a BLOCKING error); a hook's stdout is
// context (PostModelSwitch adds hook_success content to the next request). So
// every command we install must exit 0 with nothing on stdout or stderr, even
// when the terminal it writes to cannot be written. dash used to exit 2 on a
// failed `>>` redirect inside a compound command (review, 2026-10-05).
const SID = '3f0c1d52-8a4e-4a39-9d52-0b6f2f7a1c11'
const inputs: Array<[string, string, string]> = [
  ['SessionStart', CLAUDE_HUD_SESSION_START_HOOK_SCRIPT, JSON.stringify({ session_id: SID, hook_event_name: 'SessionStart', model: 'claude-opus-5-5[1m]' })],
  ['PostModelSwitch', CLAUDE_HUD_MODEL_SWITCH_HOOK_SCRIPT, JSON.stringify({ session_id: SID, to_model: 'claude-sonnet-5', source: 'command' })],
  ['Stop', CLAUDE_HUD_STOP_HOOK_SCRIPT, JSON.stringify({ session_id: SID, effort: { level: 'high' }, hook_event_name: 'Stop', background_tasks: [] })],
  ['UserPromptSubmit', CLAUDE_HUD_PROMPT_HOOK_SCRIPT, JSON.stringify({ session_id: SID, prompt: 'hi', hook_event_name: 'UserPromptSubmit' })],
  ['statusLine', CLAUDE_HUD_STATUSLINE_SCRIPT, JSON.stringify({ session_id: SID, model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' }, workspace: { current_dir: '/p' }, cwd: '/p' })]
]

const shells = ['sh', 'dash', 'bash', 'zsh'].filter((shell) => spawnSync('sh', ['-c', `command -v ${shell}`]).status === 0)

describe.each(shells)('every installed command under %s with a terminal that cannot be written', (shell) => {
  for (const [name, script, input] of inputs) {
    it(`${name} exits 0 and says nothing`, () => {
      const home = mkdtempSync(join(tmpdir(), 'cuihud-home-'))
      const r = spawnSync(shell, ['-c', script], {
        input,
        env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CUIHUD_TTY: '/nonexistent-dir/tty' },
        timeout: 20_000
      })
      expect({ status: r.status, stdout: r.stdout.toString(), stderr: r.stderr.toString() }).toEqual({ status: 0, stdout: '', stderr: '' })
    })
  }
})
