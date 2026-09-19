import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_TRANSCRIPT_TAIL_STATE,
  TAIL_ROW_MAX_CHARS,
  readTranscriptTailRow,
  reduceTranscriptTail,
  type TranscriptTailRecord
} from './transcript-tail-records'
import {
  TAIL_BACKLOG_ROWS,
  isTranscriptTailTitle,
  transcriptTailCommand,
  transcriptTailFile,
  transcriptTailFileKey,
  withoutTranscriptTailTerminals
} from './transcript-tail-command'

// Rows of this machine's own transcript, Claude Code 2.1.277, 2026-09-19.
// The one with images is the first 24 000 characters of a 461 246-character
// row, which is exactly what the tail command hands the phone.
const ROWS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/claude-2.1.277-transcript-rows.json', import.meta.url)),
    'utf8'
  )
) as Record<string, string>

function reduceAll(records: TranscriptTailRecord[]) {
  return records.reduce(reduceTranscriptTail, EMPTY_TRANSCRIPT_TAIL_STATE)
}

describe('a message sent from another client while the turn ran', () => {
  it('is read off the queued_command record Orca drops', () => {
    expect(readTranscriptTailRow(ROWS.queuedCommandText!)).toEqual({
      kind: 'queued-prompt',
      uuid: '866459bd-9d42-4b6c-a7e5-cd996a3a8336',
      parentUuid: '336c16b2-2628-4793-b7cd-14b0ccd27b97',
      text: 'Use jev plugin and dig deeper into code',
      at: Date.parse('2026-09-18T22:51:04.540Z')
    })
  })

  it('keeps its text when the row was cut off inside a pasted image', () => {
    expect(ROWS.queuedCommandWithImagesTruncated!).toHaveLength(TAIL_ROW_MAX_CHARS)
    const record = readTranscriptTailRow(ROWS.queuedCommandWithImagesTruncated!)
    expect(record).toMatchObject({
      kind: 'queued-prompt',
      text: "[Image #4] [Image #5] Also see a message i send from claude mobile app isn't still here on our codeui app",
      parentUuid: 'a8a5f6f9-66dd-4c92-87dc-1715f8563897'
    })
  })

  it('shows as a prompt anchored to the row it was submitted after', () => {
    const state = reduceAll([
      readTranscriptTailRow(ROWS.queueEnqueue!),
      readTranscriptTailRow(ROWS.queueRemove!),
      readTranscriptTailRow(ROWS.queuedCommandText!)
    ])
    expect(state.prompts).toEqual([
      {
        nonce: '866459bd-9d42-4b6c-a7e5-cd996a3a8336',
        text: 'Use jev plugin and dig deeper into code',
        anchorId: '336c16b2-2628-4793-b7cd-14b0ccd27b97',
        at: Date.parse('2026-09-18T22:51:04.540Z')
      }
    ])
    expect(state.queue).toEqual([])
  })

  it('is not read twice when the tail replays its backlog', () => {
    const once = readTranscriptTailRow(ROWS.queuedCommandText!)
    expect(reduceAll([once, once]).prompts).toHaveLength(1)
  })

  it('ignores a queued command Claude issued to itself', () => {
    const row = ROWS.queuedCommandText!.replace(
      '"origin":{"kind":"human"},"timestamp":"2026-09-18T22:51:04.540Z","humanTurn":true',
      '"origin":{"kind":"system"},"timestamp":"2026-09-18T22:51:04.540Z"'
    )
    expect(row).not.toBe(ROWS.queuedCommandText)
    expect(readTranscriptTailRow(row)).toEqual({ kind: 'other' })
  })
})

