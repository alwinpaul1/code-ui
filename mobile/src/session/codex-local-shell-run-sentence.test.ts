import { describe, expect, it } from 'vitest'
import { createToolInputDisplay } from '../../../src/shared/native-chat-tool-summary'
import { isShellActivityToolCall } from '../../../src/shared/native-chat-tool-icon'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { readImagePaths } from './use-host-image-previews'
import { toolCallKind, toolRunSentence } from './mobile-native-chat-tool-sentence'

// A Codex `local_shell` run read "Used 2 tools" where a Bash run reads "Ran 2
// commands", and a single call read "Used a tool". Round 1 taught the phone
// the vendored command tool names (exec_command, shell_command), but the
// rollout transcript's `local_shell` is in neither that set nor the phone's
// own list, though Orca's vendored code knows it for a shell call
// (COMMAND_PATCH_TOOLS in native-chat-edit-normalize.ts, CATEGORY_BY_ROW_WORD
// in native-chat-tool-icon.ts). The second time this shape was fixed one name
// at a time, so the phone now falls back to the vendored category for every
// name it knows, and the census below pins each Codex name (review,
// 2026-09-30).

function call(name: string, input: unknown = {}): NativeChatBlock {
  return { type: 'tool-call', name, input }
}
function result(isError = false): NativeChatBlock {
  return { type: 'tool-result', output: '', ...(isError ? { isError: true } : {}) }
}

// The argv shape isShellActivityToolCall reads for local_shell in the vendored
// tests (src/shared/native-chat-tool-icon.test.ts).
const LS = { command: ['bash', '-lc', 'ls'] }
const PWD = { command: ['bash', '-lc', 'pwd'] }

describe('a Codex local_shell run reads as commands', () => {
  it('reads two local_shell calls as "Ran 2 commands", not "Used 2 tools"', () => {
    expect(toolCallKind('local_shell')).toBe('command')
    expect(
      toolRunSentence([call('local_shell', LS), result(), call('local_shell', PWD), result()])
    ).toBe('Ran 2 commands')
  })

  it('counts a failed local_shell call the way a failed Bash call is counted', () => {
    expect(
      toolRunSentence([call('local_shell', LS), result(true), call('local_shell', PWD), result()])
    ).toBe('Ran 2 commands (1 failed)')
  })

  it('reads one local_shell call as a command, and its row shows the command it ran', () => {
    expect(toolRunSentence([call('local_shell', LS), result()])).toBe('Ran a command')
    // Codex delivers arguments as a JSON string too; the argv survives that.
    expect(toolRunSentence([call('local_shell', JSON.stringify(LS)), result()])).toBe(
      'Ran a command'
    )
    expect(createToolInputDisplay(LS).label).toBe('bash -lc ls')
    expect(isShellActivityToolCall({ name: 'local_shell', input: LS })).toBe(true)
  })

  it('labels one local_shell call by its own description when it carries one', () => {
    expect(
      toolRunSentence([call('local_shell', { ...LS, description: 'List the files' }), result()])
    ).toBe('Ran List the files')
  })

  it('reads a run of local_shell and exec_command calls as one command group', () => {
    expect(
      toolRunSentence([
        call('local_shell', LS),
        result(),
        call('exec_command', { cmd: 'pwd' }),
        result()
      ])
    ).toBe('Ran 2 commands')
  })
})

