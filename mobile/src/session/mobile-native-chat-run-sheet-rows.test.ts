import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { agentRunState } from './mobile-native-chat-agent-run'
import { runSheetRows, type RunSheetRow } from './mobile-native-chat-run-sheet-rows'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import {
  MIXED_RUN_AGENT_DESCRIPTION,
  MIXED_RUN_AGENT_ID,
  MIXED_RUN_BASH_DESCRIPTIONS,
  mixedRunWithBackgroundAgent
} from './fixtures/claude-mixed-tool-run-agent-2026-10-01'
import { CODE_MODE_POLL, CODE_MODE_START } from './fixtures/codex-code-mode-exec-cells-0.153.4'

/** A row as the sheet draws it: verb and detail, the way the screenshot reads. */
function drawn(row: RunSheetRow): string {
  return row.detail ? `${row.verb}  ${row.detail}` : row.verb
}

const rowsOf = (blocks: NativeChatBlock[]) => runSheetRows(blocks, [])

describe("the Claude app's sheet for CronDelete, three commands and an agent (2026-10-01)", () => {
  it('lists each call as its verb and description, in run order', () => {
    const rows = runSheetRows(mixedRunWithBackgroundAgent(), [{ title: MIXED_RUN_AGENT_DESCRIPTION, agentId: MIXED_RUN_AGENT_ID }])
    expect(rows.map(drawn)).toEqual([
      'Used CronDelete  id',
      `Ran  ${MIXED_RUN_BASH_DESCRIPTIONS[0]}`,
      `Ran  ${MIXED_RUN_BASH_DESCRIPTIONS[1]}`,
      `Ran  ${MIXED_RUN_BASH_DESCRIPTIONS[2]}`,
      `Ran agent  ${MIXED_RUN_AGENT_DESCRIPTION}`
    ])
  })

  it('shows no raw tool input: not the command, not the JSON of the CronDelete', () => {
    const shown = rowsOf(mixedRunWithBackgroundAgent()).map(drawn).join('\n')
    expect(shown).not.toContain('ssh')
    expect(shown).not.toContain('80ceeb4b')
    expect(shown).not.toContain('{')
  })

  it('mutes the input key of a tool the phone has no verb for, and nothing else', () => {
    const rows = rowsOf(mixedRunWithBackgroundAgent())
    expect(rows.map((row) => row.detailIsKey)).toEqual([true, false, false, false, false])
  })

  it('titles the sheet with the past-tense sentence, even while the agent runs', () => {
    expect(toolRunSentence(mixedRunWithBackgroundAgent(), 0)).toBe('Used a tool, ran 3 commands, ran an agent')
  })

  it('hands the agent row the id of the agent its call launched, and no other row one', () => {
    const blocks = mixedRunWithBackgroundAgent()
    const entries = agentRunState(blocks, {
      runningIds: new Set([MIXED_RUN_AGENT_ID]),
      confirmed: new Map(),
      agentWorking: false
    }).entries
    expect(runSheetRows(blocks, entries).map((row) => row.agentId)).toEqual([null, null, null, null, MIXED_RUN_AGENT_ID])
  })

  it('keeps each call with its own result, so a tap opens that call', () => {
    const rows = rowsOf(mixedRunWithBackgroundAgent())
    expect(rows[0]!.pair.result?.output).toBe('Cancelled scheduled task 80ceeb4b')
    expect(rows[2]!.pair.call?.input).toMatchObject({ description: MIXED_RUN_BASH_DESCRIPTIONS[1] })
  })
})

