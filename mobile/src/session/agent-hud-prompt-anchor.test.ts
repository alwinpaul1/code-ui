import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'
import { decodeAgentHudChannelText } from './agent-hud-channel'

// Real row shapes, taken from a live Claude Code 2.1.270 transcript on
// 2026-09-15 (~/.claude/projects/.../15f3d17a…jsonl). The last six user or
// assistant rows of a working turn were:
//
//   assistant tool_use · user tool_result · assistant tool_use
//   user tool_result · assistant thinking · assistant text
//
// On the device that day a uuid naming any but the LAST of those was not
// found: the echo fell back to the arrival tail, and every desktop prompt of a
// turn stacked at the bottom under its own replies (device screenshots,
// 2026-09-15). So the hook anchors only on text rows.
//
// The reason given then, that Orca folds tool activity away and drops
// thinking, is not what Orca 1.4.216 does. Its transcript decoder (`rEn`/`KTn`
// in app.asar, read 2026-09-29) makes a row of each of those records, keyed by
// the record uuid: tool calls and results as tool rows, thinking as text. The
// exclusion is kept because a text row is held either way, while a tool-row
// anchor is found only if those rows reach the phone under that uuid, and no
// device has shown that since. It cost this: a message typed after a call,
// with no text since, drew above that call (usually one), where the Claude
// app draws it below. The hook's `ts=` (2026-09-29) now moves it below the rows
// written before it was typed (mobile-chat-stacked-desk-prompts.test.ts); a
// tab whose hook sends no time still pays it.
function row(uuid: string, type: 'user' | 'assistant', contentType: string): string {
  const content =
    contentType === 'string'
      ? '"a plain prompt"'
      : `[{"type":"${contentType}","text":"x"}]`
  return JSON.stringify({ type, uuid, message: { role: type, content: JSON.parse(content) } })
}

function anchorFor(lines: string[], shell = 'sh'): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-anchor-'))
  const transcript = join(dir, 'session.jsonl')
  writeFileSync(transcript, lines.join('\n') + '\n')
  const tty = join(dir, 'pty')
  writeFileSync(tty, '')
  execFileSync(shell, ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
    input: JSON.stringify({ prompt: 'hello', transcript_path: transcript }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: dir, CUIHUD_TTY: tty }
  })
  // The payload the phone decodes, not the raw channel bytes the hook wrote.
  const beacon = decodeAgentHudChannelText(execFileSync('cat', [tty], { encoding: 'latin1' })).join('\n')
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

