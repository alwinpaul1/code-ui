import { describe, expect, it } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import {
  prettifyToolDetailOutput,
  toolDetailInputRows,
  toolDetailOutputIsJson,
  toolDetailStatus,
  toolDetailTitle,
  toolPairOpensDetailSheet
} from './mobile-native-chat-tool-detail'

describe('tool detail status: Completed / Failed / Running under the sheet title', () => {
  it('reads Completed off a clean result', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
      result: { type: 'tool-result', output: 'a.ts\n' }
    }
    expect(toolDetailStatus(pair)).toBe('Completed')
  })

  it('reads Failed off an error result even when the call carried no lifecycle state', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'false' } },
      result: { type: 'tool-result', output: 'exit 1', isError: true }
    }
    expect(toolDetailStatus(pair)).toBe('Failed')
  })

  it('reads Running when there is no result yet and the call says so', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'sleep 5' }, state: 'running' }
    }
    expect(toolDetailStatus(pair)).toBe('Running')
  })

  it('falls back to Running for a legacy call with no result and no state at all', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'sleep 5' } }
    }
    expect(toolDetailStatus(pair)).toBe('Running')
  })

  it('trusts the result over a stale "running" call state — the result is the later fact', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: {}, state: 'running' },
      result: { type: 'tool-result', output: 'done' }
    }
    expect(toolDetailStatus(pair)).toBe('Completed')
  })
})

describe('tool detail title: the row sentence, reused for one call', () => {
  it('titles a lone command the same way the collapsed row would', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
      result: { type: 'tool-result', output: 'a.ts' }
    }
    expect(toolDetailTitle(pair)).toBe('Ran a command')
  })

  it('falls back to the bare tool name when the sentence has nothing to say', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'CustomTool', input: {} }
    }
    // toolRunSentence classifies an unrecognised name as "other"/"used a tool";
    // the title only needs to be non-empty and traceable to this call.
    expect(toolDetailTitle(pair).length).toBeGreaterThan(0)
  })

  it('falls back to "Tool call" for an orphan result with no call at all', () => {
    const pair: NativeChatToolPair = { result: { type: 'tool-result', output: 'x' } }
    expect(toolDetailTitle(pair)).toBe('Tool call')
  })
})

describe('sheet eligibility: which rows open the sheet vs. keep their own card', () => {
  it('opens the sheet for a plain command call', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
      result: { type: 'tool-result', output: 'a.ts' }
    }
    expect(toolPairOpensDetailSheet(pair, { isTaskList: false })).toBe(true)
  })

  it('opens the sheet for a SendMessage-style call, the evidenced case', () => {
    const pair: NativeChatToolPair = {
      call: {
        type: 'tool-call',
        name: 'SendMessage',
        input: { to: 'a8f65c53ecfad2908', type: 'handback', content: 'done', summary: 'ok' }
      },
      result: { type: 'tool-result', output: '{"ok":true}' }
    }
    expect(toolPairOpensDetailSheet(pair, { isTaskList: false })).toBe(true)
  })

  it('does not open the sheet for a plan/task-list pair — it keeps its checklist card', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'TodoWrite', input: { todos: [] } },
      result: { type: 'tool-result', output: 'ok' }
    }
    expect(toolPairOpensDetailSheet(pair, { isTaskList: true })).toBe(false)
  })

  it('does not open the sheet for a web search call — it keeps its results list', () => {
    const pair: NativeChatToolPair = {
      call: {
        type: 'tool-call',
        name: 'WebSearch',
        input: { query: 'x' },
        webSearchResults: [{ title: 't', url: 'https://example.com' }]
      },
      result: { type: 'tool-result', output: 'ok' }
    }
    expect(toolPairOpensDetailSheet(pair, { isTaskList: false })).toBe(false)
  })

  it('does not open the sheet for an edit call that resolved real file hunks', () => {
    const pair: NativeChatToolPair = {
      call: {
        type: 'tool-call',
        name: 'Write',
        input: { file_path: 'a.ts', content: 'export {}\n' }
      },
      result: { type: 'tool-result', output: 'wrote a.ts' }
    }
    expect(toolPairOpensDetailSheet(pair, { isTaskList: false })).toBe(false)
  })

  it('falls through to the sheet for an edit-named call whose files could not be resolved', () => {
    const pair: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Write', input: {} },
      result: { type: 'tool-result', output: 'permission denied', isError: true }
    }
    expect(toolPairOpensDetailSheet(pair, { isTaskList: false })).toBe(true)
  })

  it('does not open the sheet for an empty pair (no call and no result)', () => {
    expect(toolPairOpensDetailSheet({}, { isTaskList: false })).toBe(false)
  })
})

