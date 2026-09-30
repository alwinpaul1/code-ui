import { describe, expect, it } from 'vitest'
import { COMMAND_TOOL_NAMES } from '../../../src/shared/native-chat-tool-activity'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolCallKind, toolRunSentence } from './mobile-native-chat-tool-sentence'

// A Codex tool run named exec_command or shell_command read "Used 2 tools"
// where a Claude Bash run reads "Ran 2 commands": the phone's own list of
// command tools knew bash|shell|exec|run_command|terminal|command|powershell
// only, while the vendored Orca list (COMMAND_TOOL_NAMES, and the hook preview
// that knows exec_command and shell_command as Codex's) has more. A single
// such call lost its own label too (review, 2026-09-30).

function call(name: string, input: Record<string, unknown> = {}): NativeChatBlock {
  return { type: 'tool-call', name, input }
}
function result(isError = false): NativeChatBlock {
  return { type: 'tool-result', output: '', ...(isError ? { isError: true } : {}) }
}

describe('a command run reads as commands on Claude and Codex alike', () => {
  it('reads a Claude Bash run as commands, as before', () => {
    expect(toolRunSentence([call('Bash'), result(), call('Bash'), result()])).toBe('Ran 2 commands')
  })

  // The control for a Codex code-mode command with braces in its cmd
  // (codex-stdin-poll-run-sentence.test.ts): Claude's Bash never went through
  // the cell reader, and a brace in its command changes nothing.
  it('reads a Claude Bash command holding braces as "Ran a command"', () => {
    expect(
      toolRunSentence([call('Bash', { command: "awk '{print $1}' big.log | sort" }), result()])
    ).toBe('Ran a command')
    expect(
      toolRunSentence([
        call('Bash', { command: 'echo ${HOME}' }),
        result(),
        call('Bash', { command: `curl -d '{"a":1}' localhost` }),
        result()
      ])
    ).toBe('Ran 2 commands')
  })

  it.each(['exec_command', 'shell_command'])('reads a Codex %s run as commands, not tools', (name) => {
    expect(toolRunSentence([call(name, { cmd: 'ls' }), result(), call(name, { cmd: 'pwd' }), result()])).toBe(
      'Ran 2 commands'
    )
    expect(toolRunSentence([call(name, { cmd: 'ls' }), result()])).toBe('Ran a command')
    expect(toolRunSentence([call(name), result(true), call(name), result()])).toBe('Ran 2 commands (1 failed)')
  })

  it("labels a single Codex command by its own description when it has one", () => {
    expect(
      toolRunSentence([call('shell_command', { command: 'npm test', description: 'Run the tests' }), result()])
    ).toBe('Ran Run the tests')
  })

  it('takes every command tool Orca names for one', () => {
    for (const name of COMMAND_TOOL_NAMES) {
      expect(toolCallKind(name)).toBe('command')
    }
    // And the phone's own older names still.
    for (const name of ['Bash', 'exec', 'command', 'functions.exec_command']) {
      expect(toolCallKind(name)).toBe('command')
    }
  })

  it('leaves other tools as they were', () => {
    expect(toolCallKind('Read')).toBe('read')
    expect(toolCallKind('apply_patch')).toBe('edit')
    expect(toolCallKind('spawn_agent')).toBe('agent')
    expect(toolCallKind('execute_code')).toBe('other')
    expect(toolCallKind('')).toBe('other')
    expect(toolRunSentence([])).toBe('')
  })
})
