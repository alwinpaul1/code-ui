import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'
import { unescapeJsonStringBody } from './agent-hud-beacon'

function runHook(payload: Record<string, unknown>, transcript?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-prompt-'))
  const tty = join(dir, 'tty')
  let input: Record<string, unknown> = payload
  if (transcript !== undefined) {
    const transcriptPath = join(dir, 'session.jsonl')
    writeFileSync(transcriptPath, transcript)
    input = { ...payload, transcript_path: transcriptPath }
  }
  execFileSync('/bin/sh', ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CUIHUD_TTY: tty }
  })
  try {
    return readFileSync(tty, 'utf8')
  } catch {
    return ''
  }
}

const BEL = String.fromCharCode(7)

function promptOf(beacon: string): string {
  const after = beacon.slice(beacon.indexOf('up=') + 3)
  const value = after.includes(BEL) ? after.slice(0, after.indexOf(BEL)) : after
  const cut = value.indexOf(':')
  return unescapeJsonStringBody(decodeURIComponent(value.slice(cut + 1)))
}

// 2026-09-13: a prompt typed on the desktop while a turn runs is stored as an
// attachment record, which Orca's transcript reader drops, so the phone only
// ever sees it through this hook.
describe('the desktop prompt hook', () => {
  it('beacons the text the user typed, spaces and quotes included', () => {
    const out = runHook({ prompt: 'fix the "dock" spacing; please' })
    expect(out).toContain('CUIHUD1 agent=claude up=')
    const nonce = (out.match(/up=([0-9]+):/)?.[1] ?? '0')
    expect(Number(nonce)).toBeGreaterThan(0)
    expect(promptOf(out)).toBe('fix the "dock" spacing; please')
  })

  it('keeps a multi-line prompt on one beacon, newlines and all', () => {
    expect(promptOf(runHook({ prompt: 'line one\nline two' }))).toBe('line one\nline two')
  })

  it('writes nothing at all when there is no prompt', () => {
    expect(runHook({ session_id: 'x' })).toBe('')
  })

  // 2026-09-18: desktop prompts are held per terminal handle, and a handle
  // outlives the process that emitted into it, so a hand-started session in a
  // reused terminal would have echoed the previous session's prompts. The
  // hook's payload names its session; the beacon carries it ahead of `up=`.
  it('names the session the prompt was typed into, so another session on the same terminal cannot inherit it', () => {
    const out = runHook({
      session_id: '77954fea-1013-4225-b187-a8b3162a04ce',
      prompt: 'continue'
    })
    expect(out).toContain('CUIHUD1 agent=claude sid=77954fea-1013-4225-b187-a8b3162a04ce up=')
    expect(promptOf(out)).toBe('continue')
  })

  // 2026-09-14, from the phone against the Claude app: a prompt queued while
  // a turn ran landed several turns too LOW on the phone. Its echo anchored to
  // the tail at beacon ARRIVAL, and on a lagging link that was long after the
  // moment it was typed. The hook now beacons the transcript's last projected
  // row at submit time, so the phone anchors where the record actually sits.
  it('beacons the last user/assistant row uuid at submit time as at=', () => {
    // Real row shapes. Only the assistant TEXT row reaches the phone: Orca
    // folds tool activity into "Ran a command", drops thinking, and never
    // projects the queue records Claude writes for the submit itself. This test
    // used to expect the tool_use row and called it projected — the same wrong
    // assumption the hook carried, which anchored every queued prompt to a uuid
    // the phone does not hold, so they all fell back to the tail and stacked
    // (device screenshots, 2026-09-15).
    const transcript = [
      '{"type":"assistant","uuid":"a1a1a1a1-0000-4000-8000-000000000001","parentUuid":null,"message":{"role":"assistant","content":[{"type":"text","text":"working"}]}}',
      '{"type":"user","uuid":"b2b2b2b2-0000-4000-8000-000000000002","parentUuid":"a1a1a1a1-0000-4000-8000-000000000001","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}',
      '{"type":"assistant","uuid":"c3c3c3c3-0000-4000-8000-000000000003","parentUuid":"b2b2b2b2-0000-4000-8000-000000000002","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash"}]}}',
      '{"type":"queue-operation","uuid":"d4d4d4d4-0000-4000-8000-000000000004","operation":"enqueue"}',
      '{"type":"attachment","uuid":"e5e5e5e5-0000-4000-8000-000000000005","attachment":{"type":"queued_command","prompt":[{"type":"text","text":"queued"}]}}'
    ].join('\n') + '\n'
    const out = runHook({ prompt: 'queued while busy' }, transcript)
    expect(out).toContain('CUIHUD1 agent=claude up=')
    // The last row the phone will actually hold.
    expect(out).toContain(' at=a1a1a1a1-0000-4000-8000-000000000001')
    expect(out).not.toContain('at=c3c3c3c3')
    expect(out).not.toContain('at=b2b2b2b2')
    expect(out).not.toContain('at=e5e5e5e5')
    expect(out).not.toContain('at=d4d4d4d4')
  })

  it('omits at= when there is no readable transcript', () => {
    const out = runHook({ prompt: 'hello' })
    expect(out).toContain('up=')
    expect(out).not.toContain(' at=')
  })

  // Claude Code treats any stdout from a UserPromptSubmit hook as context and
  // a non-zero exit as a hook error (issue #13912, 2026).
  it('prints nothing and exits clean even with no tty to write to', () => {
    const out = execFileSync('/bin/sh', ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
      input: JSON.stringify({ prompt: 'hello' }),
      encoding: 'utf8',
      env: { ...process.env, CUIHUD_TTY: '/nonexistent/tty' }
    })
    expect(out).toBe('')
  })
})
