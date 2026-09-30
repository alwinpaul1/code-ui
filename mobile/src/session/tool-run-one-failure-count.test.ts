import { describe, expect, it } from 'vitest'
import { nativeChatToolRunOutcome } from '../../../src/shared/native-chat-tool-run-outcome'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { CODE_MODE_POLL, CODE_MODE_START } from './fixtures/codex-code-mode-exec-cells-0.153.4'
import { toolRunSentence, toolRunSentenceShowsFailures } from './mobile-native-chat-tool-sentence'

// A Codex exec_command that failed, polled once by a write_stdin that failed
// too, read "Ran a command (1 failed)" with a "2 failed" label beside it: two
// different failure counts for one run (regression from the write_stdin poll
// fold, 4f1a6153). The fold gives a folded poll's result to no group, so the
// sentence counted the start's error and not the poll's, while the header's
// label counts every error result (vendored nativeChatToolRunOutcome). A call
// known to have failed only from its own `failed` state is the same shape.
// Now a sentence that can count fewer failures than the run had states none,
// and the label carries the total (review, 2026-09-30).

function call(name: string, input: unknown = {}, state?: 'failed'): NativeChatBlock {
  return { type: 'tool-call', name, input, ...(state ? { state } : {}) }
}
function result(output = '', isError = false): NativeChatBlock {
  return { type: 'tool-result', output, ...(isError ? { isError: true } : {}) }
}

/** What the collapsed row states about failures, worked out as ToolRun does:
 *  the sentence given the run's own count, and the header's "N failed" label
 *  wherever the sentence does not show every failure. */
function row(blocks: readonly NativeChatBlock[]): { sentence: string; label: string | null } {
  const { failedCallCount } = nativeChatToolRunOutcome(blocks, {})
  const said = toolRunSentenceShowsFailures(blocks, failedCallCount)
  return {
    sentence: toolRunSentence(blocks, failedCallCount),
    label: failedCallCount > 0 && !said ? `${failedCallCount} failed` : null
  }
}

/** Every failure count the row draws, in the sentence and on the label. */
function countsDrawn({ sentence, label }: { sentence: string; label: string | null }): number[] {
  const counts = [...sentence.matchAll(/\((\d+) failed\)/g)].map((match) => Number(match[1]))
  return label ? [...counts, Number.parseInt(label, 10)] : counts
}

const FAILED = 'Process exited with code 1'

describe('a run row draws one failure count, never two different ones', () => {
  it('reads a failed exec_command whose poll failed too as "Ran a command" and "2 failed"', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test' }),
      result(FAILED, true),
      call('write_stdin', { session_id: 3 }),
      result(FAILED, true)
    ]
    expect(row(blocks)).toEqual({ sentence: 'Ran a command', label: '2 failed' })
    // The JSON-string arguments Codex writes read the same.
    const json = [
      call('exec_command', JSON.stringify({ cmd: 'npm test' })),
      result(FAILED, true),
      call('write_stdin', JSON.stringify({ session_id: 3, chars: '' })),
      result(FAILED, true)
    ]
    expect(row(json)).toEqual({ sentence: 'Ran a command', label: '2 failed' })
  })

  it('reads the same failures in code-mode exec cells (Codex 0.153.4) the same way', () => {
    const blocks = [
      call('exec', CODE_MODE_START),
      result(FAILED, true),
      call('exec', CODE_MODE_POLL(1000)),
      result(FAILED, true)
    ]
    expect(row(blocks)).toEqual({ sentence: 'Ran a command', label: '2 failed' })
  })

  it('leaves a failure only the poll had to the label, as before', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test' }),
      result(),
      call('write_stdin', { session_id: 3, chars: '' }),
      result(FAILED, true)
    ]
    expect(row(blocks)).toEqual({ sentence: 'Ran a command', label: '1 failed' })
  })

  it('reads a run where one call failed by its state alone and one with its error as "Ran 2 commands" and "2 failed"', () => {
    // A structured lane writes both signals for the call whose result errored;
    // the second call's `failed` state is all there is of its failure.
    const blocks = [
      call('shell', { command: 'a' }, 'failed'),
      result('exit 1', true),
      call('shell', { command: 'b' }, 'failed')
    ]
    expect(row(blocks)).toEqual({ sentence: 'Ran 2 commands', label: '2 failed' })
  })

  it('draws one count when the two signals are on different calls', () => {
    // The vendored count is the larger of the two signals, not their union,
    // so this run's two failures count as one on the label as well. The row
    // still draws a single count.
    const blocks = [
      call('shell', { command: 'a' }, 'failed'),
      result('ok'),
      call('shell', { command: 'b' }),
      result('exit 1', true)
    ]
    expect(row(blocks)).toEqual({ sentence: 'Ran 2 commands (1 failed)', label: null })
  })

  it('says nothing about failures on a clean polled run', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test' }),
      result(),
      call('write_stdin', { session_id: 3, chars: '' }),
      result(),
      call('exec', CODE_MODE_START),
      result(),
      call('exec', CODE_MODE_POLL(30000)),
      result()
    ]
    expect(row(blocks)).toEqual({ sentence: 'Ran 2 commands', label: null })
  })

  it('keeps a Claude Bash run with one failed call as "Ran a command (1 failed)" with no label', () => {
    expect(row([call('Bash', { command: 'false' }), result('exit 1', true)])).toEqual({
      sentence: 'Ran a command (1 failed)',
      label: null
    })
  })

  it('keeps a count past the visible reach in the sentence, with the same count on the label', () => {
    const described = call('Bash', {
      command: 'cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint',
      description: 'Run the mobile regression gate: typecheck, vitest, oxlint, ratchet'
    })
    expect(row([described, result('exit 1', true)])).toEqual({
      sentence: 'Ran Run the mobile regression gate: typecheck, vitest, oxlint, ratchet (1 failed)',
      label: '1 failed'
    })
  })

  it('drops the count from a described command whose poll failed too, past the reach or not', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test', description: 'Run the tests' }),
      result(FAILED, true),
      call('write_stdin', { session_id: 3, chars: '' }),
      result(FAILED, true)
    ]
    expect(row(blocks)).toEqual({ sentence: 'Ran Run the tests', label: '2 failed' })
  })

  it('holds for the empty run and a lone failed poll', () => {
    expect(row([])).toEqual({ sentence: '', label: null })
    expect(row([call('write_stdin', { session_id: 3, chars: '' }), result(FAILED, true)])).toEqual({
      sentence: 'Ran a command (1 failed)',
      label: null
    })
  })

  it('never draws two different counts across every shape above', () => {
    const shapes: NativeChatBlock[][] = [
      [call('exec_command', { cmd: 'a' }), result(FAILED, true), call('write_stdin', { session_id: 1 }), result(FAILED, true)],
      [call('exec', CODE_MODE_START), result(FAILED, true), call('exec', CODE_MODE_POLL(1)), result(FAILED, true)],
      [call('shell', { command: 'a' }, 'failed'), result('x', true), call('shell', { command: 'b' }, 'failed')],
      [call('Bash', { command: 'a' }), result('x', true), call('Read', { file_path: 'a.ts' }), result('ok')]
    ]
    for (const blocks of shapes) {
      expect(new Set(countsDrawn(row(blocks))).size).toBeLessThanOrEqual(1)
    }
  })
})