describe('the verbs for every kind of call', () => {
  const call = (name: string, input: unknown, output = ''): NativeChatBlock[] => [
    { type: 'tool-call', name, input },
    { type: 'tool-result', output }
  ]

  it('names a read by its file, an edit by its file, a new file as created', () => {
    expect(drawn(rowsOf(call('Read', { file_path: '/repo/src/app.ts' }))[0]!)).toBe('Read  app.ts')
    expect(drawn(rowsOf(call('Edit', { file_path: '/repo/src/b.ts', old_string: 'a', new_string: 'b' }))[0]!)).toBe('Edited  b.ts')
    expect(
      drawn(
        rowsOf(call('Write', { file_path: '/repo/NEW.md', content: 'x\n' }, 'File created successfully at: /repo/NEW.md'))[0]!
      )
    ).toBe('Created  NEW.md')
  })

  it('says searched, fetched and searched the web for the calls that did', () => {
    expect(drawn(rowsOf(call('Grep', { pattern: 'TODO' }))[0]!)).toBe('Searched  TODO')
    expect(drawn(rowsOf(call('WebFetch', { url: 'https://example.com/a' }))[0]!)).toBe('Fetched  https://example.com/a')
    expect(drawn(rowsOf(call('WebSearch', { query: 'rn flashlist' }))[0]!)).toBe('Searched the web  rn flashlist')
  })

  it('names a skill and a message by what they name', () => {
    expect(drawn(rowsOf(call('Skill', { skill: 'unslop' }))[0]!)).toBe('Ran skill  unslop')
    expect(
      drawn(rowsOf(call('SendMessage', { to: 'probe', summary: 'ack the plan', message: 'long text' }))[0]!)
    ).toBe('Messaged  @probe ack the plan')
  })

  it('reads a command with no description by its command, never as JSON', () => {
    expect(drawn(rowsOf(call('Bash', { command: 'ls -la' }))[0]!)).toBe('Ran  ls -la')
  })

  it('draws a Codex exec_command by the command it ran', () => {
    const rows = rowsOf(call('exec_command', { cmd: 'sleep 90', yield_time_ms: 1000 }))
    expect(drawn(rows[0]!)).toBe('Ran  sleep 90')
    expect(rows[0]!.kind).toBe('command')
  })

  it('draws a Codex code-mode cell, and folds the poll of the command it started', () => {
    const rows = rowsOf([
      ...call('exec', CODE_MODE_START),
      ...call('exec', CODE_MODE_POLL(1000)),
      ...call('exec', CODE_MODE_POLL(1000))
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.verb).toBe('Ran')
  })
})

describe('the odd shapes a run can hold', () => {
  it('draws a tool with no input as its name alone, with no muted key', () => {
    const rows = rowsOf([{ type: 'tool-call', name: 'CronList', input: {} }, { type: 'tool-result', output: '[]' }])
    expect(rows).toHaveLength(1)
    expect(drawn(rows[0]!)).toBe('Used CronList')
    expect(rows[0]!.detailIsKey).toBe(false)
  })

  it('draws a tool whose input is a bare string without inventing a key', () => {
    const rows = rowsOf([{ type: 'tool-call', name: 'Foo', input: 'just text' }])
    expect(drawn(rows[0]!)).toBe('Used Foo')
  })

  it('takes the first input key from a Codex call whose arguments arrive as a JSON string', () => {
    const rows = rowsOf([{ type: 'tool-call', name: 'CronDelete', input: '{"id":"80ceeb4b"}' }])
    expect(drawn(rows[0]!)).toBe('Used CronDelete  id')
    expect(rows[0]!.detailIsKey).toBe(true)
  })

  it('draws a result whose call the window cut as its first line', () => {
    const rows = rowsOf([{ type: 'tool-result', output: '\nfirst line\nsecond' }])
    expect(rows).toHaveLength(1)
    expect(drawn(rows[0]!)).toBe('Result  first line')
    expect(rows[0]!.pair.call).toBeUndefined()
  })

  it('marks a failed call by its error result, and one failed by its own state alone', () => {
    const rows = rowsOf([
      { type: 'tool-call', name: 'Bash', input: { command: 'false', description: 'Run the check' } },
      { type: 'tool-result', output: 'exit 1', isError: true },
      { type: 'tool-call', name: 'Bash', input: { command: 'true' } },
      { type: 'tool-result', output: '' },
      { type: 'tool-call', name: 'Bash', input: { command: 'true' }, state: 'failed' }
    ])
    expect(rows.map((row) => row.failed)).toEqual([true, false, true])
    expect(drawn(rows[0]!)).toBe('Ran  Run the check')
  })

  it('draws a call still running in the past tense, like the agent the screenshot shows', () => {
    const rows = rowsOf([{ type: 'tool-call', name: 'Bash', input: { command: 'sleep 9' }, state: 'running' }])
    expect(drawn(rows[0]!)).toBe('Ran  sleep 9')
  })

  it('gives no rows for an empty run', () => {
    expect(rowsOf([])).toEqual([])
  })

  it('gives one row for one call', () => {
    expect(rowsOf([{ type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } }])).toHaveLength(1)
  })

  it('lists all 120 calls of a long run, with no cap', () => {
    const blocks: NativeChatBlock[] = []
    for (let i = 0; i < 120; i++) {
      blocks.push({ type: 'tool-call', name: 'Bash', input: { command: `echo ${i}`, description: `Step ${i}` } })
      blocks.push({ type: 'tool-result', output: String(i) })
    }
    const rows = rowsOf(blocks)
    expect(rows).toHaveLength(120)
    expect(drawn(rows[119]!)).toBe('Ran  Step 119')
  })

  it('leaves an agent row with no id when the run knows fewer agents than it has calls', () => {
    const blocks: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Agent', input: { description: 'one' } },
      { type: 'tool-call', name: 'Task', input: { description: 'two' } }
    ]
    const rows = runSheetRows(blocks, [{ title: 'one', agentId: 'a1' }])
    expect(rows.map((row) => row.agentId)).toEqual(['a1', null])
  })
})
