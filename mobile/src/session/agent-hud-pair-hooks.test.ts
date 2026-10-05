import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { consumeAgentHudBeacons, getAgentHudBeacon, resetAgentHudBeacons } from './agent-hud-beacon'
import { decodeAgentHudChannelText, encodeAgentHudChannelFrame } from './agent-hud-channel'
import { buildClaudeHudSettingsJson, CLAUDE_HUD_STOP_HOOK_SCRIPT } from './agent-hud-launch-args'
import { CLAUDE_HUD_SESSION_START_HOOK_SCRIPT } from './agent-hud-session-start-hook-script'
import { applyAgentHudBeaconFields } from './hud-beacon-fields'

// Hook inputs are SYNTHETIC: their field names and gating are read from the
// Claude Code 2.1.289 binary (2026-10-05, `strings`; function `rd` builds the
// base input), not captured from a live session. SessionStart carries `model`
// and, built without a tool context, no `effort`. Stop, PreToolUse and
// PostToolUse are built with one and carry `effort:{level}` (only when the
// model takes effort). UserPromptSubmit carries neither.
const SID = '3f0c1d52-8a4e-4a39-9d52-0b6f2f7a1c11'
const sessionStart = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: SID, transcript_path: '/p/x.jsonl', cwd: '/p', hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5-5', ...extra })
const stop = (effort?: string) =>
  JSON.stringify({
    session_id: SID,
    transcript_path: '/p/x.jsonl',
    cwd: '/p',
    permission_mode: 'default',
    ...(effort ? { effort: { level: effort } } : {}),
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'an answer that quotes {"effort":{"level":"max"}} and "model":"claude-fable-5-1"',
    background_tasks: []
  })