describe('the queue', () => {
  it('holds a message from enqueue until it is removed', () => {
    const enqueued = reduceAll([readTranscriptTailRow(ROWS.queueEnqueue!)])
    expect(enqueued.queue).toEqual(['Use jev plugin and dig deeper into code'])
    const removed = reduceTranscriptTail(enqueued, readTranscriptTailRow(ROWS.queueRemove!))
    expect(removed.queue).toEqual([])
  })

  it('empties the queue on a dequeue that names nothing: the whole queue became the turn', () => {
    // Device, 2026-09-19: a message sent after an interrupt, then "Send
    // now" — Claude wrote `dequeue` with no content, and the entry sat in the
    // queue box for good. Rows verbatim from that session.
    expect(readTranscriptTailRow(ROWS.queueDequeueAll!)).toEqual({
      kind: 'queue-op',
      op: 'dequeue',
      content: null,
      at: Date.parse('2026-09-19T07:18:21.830Z')
    })
    const state = reduceAll([
      readTranscriptTailRow(ROWS.queueEnqueueBeforeSendNow!),
      { kind: 'queue-op', op: 'enqueue', content: 'a second one', at: null },
      readTranscriptTailRow(ROWS.queueDequeueAll!)
    ])
    expect(state.queue).toEqual([])
  })

  it('empties the queue when a person’s turn begins', () => {
    const state = reduceAll([
      { kind: 'queue-op', op: 'enqueue', content: 'waiting', at: null },
      { kind: 'user-turn' }
    ])
    expect(state.queue).toEqual([])
  })

  it('removes one copy of a repeated message, not all of them', () => {
    const state = reduceAll([
      { kind: 'queue-op', op: 'enqueue', content: 'again', at: null },
      { kind: 'queue-op', op: 'enqueue', content: 'again', at: null },
      { kind: 'queue-op', op: 'dequeue', content: 'again', at: null }
    ])
    expect(state.queue).toEqual(['again'])
  })

  it('ignores a remove for a message it never saw', () => {
    expect(reduceAll([readTranscriptTailRow(ROWS.queueRemove!)]).queue).toEqual([])
  })
})

describe('a tool call while it runs', () => {
  it('is live from its tool_use row until its tool_result row', () => {
    const started = reduceAll([readTranscriptTailRow(ROWS.assistantToolUse!)])
    expect(started.liveCall).toMatchObject({
      id: 'toolu_01LCaizgip3r8ciGESUBSTTZ',
      name: 'Bash',
      input: expect.objectContaining({
        description: 'Run the new resume tests against the unchanged components (expect red)'
      })
    })
    expect(started.liveCall?.startedAt).toBeGreaterThan(0)
    const done = reduceTranscriptTail(started, readTranscriptTailRow(ROWS.userToolResult!))
    expect(done.liveCall).toBeNull()
    expect(done.pendingCalls).toEqual([])
  })

  it('reads the call name and id off a row cut inside a long input', () => {
    const cut = ROWS.assistantToolUse!.slice(0, 320)
    expect(() => JSON.parse(cut)).toThrow()
    expect(readTranscriptTailRow(cut)).toMatchObject({
      kind: 'tool-use',
      calls: [{ id: 'toolu_01LCaizgip3r8ciGESUBSTTZ', name: 'Bash', input: undefined }]
    })
  })

  it('ends the call on a result row cut inside its output', () => {
    // A big grep or a test run: the result is longer than the tail lets
    // through, and the row arrives cut. The id comes before the output.
    const cut = ROWS.userToolResult!.slice(0, 250)
    expect(() => JSON.parse(cut)).toThrow()
    expect(readTranscriptTailRow(cut)).toEqual({
      kind: 'tool-result',
      ids: ['toolu_01LCaizgip3r8ciGESUBSTTZ'],
      at: null
    })
    const started = reduceAll([readTranscriptTailRow(ROWS.assistantToolUse!)])
    expect(reduceTranscriptTail(started, readTranscriptTailRow(cut)).liveCall).toBeNull()
  })

  it('ends whatever was live when a person types a new turn', () => {
    const started = reduceAll([readTranscriptTailRow(ROWS.assistantToolUse!)])
    expect(started.liveCall).not.toBeNull()
    const turn = readTranscriptTailRow(ROWS.plainUserTurn!)
    expect(turn).toEqual({ kind: 'user-turn' })
    expect(reduceTranscriptTail(started, turn).liveCall).toBeNull()
  })

  it('a result for an unknown call changes nothing', () => {
    const state = reduceAll([readTranscriptTailRow(ROWS.userToolResult!)])
    expect(state).toBe(EMPTY_TRANSCRIPT_TAIL_STATE)
  })
})

