import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'

// Real row shapes, taken from a live Claude Code 2.1.270 transcript on
// 2026-09-15 (~/.claude/projects/.../15f3d17a…jsonl). The last six user or
// assistant rows of a working turn were:
//
//   assistant tool_use · user tool_result · assistant tool_use
//   user tool_result · assistant thinking · assistant text
//
// Only the LAST of those reaches the phone as a chat row. Orca folds tool
// activity into "Ran a command" and drops thinking, so a uuid naming any of the
// others can never be found — the echo then falls back to the arrival tail, and
// every desktop prompt of a turn stacks at the bottom under its own replies
// (device screenshots, 2026-09-15).
function row(uuid: string, type: 'user' | 'assistant', contentType: string): string {
  const content =
    contentType === 'string'
      ? '"a plain prompt"'
      : `[{"type":"${contentType}","text":"x"}]`
  return JSON.stringify({ type, uuid, message: { role: type, content: JSON.parse(content) } })
}

function anchorFor(lines: string[]): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-anchor-'))
  const transcript = join(dir, 'session.jsonl')
  writeFileSync(transcript, lines.join('\n') + '\n')
  const tty = join(dir, 'pty')
  writeFileSync(tty, '')
  execFileSync('sh', ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
    input: JSON.stringify({ prompt: 'hello', transcript_path: transcript }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: dir, CUIHUD_TTY: tty }
  })
  const beacon = execFileSync('cat', [tty], { encoding: 'utf8' })
  const match = /\bat=([0-9a-fA-F-]+)/.exec(beacon)
  return match?.[1] ?? null
}

describe('the row a queued prompt is anchored to', () => {
  it('names a row the phone will actually hold, not the tool row above it', () => {
    const anchor = anchorFor([
      row('11111111-1111-1111-1111-111111111111', 'assistant', 'text'),
      row('22222222-2222-2222-2222-222222222222', 'assistant', 'tool_use'),
      row('33333333-3333-3333-3333-333333333333', 'user', 'tool_result')
    ])
    expect(anchor).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('skips a thinking row too', () => {
    const anchor = anchorFor([
      row('44444444-4444-4444-4444-444444444444', 'assistant', 'text'),
      row('55555555-5555-5555-5555-555555555555', 'assistant', 'thinking')
    ])
    expect(anchor).toBe('44444444-4444-4444-4444-444444444444')
  })

  it('anchors to a plain typed prompt, whose content is a bare string', () => {
    const anchor = anchorFor([
      row('66666666-6666-6666-6666-666666666666', 'user', 'string'),
      row('77777777-7777-7777-7777-777777777777', 'assistant', 'tool_use')
    ])
    expect(anchor).toBe('66666666-6666-6666-6666-666666666666')
  })

  it('still takes the newest projected row when several qualify', () => {
    const anchor = anchorFor([
      row('88888888-8888-8888-8888-888888888888', 'assistant', 'text'),
      row('99999999-9999-9999-9999-999999999999', 'assistant', 'text')
    ])
    expect(anchor).toBe('99999999-9999-9999-9999-999999999999')
  })

  it('sends no anchor at all rather than a wrong one', () => {
    // A turn that has only tool rows so far has nothing the phone holds.
    expect(
      anchorFor([row('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'assistant', 'tool_use')])
    ).toBe(null)
  })
})
