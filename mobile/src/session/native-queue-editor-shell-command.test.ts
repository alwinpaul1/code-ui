// The queue editor types text into an emptied agent input and submits it, the same
// door a chat send goes through, so a message that starts with `!` reaches the
// agent as a shell command there too (Claude Code 2.1.287: a leading `!` pasted
// or typed into the EMPTY input switches it to bash mode; Codex 0.153.4 has
// `! for shell commands`; both read from the binaries, mobile-native-chat-shell-command.ts).
// The chat asks first. The editor's sheet has no room for a question, so it refuses
// with a message BEFORE the first write, and the saved text is judged as typed: the
// editor no longer trims the START (the chat only trims the end), so `  !cmd` is a prompt in
// both doors and `!cmd` is a command in both.

import { describe, expect, it, vi } from 'vitest'
import {
  finishNativeQueueEdit,
  type QueueEditorAgent,
  type QueueScreen
} from './native-queue-editor'
import { SHELL_COMMAND_QUEUE_REFUSAL } from './mobile-native-chat-shell-command'

const screen = (draft = '', lines: string[] = []): QueueScreen => ({ source: 'screen', draft, lines })
const AGENTS: QueueEditorAgent[] = ['claude', 'codex']

describe('saving a queued message that starts with !', () => {
  it.each(AGENTS)('is refused on %s before anything is written', async (agent) => {
    const read = vi.fn().mockResolvedValue(screen('original'))
    const write = vi.fn().mockResolvedValue(undefined)

    await expect(
      finishNativeQueueEdit(
        { read, write, pause: async () => {} },
        agent,
        { text: 'original', draft: 'original', segments: null, index: 0 },
        '!rm -rf build'
      )
    ).rejects.toThrow(SHELL_COMMAND_QUEUE_REFUSAL)
    expect(write).not.toHaveBeenCalled()
  })

  it('says where to send it instead', () => {
    expect(SHELL_COMMAND_QUEUE_REFUSAL).toBe(
      'A message that starts with ! runs as a shell command, so it cannot be put back in the queue. Send it from the chat box, where you are asked first.'
    )
  })

  it.each(AGENTS)('is saved as typed on %s when a space comes first: no switch, no trim', async (agent) => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(screen('original'))
      .mockResolvedValueOnce(screen())
      .mockResolvedValueOnce(screen('  !edited'))
      .mockResolvedValueOnce(screen('  !edited'))
      .mockResolvedValue(screen())
    const write = vi.fn().mockResolvedValue(undefined)

    await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      agent,
      { text: 'original', draft: 'original', segments: null, index: 0 },
      '  !edited'
    )

    expect(write.mock.calls[1]![0]).toContain('\x1b[200~  !edited\x1b[201~')
  })

  it.each(AGENTS)('still saves an ordinary edit with a trailing space trimmed on %s', async (agent) => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(screen('original'))
      .mockResolvedValueOnce(screen())
      .mockResolvedValueOnce(screen('edited'))
      .mockResolvedValueOnce(screen('edited'))
      .mockResolvedValue(screen())
    const write = vi.fn().mockResolvedValue(undefined)
    await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      agent,
      { text: 'original', draft: 'original', segments: null, index: 0 },
      'edited  '
    )
    expect(write.mock.calls[1]![0]).toContain('\x1b[200~edited\x1b[201~')
  })

  it('leaves an unchanged recalled entry alone: nothing is typed, only its own submit key', async () => {
    const read = vi.fn().mockResolvedValueOnce(screen('!ls')).mockResolvedValueOnce(screen('!ls')).mockResolvedValue(screen())
    const write = vi.fn().mockResolvedValue(undefined)
    await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      'claude',
      { text: '!ls', draft: '!ls', segments: null, index: 0 },
      '!ls'
    )
    expect(write).toHaveBeenCalledExactlyOnceWith('\r')
  })
})

describe('rebuilding a queue that holds a message starting with !', () => {
  it.each([
    ['the edited message', ['alpha first', 'bravo second'], '!ls'],
    ['a message that was not edited', ['alpha first', '!ls'], 'alpha again']
  ])('is refused before the clear when it is %s', async (_name, segments, replacement) => {
    const read = vi.fn().mockResolvedValue(screen('alpha first\nbravo second'))
    const write = vi.fn().mockResolvedValue(undefined)

    await expect(
      finishNativeQueueEdit(
        { read, write, pause: async () => {} },
        'claude',
        { text: 'alpha first', draft: 'alpha first\nbravo second', segments, index: 0 },
        replacement
      )
    ).rejects.toThrow(SHELL_COMMAND_QUEUE_REFUSAL)
    expect(write).not.toHaveBeenCalled()
  })

  it('is not stranded by the refusal: it is no half-written rebuild', async () => {
    const read = vi.fn().mockResolvedValue(screen('a\nb'))
    const failure = await finishNativeQueueEdit(
      { read, write: vi.fn(), pause: async () => {} },
      'claude',
      { text: 'a', draft: 'a\nb', segments: ['a', 'b'], index: 0 },
      '!x'
    ).catch((error: unknown) => error)
    expect((failure as Error).name).toBe('Error')
  })
})
