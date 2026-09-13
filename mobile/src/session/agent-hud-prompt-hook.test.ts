import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'
import { unescapeJsonStringBody } from './agent-hud-beacon'

function runHook(payload: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-prompt-'))
  const tty = join(dir, 'tty')
  execFileSync('/bin/sh', ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
    input: JSON.stringify(payload),
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
})
