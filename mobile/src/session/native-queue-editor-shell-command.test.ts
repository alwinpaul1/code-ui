// The queue editor types text into an emptied agent input and submits it, the same
// door a chat send goes through, so a message that starts with `!` reaches the
// agent as a shell command there too (Claude Code 2.1.287: a leading `!` pasted
// or typed into the EMPTY input switches it to bash mode; Codex 0.153.4 has
// `! for shell commands`; both read from the binaries, mobile-native-chat-shell-command.ts).
// The chat asks first. The editor's sheet has no room for a question, so it refuses
// with a message BEFORE the first write. The saved text is trimmed at both ends, as it always
// was: the host reads the input back trimmed (terminal-composer-draft.ts trims and trimStarts
// its lines), so a leading space or newline typed in would never read back and the save would
// be reported as failed AFTER the clear and the paste had gone out, losing the entry. Because
// it is typed trimmed, `!` is judged on the trimmed text: `  !cmd` would be typed as `!cmd`,
// a shell command, so it is refused too (the chat keeps a leading space and sends it as a
// prompt; the editor cannot, and refuses rather than run it).

import { describe, expect, it, vi } from 'vitest'
import {
  finishNativeQueueEdit,
  QueueRebuildError,
  type QueueEditorAgent,
  type QueueScreen
} from './native-queue-editor'
import {
  SHELL_COMMAND_QUEUE_REBUILD_REFUSAL,
  SHELL_COMMAND_QUEUE_REFUSAL
} from './mobile-native-chat-shell-command'

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

  it.each(AGENTS)('is refused on %s when a space or newline comes before the `!`: it would be typed trimmed', async (agent) => {
    for (const replacement of ['  !rm -rf build', '\n!rm -rf build', ' \n !ls']) {
      const read = vi.fn().mockResolvedValue(screen('original'))
      const write = vi.fn().mockResolvedValue(undefined)
      await expect(
        finishNativeQueueEdit(
          { read, write, pause: async () => {} },
          agent,
          { text: 'original', draft: 'original', segments: null, index: 0 },
          replacement
        )
      ).rejects.toThrow(SHELL_COMMAND_QUEUE_REFUSAL)
      expect(write).not.toHaveBeenCalled()
    }
  })

  // The host reads the input back trimmed (terminal-composer-draft.ts), so the fake does too.
  it.each(AGENTS)('saves an edit that starts with a space or newline on %s, typed and confirmed trimmed', async (agent) => {
    for (const replacement of ['  edited', '\nedited', ' \n edited  ']) {
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
        replacement
      )

      expect(write.mock.calls[1]![0]).toContain('\x1b[200~edited\x1b[201~')
      expect(write.mock.calls[2]![0]).toBe(agent === 'codex' ? '\t' : '\r')
    }
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

// Claude Code 2.1.287 CAN queue a shell command (read from the binary: its queue entries carry a
// `mode`, `popEditableAt` restores it, and "Clear the input to edit this queued shell command" is
// its own notice), so a recalled queue may hold one the user did not type just now. Retyping it
// would run it a second time, so the rebuild is refused before the clear either way. What the
// refusal says differs: a `!` the user just typed into the edited message can be fixed in the
// editor (a plain refusal, the sheet stays open); a `!` that was already in the queue can never
// be retyped, so the messages are stranded where they are (QueueRebuildError, as a failed
// retype is) and the message says they are in the desktop input, unsent, not "send it from the chat".
describe('rebuilding a queue that holds a message starting with !', () => {
  it('refuses a newly edited message, before the clear, and leaves the editor open', async () => {
    const read = vi.fn().mockResolvedValue(screen('alpha first\nbravo second'))
    const write = vi.fn().mockResolvedValue(undefined)

    const failure = await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      'claude',
      { text: 'alpha first', draft: 'alpha first\nbravo second', segments: ['alpha first', 'bravo second'], index: 0 },
      '!ls'
    ).catch((error: unknown) => error)

    expect((failure as Error).message).toBe(SHELL_COMMAND_QUEUE_REFUSAL)
    expect(failure).not.toBeInstanceOf(QueueRebuildError)
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    ['saved with another message edited', 'alpha again'],
    ['cancelled, with the entry put back unchanged', 'alpha first']
  ])('strands a queued `!` message the user did not just type, when it is %s', async (_name, replacement) => {
    const read = vi.fn().mockResolvedValue(screen('alpha first\n!ls'))
    const write = vi.fn().mockResolvedValue(undefined)

    const failure = await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      'claude',
      { text: 'alpha first', draft: 'alpha first\n!ls', segments: ['alpha first', '!ls'], index: 0 },
      replacement
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(QueueRebuildError)
    expect((failure as QueueRebuildError).remaining).toEqual([replacement, '!ls'])
    expect((failure as Error).message).toBe(SHELL_COMMAND_QUEUE_REBUILD_REFUSAL)
    expect((failure as Error).message).toContain('desktop input, unsent')
    expect(write).not.toHaveBeenCalled()
  })

  it('strands the entry itself when it is the queued `!` message that is put back unchanged', async () => {
    const read = vi.fn().mockResolvedValue(screen('!ls\nbravo'))
    const write = vi.fn().mockResolvedValue(undefined)
    const failure = await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      'claude',
      { text: '!ls', draft: '!ls\nbravo', segments: ['!ls', 'bravo'], index: 0 },
      '!ls'
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(QueueRebuildError)
    expect(write).not.toHaveBeenCalled()
  })

  it('says the queue was not rebuilt, and why, in terms of what is left', () => {
    expect(SHELL_COMMAND_QUEUE_REBUILD_REFUSAL).toBe(
      'A queued message starts with ! and would run as a shell command again if it were retyped, so the queue was not rebuilt. Your messages are in the desktop input, unsent.'
    )
  })

  it('rebuilds a queue with no ! in it as before', async () => {
    const read = vi.fn().mockResolvedValue(screen('a\nb'))
    const write = vi.fn().mockResolvedValue(undefined)
    await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      'claude',
      { text: 'a', draft: 'a\nb', segments: ['a', 'b'], index: 0 },
      'a2'
    ).catch(() => undefined)
    expect(write).toHaveBeenCalled()
  })
})