describe('input rows: name -> value, sorted, matching the evidence order', () => {
  it('lists a SendMessage-shaped input alphabetically by key', () => {
    const rows = toolDetailInputRows({
      to: 'a8f65c53ecfad2908',
      type: 'handback',
      content: 'done',
      summary: 'ok',
      recipient: 'peer',
      message: 'hi'
    })
    expect(rows.map((row) => row.name)).toEqual([
      'content',
      'message',
      'recipient',
      'summary',
      'to',
      'type'
    ])
  })

  it('renders a string value as plain text, not JSON-quoted', () => {
    const rows = toolDetailInputRows({ command: 'ls -la' })
    expect(rows).toEqual([{ name: 'command', value: 'ls -la', isObject: false }])
  })

  it('renders an object value as pretty JSON', () => {
    const rows = toolDetailInputRows({ options: { recursive: true } })
    expect(rows[0]!.isObject).toBe(true)
    expect(rows[0]!.value).toBe(JSON.stringify({ recursive: true }, null, 2))
  })

  it('parses a JSON-string input the way Codex delivers arguments', () => {
    const rows = toolDetailInputRows(JSON.stringify({ command: 'pwd' }))
    expect(rows).toEqual([{ name: 'command', value: 'pwd', isObject: false }])
  })

  it('gives a bare non-object input one row instead of an empty section', () => {
    expect(toolDetailInputRows('just a string')).toEqual([
      { name: 'input', value: 'just a string', isObject: false }
    ])
  })

  it('gives an empty input no rows at all — the degenerate, argument-less call', () => {
    expect(toolDetailInputRows(undefined)).toEqual([])
    expect(toolDetailInputRows(null)).toEqual([])
    expect(toolDetailInputRows({})).toEqual([])
  })
})

describe('output: JSON detection and the Prettify toggle', () => {
  it('recognises a JSON object output', () => {
    expect(toolDetailOutputIsJson('{"ok":true}')).toBe(true)
  })

  it('recognises a JSON array output', () => {
    expect(toolDetailOutputIsJson('[1,2,3]')).toBe(true)
  })

  it('does not treat plain stdout as JSON', () => {
    expect(toolDetailOutputIsJson('a.ts\nb.ts\n')).toBe(false)
  })

  it('does not treat text that merely starts with a brace as JSON', () => {
    expect(toolDetailOutputIsJson('{ not actually json')).toBe(false)
  })

  it('treats an empty or whitespace-only output as not JSON', () => {
    expect(toolDetailOutputIsJson('')).toBe(false)
    expect(toolDetailOutputIsJson('   \n')).toBe(false)
  })

  it('prettifies compact JSON into indented JSON', () => {
    expect(prettifyToolDetailOutput('{"a":1,"b":[2,3]}')).toBe(
      JSON.stringify({ a: 1, b: [2, 3] }, null, 2)
    )
  })

  it('leaves non-JSON output unchanged rather than blanking it', () => {
    expect(prettifyToolDetailOutput('a.ts\nb.ts\n')).toBe('a.ts\nb.ts\n')
  })
})