// 2026-09-29, Claude Code 2.1.284 (the session behind
// mobile-chat-midturn-prompt-after-reply.test.ts): a message typed at 05:36:34,
// right after the text Claude wrote at 05:36:16, was beaconed as typed after
// the prompt that OPENED the turn, at 05:08. 2.1.284 writes the message's
// `"stop_reason":"tool_use"` into every record of a turn that goes on to call a
// tool, the text records included, and the hook skipped any record with the
// word `"tool_use"` anywhere in it. So every text row of a working turn was
// skipped, and the anchor fell back past all of them to the last typed prompt.
//
// The lines are built by hand in the shape 2.1.284 writes (key order, the
// envelope fields, one content block per record, `stop_reason` and `usage` on
// every assistant record). The uuids and times are that session's own; the
// words, ids and paths are placeholders.
const CC_2_1_284 = {
  opening:
    '{"parentUuid":"5b0e9c1a-7f3d-4e21-9a54-0c6f2d8e1b37","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","type":"user","message":{"role":"user","content":"the prompt that opened the turn"},"uuid":"d01807a3-bea6-4f29-8a97-bc9a106d86ae","timestamp":"2026-09-29T05:08:00.467Z","promptSource":"typed","permissionMode":"default"}',
  textBeforeFirst:
    '{"parentUuid":"9e3a4c21-6b7d-4f80-8c15-2a9d0e6f7b43","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","message":{"model":"claude-opus-5","id":"msg_01Vb3kQm8xN2pRz7aT5yLw4E","type":"message","role":"assistant","content":[{"type":"text","text":"Now the sign-in path."}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":388,"cache_read_input_tokens":150204,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":388},"output_tokens":214,"service_tier":"standard"}},"requestId":"req_011CWq7nB2xY4pK9mR3tZ8vA","type":"assistant","uuid":"fed3dc95-5dba-4516-8d8d-4cebbbae8078","timestamp":"2026-09-29T05:34:51.297Z"}',
  callBeforeFirst:
    '{"parentUuid":"fed3dc95-5dba-4516-8d8d-4cebbbae8078","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","message":{"model":"claude-opus-5","id":"msg_01Vb3kQm8xN2pRz7aT5yLw4E","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01Hc5nW2qZ8rT4mK7yB3vX6P","name":"Bash","input":{"command":"npx vitest run auth","description":"Run the auth tests"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":388,"cache_read_input_tokens":150204,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":388},"output_tokens":214,"service_tier":"standard"}},"requestId":"req_011CWq7nB2xY4pK9mR3tZ8vA","type":"assistant","uuid":"0465a647-17fa-40a0-b277-87f5fd3561b2","timestamp":"2026-09-29T05:34:55.802Z"}',
  firstEnqueued:
    '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-09-29T05:36:01.523Z","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","content":"the first mid-turn message"}',
  resultBeforeFirst:
    '{"parentUuid":"0465a647-17fa-40a0-b277-87f5fd3561b2","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01Hc5nW2qZ8rT4mK7yB3vX6P","type":"tool_result","content":"Test Files  4 passed (4)","is_error":false}]},"uuid":"fb42a005-40bf-4394-9b6c-f75dbb436f95","timestamp":"2026-09-29T05:36:02.163Z","toolUseResult":{"stdout":"Test Files  4 passed (4)","stderr":"","interrupted":false,"isImage":false},"sourceToolAssistantUUID":"0465a647-17fa-40a0-b277-87f5fd3561b2"}',
  firstRemoved:
    '{"type":"queue-operation","operation":"remove","timestamp":"2026-09-29T05:36:02.185Z","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","reason":"absorbed_mid_turn"}',
  firstQueued:
    '{"parentUuid":"fb42a005-40bf-4394-9b6c-f75dbb436f95","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","type":"attachment","attachment":{"type":"queued_command","prompt":"the first mid-turn message","commandMode":"prompt","origin":"human"},"uuid":"3c1d7e9f-0a42-4b6e-8d15-7f2a9c4e1b08","timestamp":"2026-09-29T05:36:01.523Z"}',
  /** The row the second message was typed after. */
  textBeforeSecond:
    '{"parentUuid":"3c1d7e9f-0a42-4b6e-8d15-7f2a9c4e1b08","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","message":{"model":"claude-opus-5","id":"msg_01Kp8rD4wQ2mX7nB5tY9zL3F","type":"message","role":"assistant","content":[{"type":"text","text":"Those pass. Checking the session sweep next."}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":512,"cache_read_input_tokens":150592,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":512},"output_tokens":187,"service_tier":"standard"}},"requestId":"req_011CWq8aF5tH2nJ7kP4xR9wC","type":"assistant","uuid":"c87c6d3e-1a98-4946-a845-df1e58f12acc","timestamp":"2026-09-29T05:36:16.011Z"}',
  callBeforeSecond:
    '{"parentUuid":"c87c6d3e-1a98-4946-a845-df1e58f12acc","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","message":{"model":"claude-opus-5","id":"msg_01Kp8rD4wQ2mX7nB5tY9zL3F","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01Rm4xK8pW2nZ6tB9yH3vQ7D","name":"Grep","input":{"pattern":"endSessions","path":"src"}}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":512,"cache_read_input_tokens":150592,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":512},"output_tokens":187,"service_tier":"standard"}},"requestId":"req_011CWq8aF5tH2nJ7kP4xR9wC","type":"assistant","uuid":"c23a95c6-02db-4b9d-9c85-eb30b5d479ce","timestamp":"2026-09-29T05:36:25.066Z"}',
  secondEnqueued:
    '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-09-29T05:36:34.891Z","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","content":"the second mid-turn message"}',
  /** A thinking block of the same turn, in the same envelope. */
  thinking:
    '{"parentUuid":"c87c6d3e-1a98-4946-a845-df1e58f12acc","isSidechain":false,"userType":"external","cwd":"/Users/dev/app","sessionId":"4f6c0f7e-2b1d-4c58-9a3e-2d1f0c7b9a11","version":"2.1.284","gitBranch":"main","message":{"model":"claude-opus-5","id":"msg_01Kp8rD4wQ2mX7nB5tY9zL3F","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"The sweep is in the session store.","signature":"EqQBCkYIBhgCKkA2"}],"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":512,"cache_read_input_tokens":150592,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":512},"output_tokens":187,"service_tier":"standard"}},"requestId":"req_011CWq8aF5tH2nJ7kP4xR9wC","type":"assistant","uuid":"7a2e5c90-3f1b-4d68-b0a4-9e6c2d8f5a17","timestamp":"2026-09-29T05:36:20.402Z"}'
}

/** The transcript as the second message's hook read it, 05:36:34.891. */
const AT_SECOND_SUBMIT = [
  CC_2_1_284.opening,
  CC_2_1_284.textBeforeFirst,
  CC_2_1_284.callBeforeFirst,
  CC_2_1_284.firstEnqueued,
  CC_2_1_284.resultBeforeFirst,
  CC_2_1_284.firstRemoved,
  CC_2_1_284.firstQueued,
  CC_2_1_284.textBeforeSecond,
  CC_2_1_284.callBeforeSecond,
  CC_2_1_284.secondEnqueued
]