function run(shell: 'sh' | 'dash', script: string, payload: string): string[] {
  const tty = join(process.env.TMPDIR ?? '/tmp', `cuihud-pair-${shell}-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(tty, '')
  execFileSync(shell, ['-c', script], { input: payload, env: { ...process.env, CUIHUD_TTY: tty }, timeout: 20_000 })
  return decodeAgentHudChannelText(readFileSync(tty, 'latin1'))
}

describe.each(['sh', 'dash'] as const)('the pair hooks under %s', (shell) => {
  it('beacons the model a new session starts on, before any prompt or status-line tick', () => {
    expect(run(shell, CLAUDE_HUD_SESSION_START_HOOK_SCRIPT, sessionStart())).toEqual([
      `CUIHUD1 agent=claude sid=${SID} model=claude-opus-5-5`
    ])
  })

  it('keeps the [1m] window marker off the model id, as the status line id carries none', () => {
    const out = run(shell, CLAUDE_HUD_SESSION_START_HOOK_SCRIPT, sessionStart({ model: 'claude-opus-5-5[1m]' })).join('')
    expect(out).toContain('model=claude-opus-5-5')
    expect(out).not.toContain('1m')
  })

  it('says nothing for a SessionStart that names no model', () => {
    const { model: _model, ...bare } = JSON.parse(sessionStart())
    expect(run(shell, CLAUDE_HUD_SESSION_START_HOOK_SCRIPT, JSON.stringify(bare))).toEqual([])
  })

  it('says nothing for garbage on stdin and for an empty stdin', () => {
    expect(run(shell, CLAUDE_HUD_SESSION_START_HOOK_SCRIPT, 'not json at all')).toEqual([])
    expect(run(shell, CLAUDE_HUD_SESSION_START_HOOK_SCRIPT, '')).toEqual([])
  })

  it('beacons the effort the session sends at every Stop, beside the running list', () => {
    expect(run(shell, CLAUDE_HUD_STOP_HOOK_SCRIPT, stop('high'))).toEqual([
      `CUIHUD1 agent=claude sid=${SID} run= effort=high`
    ])
  })

  it('states no effort for a model that takes none: the key is absent, not guessed', () => {
    expect(run(shell, CLAUDE_HUD_STOP_HOOK_SCRIPT, stop())).toEqual([`CUIHUD1 agent=claude sid=${SID} run=`])
  })

  it('does not read an effort or a model that the assistant message merely quotes', () => {
    const out = run(shell, CLAUDE_HUD_STOP_HOOK_SCRIPT, stop()).join('')
    expect(out).not.toContain('effort=')
    expect(out).not.toContain('max')
    const started = run(shell, CLAUDE_HUD_SESSION_START_HOOK_SCRIPT, sessionStart({ session_title: 'x "model":"claude-fable-5-1"' })).join('')
    expect(started).toContain('model=claude-opus-5-5')
    expect(started).not.toContain('fable')
  })
})

describe('what the launch flag carries', () => {
  it('registers the SessionStart hook beside the Stop and prompt hooks on a POSIX host', () => {
    const hooks = JSON.parse(buildClaudeHudSettingsJson('darwin')).hooks
    expect(Object.keys(hooks).sort()).toEqual(['SessionStart', 'Stop', 'UserPromptSubmit'])
    expect(hooks.SessionStart[0].hooks[0]).toMatchObject({ type: 'command', command: CLAUDE_HUD_SESSION_START_HOOK_SCRIPT })
  })

  it('keeps the Windows settings as they were: no sh hook where there is no sh', () => {
    const hooks = JSON.parse(buildClaudeHudSettingsJson('win32')).hooks
    expect(Object.keys(hooks).sort()).toEqual(['Stop', 'UserPromptSubmit'])
  })

  it('uses no single quote, which would end the shell token the flag travels in', () => {
    expect(CLAUDE_HUD_SESSION_START_HOOK_SCRIPT).not.toContain("'")
    expect(CLAUDE_HUD_STOP_HOOK_SCRIPT).not.toContain("'")
  })
})

describe('the phone reading the hook frames as beacon-tier', () => {
  const feed = (payload: string) => consumeAgentHudBeacons('t1', encodeAgentHudChannelFrame(payload))
  beforeEach(() => resetAgentHudBeacons())
  const pill = () => {
    const o = applyAgentHudBeaconFields(null, getAgentHudBeacon('t1'))
    return { id: o?.modelId ?? null, label: o?.modelLabel ?? null, effort: o?.effort ?? null }
  }

  it('shows the model of a new session, named as the agent names it, before its first prompt', () => {
    feed(`CUIHUD1 agent=claude sid=${SID} model=claude-opus-5-5`)
    expect(pill()).toEqual({ id: 'claude-opus-5-5', label: 'Opus 5.5', effort: null })
  })

  it('adds the effort a Stop reports to the model SessionStart named', () => {
    feed(`CUIHUD1 agent=claude sid=${SID} model=claude-opus-5-5`)
    feed(`CUIHUD1 agent=claude sid=${SID} run= effort=high`)
    expect(pill()).toEqual({ id: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' })
  })

  it('follows an /effort change made for this session only, at the next Stop', () => {
    feed(`CUIHUD1 agent=claude sid=${SID} model=claude-opus-5-5`)
    feed(`CUIHUD1 agent=claude sid=${SID} run= effort=high`)
    feed(`CUIHUD1 agent=claude sid=${SID} run= effort=low`)
    expect(pill().effort).toBe('low')
  })

  it('lets the status line, newest, win with its name and effort', () => {
    feed(`CUIHUD1 agent=claude sid=${SID} model=claude-opus-5-5`)
    feed(`CUIHUD1 agent=claude hk=1 hb=5 sid=${SID} model=claude-opus-5-5 name=Opus%205.5 effort=medium`)
    expect(pill()).toEqual({ id: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' })
  })

  it('does not blank the status line name and effort when a SessionStart repeats the same model', () => {
    feed(`CUIHUD1 agent=claude hk=1 hb=5 sid=${SID} model=claude-opus-5-5 name=Opus%205.5 effort=medium`)
    feed(`CUIHUD1 agent=claude sid=${SID} model=claude-opus-5-5`)
    expect(pill()).toEqual({ id: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' })
  })

  it('drops the old effort when a SessionStart names a different model, which is another model’s effort', () => {
    feed(`CUIHUD1 agent=claude hk=1 hb=5 sid=${SID} model=claude-opus-5-5 name=Opus%205.5 effort=medium`)
    feed(`CUIHUD1 agent=claude sid=${SID} model=claude-fable-5-1`)
    expect(pill()).toEqual({ id: 'claude-fable-5-1', label: 'Fable 5.1', effort: null })
  })

  it('states a model with no effort when its status line omits effort, and a later Stop adds none', () => {
    feed(`CUIHUD1 agent=claude hk=1 hb=5 sid=${SID} model=claude-haiku-4-5 name=Haiku%204.5`)
    feed(`CUIHUD1 agent=claude sid=${SID} run=`)
    expect(pill().effort).toBeNull()
  })

  it('holds an effort that arrives with no model to attach to, and does not draw it alone', () => {
    feed(`CUIHUD1 agent=claude sid=${SID} run= effort=high`)
    expect(pill()).toEqual({ id: null, label: '', effort: null })
  })

  it('does not carry the effort of one session into another session in the same terminal', () => {
    feed(`CUIHUD1 agent=claude sid=${SID} model=claude-opus-5-5`)
    feed(`CUIHUD1 agent=claude sid=${SID} run= effort=high`)
    feed(`CUIHUD1 agent=claude sid=aaaaaaaa-0000-4000-8000-000000000000 model=claude-opus-5-5`)
    expect(pill().effort).toBeNull()
  })
})
