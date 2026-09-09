import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tokenizeStartupCommand } from '../../../src/shared/tui-agent-startup-shell'
import {
  buildAgentHudLaunchArgs,
  buildClaudeHudSettingsJson,
  CLAUDE_HUD_STATUSLINE_SCRIPT
} from './agent-hud-launch-args'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'

// Captured 2026-09-09 from Claude Code 2.1.266 on macOS: the JSON it pipes to a
// status-line command (paths redacted). This is the real contract, not a guess.
const statusJson = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-statusline-2.1.266.json', import.meta.url)),
  'utf8'
)

function runStatusLine(input: string, shell: 'sh' | 'bash' | 'zsh' = 'sh'): string {
  return execFileSync(shell, ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], { input, encoding: 'utf8' }).trim()
}

function withUsage(json: string, usage: { input: number; create: number; read: number; pct: number }) {
  const d = JSON.parse(json)
  d.context_window.current_usage = {
    input_tokens: usage.input,
    cache_creation_input_tokens: usage.create,
    cache_read_input_tokens: usage.read,
    output_tokens: 900
  }
  d.context_window.used_percentage = usage.pct
  d.context_window.remaining_percentage = 100 - usage.pct
  return JSON.stringify(d)
}

describe('Claude status line switched on at launch, with sh and sed only', () => {
  it('prints model, effort, context and both limits from what Claude Code pipes in', () => {
    const fresh = runStatusLine(statusJson)
    expect(fresh).toBe('[Fable 5.1 medium] ctx 0% 0/1.0M · 5h 37% · 7d 36%')
    const busy = runStatusLine(withUsage(statusJson, { input: 12000, create: 30000, read: 607540, pct: 64.95 }))
    expect(busy).toBe('[Fable 5.1 medium] ctx 64% 649k/1.0M · 5h 37% · 7d 36%')
  })

  it('reads the same under bash and zsh, the shells Claude Code may hand it to', () => {
    for (const shell of ['bash', 'zsh'] as const) {
      expect(runStatusLine(statusJson, shell)).toBe('[Fable 5.1 medium] ctx 0% 0/1.0M · 5h 37% · 7d 36%')
    }
  })

  it('is read back completely by the phone parser', () => {
    const line = runStatusLine(withUsage(statusJson, { input: 12000, create: 30000, read: 607540, pct: 64.95 }))
    const observation = parseTerminalHudObservation([line, '⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'])
    expect(observation?.modelLabel).toBe('Fable 5.1')
    expect(observation?.effort).toBe('medium')
    expect(observation?.context).toEqual({ usedPercent: 64, usedLabel: '649k', windowLabel: '1.0M' })
    expect(observation?.permissionMode).toBe('auto')
  })

  it('travels through Orca\'s argument tokenizer as exactly two tokens', () => {
    const args = buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: '', hostPlatform: 'darwin' })!
    const tokens = tokenizeStartupCommand(args, 'posix')
    expect(tokens.ok).toBe(true)
    if (tokens.ok) {
      expect(tokens.tokens).toEqual(['--settings', buildClaudeHudSettingsJson()])
      expect(JSON.parse(tokens.tokens[1]!).statusLine.command).toBe(CLAUDE_HUD_STATUSLINE_SCRIPT)
    }
    expect(CLAUDE_HUD_STATUSLINE_SCRIPT).not.toContain("'")
  })

  it('keeps the host\'s own default args in front and stays off Claude on Windows', () => {
    expect(
      buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: '--verbose', hostPlatform: 'linux' })
    ).toMatch(/^--verbose --settings '/)
    expect(buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: '', hostPlatform: 'win32' })).toBeNull()
    expect(buildAgentHudLaunchArgs({ agent: 'opencode', hostDefaultArgs: '', hostPlatform: 'darwin' })).toBeNull()
  })
})

describe('Codex status line switched on at launch', () => {
  it('asks for model, reasoning, context and both limits on every platform', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const args = buildAgentHudLaunchArgs({ agent: 'codex', hostDefaultArgs: '', hostPlatform: platform })!
      const tokens = tokenizeStartupCommand(args, 'posix')
      expect(tokens.ok).toBe(true)
      if (tokens.ok) {
        expect(tokens.tokens[0]).toBe('-c')
        expect(tokens.tokens[1]).toBe(
          'tui.status_line=["model-with-reasoning","context-remaining","five-hour-limit","weekly-limit"]'
        )
      }
    }
  })

  it('and the phone parser reads the footer codex-cli 0.153.4 then paints', () => {
    // Captured live 2026-09-09 (orca terminal show) after launching with the flag.
    const observation = parseTerminalHudObservation([
      '› Ask Codex to do anything',
      '  gpt-5.6-terra xhigh · Context 100% left · monthly 94% left'
    ])
    expect(observation?.modelId).toBe('gpt-5.6-terra')
    expect(observation?.effort).toBe('xhigh')
    expect(observation?.context?.usedPercent).toBe(0)
  })
})