describe('every Codex tool name the vendored code knows reads as what it did', () => {
  it.each([
    // Shell calls: the rollout transcript's names, the function tools, and
    // unified exec's write_stdin, which "Writes characters to an existing
    // unified exec session" (codex-rs/core/src/tools/handlers/shell_spec.rs at
    // rust-v0.153.4): it drives a command, so it counts as one.
    ['exec', 'command'],
    ['local_shell', 'command'],
    ['shell', 'command'],
    ['exec_command', 'command'],
    ['shell_command', 'command'],
    ['write_stdin', 'command'],
    // view_image: "View a local image file from the filesystem"
    // (codex-rs/core/src/tools/handlers/view_image_spec.rs at rust-v0.153.4).
    ['view_image', 'read'],
    // Codex's classified shell rows (CATEGORY_BY_ROW_WORD).
    ['read', 'read'],
    ['search', 'search'],
    ['list', 'search'],
    // Edits: the patch tool, and the `Diff` call every Codex file change
    // projects to (structured-agent-session-tool-call-block.ts).
    ['apply_patch', 'edit'],
    ['Diff', 'edit'],
    // A search, not a page fetch (tool-run-sentence-web-search.test.ts).
    ['web_search', 'webSearch'],
    ['spawn_agent', 'agent'],
    // A plan reads the way Claude's TodoWrite does: the run draws its checklist.
    ['update_plan', 'other'],
    ['mcp__github__create_issue', 'other']
  ] as const)('%s reads as %s', (name, kind) => {
    expect(toolCallKind(name)).toBe(kind)
  })

  it("reads a plan update the way it reads Claude's TodoWrite", () => {
    expect(toolCallKind('update_plan')).toBe(toolCallKind('TodoWrite'))
  })

  // An empty-chars write_stdin is a poll of the exec_command it follows, so the
  // two are one command (codex-stdin-poll-run-sentence.test.ts); a write_stdin
  // that types input counts as a command, never as a tool.
  it('reads a write_stdin poll beside its exec_command as commands, not tools', () => {
    expect(
      toolRunSentence([
        call('exec_command', { cmd: 'npm test' }),
        result(),
        call('write_stdin', { session_id: 3, chars: '' }),
        result()
      ])
    ).toBe('Ran a command')
    expect(
      toolRunSentence([
        call('exec_command', { cmd: 'npm init' }),
        result(),
        call('write_stdin', { session_id: 3, chars: 'y\n' }),
        result()
      ])
    ).toBe('Ran 2 commands')
  })

  it('reads two Codex file changes as edits, not tools', () => {
    expect(
      toolRunSentence([
        call('Diff', { path: 'a.ts' }),
        result(),
        call('Diff', { path: 'b.ts' }),
        result()
      ])
    ).toBe('Edited 2 files')
  })

  it('reads a view_image call as a read of that image, and shows it as a thumbnail', () => {
    expect(toolRunSentence([call('view_image', { path: '/tmp/shot.png' }), result()])).toBe(
      'Read shot.png'
    )
    const message: NativeChatMessage = {
      id: 'm1',
      role: 'assistant',
      blocks: [call('view_image', { path: '/tmp/shot.png' }), result()],
      timestamp: null,
      source: 'transcript'
    }
    expect(readImagePaths(message)).toEqual(['/tmp/shot.png'])
  })

  it('also takes the other names the vendored vocabulary knows', () => {
    // Orca's edit set and web-search row word, which the phone's own lists missed.
    expect(toolCallKind('str_replace')).toBe('edit')
    expect(toolCallKind('web search')).toBe('webSearch')
  })

  it("keeps Claude's own tools where they were", () => {
    expect(toolCallKind('Bash')).toBe('command')
    expect(toolCallKind('Read')).toBe('read')
    expect(toolCallKind('Edit')).toBe('edit')
    expect(toolCallKind('Write')).toBe('edit')
    expect(toolCallKind('Grep')).toBe('search')
    expect(toolCallKind('Glob')).toBe('search')
    expect(toolCallKind('Task')).toBe('agent')
    expect(toolCallKind('WebFetch')).toBe('web')
    expect(toolCallKind('Skill')).toBe('skill')
    expect(toolCallKind('SendMessage')).toBe('message')
    expect(toolCallKind('TodoWrite')).toBe('other')
    expect(toolCallKind('execute_code')).toBe('other')
    expect(toolCallKind('')).toBe('other')
    expect(toolCallKind('__proto__')).toBe('other')
  })
})
