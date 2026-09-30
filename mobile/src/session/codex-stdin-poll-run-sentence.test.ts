import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolRunSentence, toolRunSentenceShowsFailures } from './mobile-native-chat-tool-sentence'
import { CODE_MODE_POLL, CODE_MODE_START } from './fixtures/codex-code-mode-exec-cells-0.153.4'

// One Codex command read "Ran 5 commands" when Codex polled it four times.
// Unified exec starts a long command with exec_command and, while it runs,
// polls its session with write_stdin calls whose `chars` is empty ("Writes
// characters to an existing unified exec session", codex-rs/core/src/tools/
// handlers/shell_spec.rs at rust-v0.153.4); the run sentence counted every
// poll as a command of its own. A Claude run of the same work reads "Ran a
// command" (review, 2026-09-30).

function call(name: string, input: unknown = {}): NativeChatBlock {
  return { type: 'tool-call', name, input }
}
function result(output = '', isError = false): NativeChatBlock {
  return { type: 'tool-result', output, ...(isError ? { isError: true } : {}) }
}
function poll(session: number): NativeChatBlock[] {
  return [call('write_stdin', { session_id: session, chars: '' }), result()]
}

describe('a Codex command polled with write_stdin reads as the one command it is', () => {
  it('reads one exec_command polled four times as "Ran a command", as a Claude run of the same work reads', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test' }),
      result(),
      ...poll(3),
      ...poll(3),
      ...poll(3),
      ...poll(3)
    ]
    expect(toolRunSentence(blocks)).toBe('Ran a command')
    expect(toolRunSentence([call('Bash', { command: 'npm test' }), result()])).toBe('Ran a command')
  })

  it('reads the function-call arguments Codex writes as a JSON string the same way', () => {
    const blocks = [
      call('exec_command', JSON.stringify({ cmd: 'npm test' })),
      result(),
      call('write_stdin', JSON.stringify({ session_id: 3, chars: '', yield_time_ms: 30000 })),
      result(),
      call('write_stdin', JSON.stringify({ session_id: 3, chars: '', yield_time_ms: 30000 })),
      result()
    ]
    expect(toolRunSentence(blocks)).toBe('Ran a command')
  })

  it('reads a code-mode exec cell that polls the command it started as that command (Codex 0.153.4)', () => {
    const blocks = [
      call('exec', CODE_MODE_START),
      result(),
      call('exec', CODE_MODE_POLL(50000)),
      result('Script running with cell ID 2\nWall time 31.0 seconds\nOutput:\n'),
      call('exec', CODE_MODE_POLL(1000)),
      result(),
      call('exec', CODE_MODE_POLL(30000)),
      result()
    ]
    expect(toolRunSentence(blocks)).toBe('Ran a command')
  })

  it('keeps a single described command labelled by its description through its polls', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test', description: 'Run the tests' }),
      result(),
      ...poll(3),
      ...poll(3)
    ]
    expect(toolRunSentence(blocks)).toBe('Ran Run the tests')
  })

  it('counts a write_stdin that types real input as a command of its own', () => {
    expect(
      toolRunSentence([
        call('exec_command', { cmd: 'npm init' }),
        result(),
        call('write_stdin', { session_id: 3, chars: 'y\n' }),
        result()
      ])
    ).toBe('Ran 2 commands')
    expect(
      toolRunSentence([
        call('exec', CODE_MODE_START),
        result(),
        call('exec', 'text(await tools.write_stdin({session_id:68964,chars:"q",yield_time_ms:1000}));\n'),
        result()
      ])
    ).toBe('Ran 2 commands')
  })

  it('counts two exec_commands that are each polled as two commands', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test' }),
      result(),
      ...poll(3),
      call('exec_command', { cmd: 'npm run build' }),
      result(),
      ...poll(4),
      ...poll(4)
    ]
    expect(toolRunSentence(blocks)).toBe('Ran 2 commands')
  })

  it('counts a poll as the command it drives when the run holds no exec_command', () => {
    // The command started in an earlier run; this run only waits on it.
    expect(toolRunSentence(poll(3))).toBe('Ran a command')
    expect(toolRunSentence([...poll(3), ...poll(3), ...poll(3)])).toBe('Ran a command')
    expect(toolRunSentence([...poll(3), ...poll(4)])).toBe('Ran 2 commands')
  })

  it('counts every poll whose session it cannot read, rather than guess they are one', () => {
    const blind = [call('write_stdin', { chars: '' }), result(), call('write_stdin', { chars: '' }), result()]
    expect(toolRunSentence(blind)).toBe('Ran 2 commands')
    // Input that is not a write_stdin shape at all stays a command.
    expect(toolRunSentence([call('write_stdin', 'not json'), result()])).toBe('Ran a command')
  })

  it("leaves a folded poll's failure to the run header instead of dropping it", () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test' }),
      result(),
      call('write_stdin', { session_id: 3, chars: '' }),
      result('Process exited with code 1', true)
    ]
    expect(toolRunSentence(blocks)).toBe('Ran a command')
    // The sentence does not say the failure, so the header draws its own label.
    expect(toolRunSentenceShowsFailures(blocks, 1)).toBe(false)
  })

  it('still reads a run that is empty, or only a poll that failed', () => {
    expect(toolRunSentence([])).toBe('')
    expect(toolRunSentence([call('write_stdin', { session_id: 3, chars: '' }), result('', true)])).toBe(
      'Ran a command (1 failed)'
    )
  })
})
