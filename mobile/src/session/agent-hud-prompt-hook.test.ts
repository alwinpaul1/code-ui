import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { decodeAgentHudChannelText } from './agent-hud-channel'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'
import { promptHookBody } from './agent-hud-prompt-hook.test-support'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

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
    // The payload the phone decodes, not the raw channel bytes the hook wrote.
    return decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n')
  } catch {
    return ''
  }
}

/** The words the phone reads off the hook's beacon, through the phone's own
 *  parser. This decoded the body with decodeURIComponent of its own until
 *  2026-09-30, which agreed with the reader's second decode and so could not
 *  see it. */
function promptOf(beacon: string): string | undefined {
  return parseAgentHudBeaconPayload(beacon)?.desktopPrompt?.text
}

/** The raw body the hook wrote after `up=<pid>:`, up to the next field. */
function bodyOf(beacon: string): string {
  const value = /\bup=[0-9]+:(\S*)/.exec(beacon)?.[1]
  return value ?? ''
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
    // Real row shapes. Only the assistant TEXT row may anchor. Orca never
    // projects the queue records Claude writes for the submit itself (its
    // decoder reads only user and assistant records). This test used to expect
    // the tool_use row, and on the device of 2026-09-15 an anchor on it was not
    // found, so every queued prompt fell back to the tail and stacked (device
    // screenshots). Orca 1.4.216's decoder does make rows of tool calls,
    // results and thinking, keyed by the record uuid (read 2026-09-29); the
    // text-only rule is kept until a device shows those rows are found, and
    // why is in agent-hud-launch-args.ts.
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

// Review of 2026-09-30. The hook percent-encodes `%`, space and `;` so the
// words fit the beacon's `key=value` grammar, and the parser undoes exactly
// those three. The reader then ran decodeURIComponent over the body a second
// time, so any `%XX` the person typed was decoded again: `a%20b` came out
// `a b`, and `%41` came out `A`. The copy then no longer matched its own
// transcript row, which is how a desk message is retired.
describe('a desktop prompt with a percent sign in it', () => {
  const TYPED = [
    'open https://x.com/a%20b now',
    'the code %41 here',
    '%20',
    '%',
    '%%',
    '100%',
    'a % then %zz and %4',
    'a%5Cnb',
    'done %E2%9C%93',
    'line one%0Aline two',
    '50%3B off; 20%25 more'
  ]

  it.each(TYPED)('reaches the phone byte for byte as typed: %s', (typed) => {
    expect(parseAgentHudBeaconPayload(runHook({ prompt: typed }))?.desktopPrompt?.text).toBe(typed)
  })

  // The fixtures elsewhere build this body by hand (promptHookBody); it must
  // be the one the hook writes, or they test a beacon no host sends.
  it('is written the way the fixtures build it', () => {
    const typed = 'fix "the dock"; 100% done\nC:\\Users\\a%20b\t\u00e9 \u{1F600}'
    expect(bodyOf(runHook({ prompt: typed }))).toBe(promptHookBody(typed))
  })

  it('is retired by its own transcript row', () => {
    const typed = 'open https://x.com/a%20b now'
    const copy = parseAgentHudBeaconPayload(runHook({ prompt: typed }))?.desktopPrompt
    expect(copy).toBeTruthy()
    const row: NativeChatMessage = { id: 'u1', role: 'user', blocks: [{ type: 'text', text: typed }], timestamp: 0, source: 'transcript' }
    expect(withoutLandedDesktopPrompts([copy!], [row])).toEqual([])
  })
})

// 2026-09-29, from the phone: "All 3 prompts stacked together with no
// responses in between them". A mid-turn prompt's copy names the text row it
// was typed after (`at=`), and when that row is not held (a page the chat has
// not loaded, a record Orca draws nothing for) the phone had no other clue to
// where the prompt belongs: the beacon carried no time, and the phone's own
// arrival time is its clock, not the desk's, and says nothing after a sleep,
// when every copy is read at once. The hook now says when it ran, by the desk's
// clock, the one the transcript's rows are stamped by. On Claude Code 2.1.284
// UserPromptSubmit fires at the enqueue, 21 ms after the Enter
// (mobile-chat-midturn-beacon-evidence.test.ts), so that is when it was typed.
describe('when the desktop prompt hook says the prompt was typed', () => {
  const SHELLS = ['sh', 'bash', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])]

  function beaconFrom(shell: string, path: string): { beacon: string; stdout: string } {
    const dir = mkdtempSync(join(tmpdir(), 'cuihud-typed-'))
    const tty = join(dir, 'tty')
    writeFileSync(tty, '')
    const stdout = execFileSync(shell, ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
      input: JSON.stringify({ prompt: 'typed mid-turn' }),
      encoding: 'utf8',
      env: { ...process.env, PATH: path, CUIHUD_TTY: tty }
    })
    return { beacon: decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n'), stdout }
  }

  it.each(SHELLS)('beacons the second it ran, by the desk clock (%s)', (shell) => {
    const before = Math.floor(Date.now() / 1000)
    const { beacon } = beaconFrom(shell, process.env.PATH ?? '')
    const after = Math.ceil(Date.now() / 1000)
    const ts = Number(/\bts=([0-9]+)\b/.exec(beacon)?.[1])
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
    expect(parseAgentHudBeaconPayload(beacon)?.desktopPrompt?.typedAt).toBe(ts * 1000)
  })

  // A `date` that does not know `%s` prints something else; the hook sends no
  // time rather than a wrong one, and still beacons the prompt.
  it('sends no time when the host date cannot say it, and still beacons the prompt quietly', () => {
    const shim = mkdtempSync(join(tmpdir(), 'cuihud-date-'))
    writeFileSync(join(shim, 'date'), '#!/bin/sh\necho %s\n', { mode: 0o755 })
    const { beacon, stdout } = beaconFrom('sh', `${shim}:${process.env.PATH ?? ''}`)
    expect(stdout).toBe('')
    expect(beacon).toContain('up=')
    expect(beacon).not.toContain(' ts=')
    expect(parseAgentHudBeaconPayload(beacon)?.desktopPrompt?.typedAt).toBeUndefined()
  })
})