describe('rows that are not events', () => {
  it.each([
    ['a hook record', ROWS.hookSuccess!],
    ['the shell prompt', 'alwinpaul@mac mobile % '],
    ['a blank row', ''],
    ['half a row with no head', 'b-8e71-5bed99eaf4f0","version":"2.1.277","gitBranch":"main"}']
  ])('%s reads as other', (_label, row) => {
    expect(readTranscriptTailRow(row)).toEqual({ kind: 'other' })
  })
})

describe('the tail command', () => {
  it('follows the file, keeps only the rows the phone reads, cuts at an image, flushes per line', () => {
    const command = transcriptTailCommand(
      { kind: 'path', transcriptPath: "/Users/me/.claude/projects/a/b'c.jsonl" },
      'posix'
    )
    expect(command.startsWith(`tail -n ${TAIL_BACKLOG_ROWS} -F '/Users/me/.claude/projects/a/b'\\''c.jsonl' | awk '`)).toBe(true)
    for (const mark of [
      '"queue-operation"',
      'queued_command',
      '"role":"user","content":"',
      '"role":"user","content":[{"type":"text"'
    ]) {
      expect(command).toContain(`index($0, "${mark.replace(/"/g, '\\"')}")`)
    }
    // Tool rows fed the "Running · 12s" row, which is gone; they were most of
    // what the desktop tab showed (a LaTeX chapter in one tool result,
    // screenshot 2026-09-19).
    expect(command).not.toContain('tool_use')
    expect(command).not.toContain('tool_result')
    expect(command).toContain(`i = index($0, "\\"type\\":\\"image\\""); if (i > 0) $0 = substr($0, 1, i - 1)`)
    expect(command).toContain(`print substr($0, 1, ${TAIL_ROW_MAX_CHARS})`)
    expect(command).toContain('fflush()')
    // Plain string matching only: no regex, no intervals, every awk has these.
    expect(command).not.toMatch(/\{[0-9]+,\}/)
  })

  it('lets a prompt row through and drops a tool result, run for real through awk', () => {
    // The awk program over the real 2.1.277 rows: what leaves the host is
    // the queue operations, the queued prompt and the typed turn; the tool
    // result and the assistant row do not, and the image prompt is cut
    // before its base64.
    const command = transcriptTailCommand({ kind: 'path', transcriptPath: '/tmp/x.jsonl' }, 'posix')
    const program = command.slice(command.indexOf("awk '") + 5, command.lastIndexOf("'"))
    const input = Object.values(ROWS).join('\n') + '\n'
    const out = execFileSync('awk', [program], { input, encoding: 'utf8' })
    const lines = out.split('\n').filter((line) => line.length > 0)
    expect(lines.some((line) => line.includes('"queue-operation"'))).toBe(true)
    expect(lines.some((line) => line.includes('queued_command'))).toBe(true)
    expect(lines.some((line) => line.includes('"role":"user","content":"'))).toBe(true)
    expect(lines.some((line) => line.includes('tool_result'))).toBe(false)
    expect(lines.some((line) => line.includes('"type":"assistant"'))).toBe(false)
    expect(lines.some((line) => line.includes('"type":"image"'))).toBe(false)
    expect(lines.every((line) => line.length <= TAIL_ROW_MAX_CHARS)).toBe(true)
  })

  it('is a PowerShell Get-Content -Wait on Windows', () => {
    const command = transcriptTailCommand(
      { kind: 'path', transcriptPath: "C:\\Users\\me\\.claude\\projects\\a\\b'c.jsonl" },
      'win32'
    )
    expect(command).toContain(`Get-Content -LiteralPath 'C:\\Users\\me\\.claude\\projects\\a\\b''c.jsonl' -Tail ${TAIL_BACKLOG_ROWS} -Wait`)
    expect(command).toContain(`Substring(0, ${TAIL_ROW_MAX_CHARS})`)
    expect(command).toContain(`$_.Contains('queued_command')`)
    expect(command).toContain(`IndexOf('"type":"image"')`)
  })

  it('is dropped from the strip and the terminal list, and nothing else is', () => {
    const tabs = [
      { type: 'terminal', id: 'a', title: 'Code UI · transcript' },
      { type: 'terminal', id: 'b', title: 'claude' },
      { type: 'markdown', id: 'c', title: 'Code UI · transcript' },
      { type: 'file', id: 'd', title: 'notes.md' }
    ]
    expect(withoutTranscriptTailTerminals(tabs).map((tab) => tab.id)).toEqual(['b', 'c', 'd'])
    const terminals = [
      { handle: 't1', title: 'Code UI · transcript' },
      { handle: 't2', title: 'zsh' }
    ]
    expect(withoutTranscriptTailTerminals(terminals).map((t) => t.handle)).toEqual(['t2'])
    expect(withoutTranscriptTailTerminals([])).toEqual([])
    // The host adopted the tail as "Terminal 3" and dropped the title
    // (device, 2026-09-19): the handle this process holds still hides it.
    const adopted = [
      { type: 'terminal', id: 'a', title: 'Terminal 3', terminal: 'term_tail' },
      { type: 'terminal', id: 'b', title: 'Terminal 4', terminal: 'term_user' }
    ]
    expect(withoutTranscriptTailTerminals(adopted, new Set(['term_tail'])).map((t) => t.id)).toEqual(['b'])
    expect(withoutTranscriptTailTerminals([{ handle: 'term_tail', title: 'Terminal 3' }], new Set(['term_tail']))).toEqual([])
  })

  it('finds the file by session id under the projects dir when no path was disclosed', () => {
    // A hand-started session: the host learned the id from the agent's own
    // hook, and the phone never got a path (device, 2026-09-19 — no tail
    // terminal opened). The glob is unquoted so the shell expands the slug.
    const file = transcriptTailFile(null, '7449d614-3e02-439b-8e71-5bed99eaf4f0')
    expect(file).toEqual({ kind: 'session', sessionId: '7449d614-3e02-439b-8e71-5bed99eaf4f0' })
    expect(
      transcriptTailCommand(file!, 'posix').startsWith(
        `tail -n ${TAIL_BACKLOG_ROWS} -F "$HOME"/.claude/projects/*/7449d614-3e02-439b-8e71-5bed99eaf4f0.jsonl | awk '`
      )
    ).toBe(true)
    expect(transcriptTailCommand(file!, 'win32')).toContain(
      'Get-ChildItem -Path "$env:USERPROFILE\\.claude\\projects\\*\\7449d614-3e02-439b-8e71-5bed99eaf4f0.jsonl"'
    )
  })

  it('prefers a disclosed path, and refuses an id that is not one', () => {
    expect(transcriptTailFile('/a/b.jsonl', 'abcdefgh')).toEqual({ kind: 'path', transcriptPath: '/a/b.jsonl' })
    expect(transcriptTailFile(null, 'short')).toBeNull()
    expect(transcriptTailFile(null, 'has space in it')).toBeNull()
    expect(transcriptTailFile(null, '../../etc/passwd')).toBeNull()
    expect(transcriptTailFile(null, null)).toBeNull()
    expect(transcriptTailFileKey({ kind: 'session', sessionId: 'abcdefgh' })).toBe('session:abcdefgh')
  })

  it('names its tab so the phone can hide it', () => {
    expect(isTranscriptTailTitle('Code UI · transcript')).toBe(true)
    expect(isTranscriptTailTitle(' Code UI · transcript ')).toBe(true)
    expect(isTranscriptTailTitle('Terminal 2')).toBe(false)
    expect(isTranscriptTailTitle(null)).toBe(false)
  })
})