// Codex has no prompt hook: its notify runs at a turn's end and carries no
// prompt, so this anchor is Claude Code's alone.
describe('the row a mid-turn message is anchored to, on Claude Code 2.1.284', () => {
  // The host's own shell: macOS's sh is bash in POSIX mode, Debian's is dash.
  it.each(['sh', 'bash', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])])(
    'names the text the message was typed after, not the prompt that opened the turn (%s)',
    (shell) => {
      expect(anchorFor(AT_SECOND_SUBMIT, shell)).toBe('c87c6d3e-1a98-4946-a845-df1e58f12acc')
    }
  )

  it('skips a thinking block that carries the same stop reason', () => {
    expect(
      anchorFor([CC_2_1_284.opening, CC_2_1_284.textBeforeSecond, CC_2_1_284.thinking, CC_2_1_284.callBeforeSecond])
    ).toBe('c87c6d3e-1a98-4946-a845-df1e58f12acc')
  })

  it('names the only text of a turn when that is all there is', () => {
    expect(anchorFor([CC_2_1_284.textBeforeSecond])).toBe('c87c6d3e-1a98-4946-a845-df1e58f12acc')
  })

  it('still skips the call and the result, and a turn of nothing else names no row', () => {
    expect(anchorFor([CC_2_1_284.callBeforeFirst, CC_2_1_284.resultBeforeFirst, CC_2_1_284.firstQueued])).toBe(
      null
    )
  })

  it('names no row for an empty transcript', () => {
    expect(anchorFor([])).toBe(null)
  })

  // Second review of 029bdd04. Orca 1.4.216's transcript decoder (`rEn` and
  // `KTn` in its app.asar, read 2026-09-29) makes a row only from text,
  // thinking, tool_use, tool_result and image blocks, and drops a record with
  // none of them. The bare-word rule skipped these records only because 2.1.284
  // stamps them `"stop_reason":"tool_use"`; skipping by the tool types alone
  // named them, a row the phone never holds. Shapes built by hand in the
  // 2.1.284 envelope, not captured live: these blocks are rare in a session.
  it('skips a redacted thinking block, which Orca draws as no row', () => {
    const redacted = CC_2_1_284.thinking
      .replace('{"type":"thinking","thinking":"The sweep is in the session store.","signature":"EqQBCkYIBhgCKkA2"}', '{"type":"redacted_thinking","data":"EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rL"}')
      .replace('7a2e5c90-3f1b-4d68-b0a4-9e6c2d8f5a17', 'e1111111-1111-4111-8111-111111111111')
    expect(redacted).toContain('"type":"redacted_thinking"')
    expect(anchorFor([CC_2_1_284.opening, CC_2_1_284.textBeforeSecond, redacted, CC_2_1_284.callBeforeSecond])).toBe(
      'c87c6d3e-1a98-4946-a845-df1e58f12acc'
    )
  })

  it('skips a web search call and its result, which Orca draws as no row', () => {
    const block = (content: string, uuid: string) =>
      CC_2_1_284.callBeforeSecond
        .replace('{"type":"tool_use","id":"toolu_01Rm4xK8pW2nZ6tB9yH3vQ7D","name":"Grep","input":{"pattern":"endSessions","path":"src"}}', content)
        .replace('c23a95c6-02db-4b9d-9c85-eb30b5d479ce', uuid)
    const search = block('{"type":"server_tool_use","id":"srvtoolu_01AbCdEf","name":"web_search","input":{"query":"session sweep"}}', 'e2222222-2222-4222-8222-222222222222')
    const found = block(
      '{"type":"web_search_tool_result","tool_use_id":"srvtoolu_01AbCdEf","content":[{"type":"web_search_result","title":"t","url":"https://example.com","encrypted_content":"abc","page_age":null}]}',
      'e3333333-3333-4333-8333-333333333333'
    )
    expect(search).toContain('"type":"server_tool_use"')
    expect(found).toContain('"type":"web_search_tool_result"')
    expect(anchorFor([CC_2_1_284.opening, CC_2_1_284.textBeforeSecond, search, found])).toBe(
      'c87c6d3e-1a98-4946-a845-df1e58f12acc'
    )
  })

  it('still names a typed prompt that carries a pasted image', () => {
    const withImage = CC_2_1_284.opening
      .replace(
        '"content":"the prompt that opened the turn"',
        '"content":[{"type":"text","text":"[Image #1] what is this"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0KGgo="}}]'
      )
    expect(withImage).toContain('"type":"image"')
    expect(anchorFor([CC_2_1_284.textBeforeSecond, withImage, CC_2_1_284.callBeforeSecond])).toBe(
      'd01807a3-bea6-4f29-8a97-bc9a106d86ae'
    )
  })

  // What a record SAYS is escaped in the JSON, so words that quote a tool
  // block's type are not the block's type.
  it('keeps a text row whose words quote a tool block', () => {
    const quoting = CC_2_1_284.textBeforeSecond.replace(
      'Those pass. Checking the session sweep next.',
      'The hook skipped every record with \\"type\\":\\"tool_use\\" or \\"tool_result\\" in it.'
    )
    expect(quoting).toContain('\\"type\\":\\"tool_use\\"')
    expect(anchorFor([CC_2_1_284.opening, quoting, CC_2_1_284.callBeforeSecond])).toBe(
      'c87c6d3e-1a98-4946-a845-df1e58f12acc'
    )
  })
})
