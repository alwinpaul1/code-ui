import { expect, it, vi } from 'vitest'
import {
  recallNativeQueue,
  finishNativeQueueEdit,
  type QueueEditorAgent,
  type QueueScreen
} from './native-queue-editor'
const screen = (draft = '', lines: string[] = []): QueueScreen => ({
  source: 'screen',
  draft,
  lines
})
const queued = (agent: QueueEditorAgent) =>
  agent === 'codex'
    ? screen('', [
        '• Queued follow-up inputs',
        '  ↳ shortened…',
        '    ⌥ + ↑ edit last queued message'
      ])
    : screen('Press up to edit queued messages', [
        '  ❯ shortened…',
        '──────────',
        '❯',
        '──────────'
      ])
it('recognizes a wrapped Codex edit hint without claiming the message was submitted', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(
      screen('', [
        '• Queued follow-up inputs',
        '  ↳ original',
        '    ⌥ + ↑ edit last queued',
        '      message'
      ])
    )
    .mockResolvedValue(screen('original'))
  expect(await recallNativeQueue({ read, write: vi.fn(), pause: async () => {} }, 'codex')).toBe(
    'original'
  )
})
it.each(['claude', 'codex'] as const)(
  'reads the original %s draft instead of the shortened preview',
  async (agent) => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(queued(agent))
      .mockResolvedValue(screen('full original text'))
    const write = vi.fn().mockResolvedValue(undefined)
    expect(await recallNativeQueue({ read, write, pause: async () => {} }, agent)).toBe(
      'full original text'
    )
    expect(write).toHaveBeenCalledExactlyOnceWith(agent === 'codex' ? '\x1b[1;3A' : '\x1b[A')
  }
)
it.each(['claude', 'codex'] as const)(
  'does not overwrite an existing %s desktop draft',
  async (agent) => {
    const write = vi.fn()
    await expect(
      recallNativeQueue(
        {
          read: async () => ({ ...queued(agent), draft: 'desktop draft' }),
          write,
          pause: async () => {}
        },
        agent
      )
    ).rejects.toThrow('current draft')
    expect(write).not.toHaveBeenCalled()
  }
)
it.each(['claude', 'codex'] as const)(
  'saves %s input through its own submission key',
  async (agent) => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(screen('original'))
      .mockResolvedValueOnce(screen())
      .mockResolvedValueOnce(screen('edited'))
      .mockResolvedValueOnce(screen('edited'))
      .mockResolvedValue(screen())
    const write = vi.fn().mockResolvedValue(undefined)
    await finishNativeQueueEdit({ read, write, pause: async () => {} }, agent, 'original', 'edited')
    expect(write.mock.calls[1]![0]).toContain('\x1b[200~edited\x1b[201~')
    expect(write.mock.calls[2]![0]).toBe(agent === 'codex' ? '\t' : '\r')
    expect(write.mock.calls.flat().join('')).not.toContain('\x03')
  }
)
it.each(['claude', 'codex'] as const)(
  'restores %s attachment input unchanged when cancelling an edit',
  async (agent) => {
    const original = '[Image #1] original caption'
    const read = vi
      .fn()
      .mockResolvedValueOnce(screen(original))
      .mockResolvedValueOnce(screen(original))
      .mockResolvedValue(screen())
    const write = vi.fn().mockResolvedValue(undefined)
    await finishNativeQueueEdit({ read, write, pause: async () => {} }, agent, original, original)
    expect(write).toHaveBeenCalledExactlyOnceWith(agent === 'codex' ? '\t' : '\r')
  }
)
it.each(['claude', 'codex'] as const)(
  'deletes a recalled %s message without submitting or interrupting',
  async (agent) => {
    const read = vi.fn().mockResolvedValueOnce(screen('original')).mockResolvedValue(screen())
    const write = vi.fn().mockResolvedValue(undefined)
    await finishNativeQueueEdit({ read, write, pause: async () => {} }, agent, 'original', null)
    expect(write).toHaveBeenCalledOnce()
    expect([...write.mock.calls[0]![0]].some((char) => ['\r', '\t', '\x03'].includes(char))).toBe(
      false
    )
  }
)
it('handles the newer Claude selection step without sending Enter twice', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(queued('claude'))
    .mockResolvedValueOnce(
      screen('Press Enter to edit the selected message, or up again for history')
    )
    .mockResolvedValue(screen('original'))
  const write = vi.fn().mockResolvedValue(undefined)
  expect(await recallNativeQueue({ read, write, pause: async () => {} }, 'claude')).toBe('original')
  expect(write.mock.calls).toEqual([['\x1b[A'], ['\r']])
})
it('refuses to replace a draft edited on desktop', async () => {
  const write = vi.fn()
  await expect(
    finishNativeQueueEdit(
      { read: async () => screen('desktop change'), write, pause: async () => {} },
      'codex',
      'original',
      'mobile change'
    )
  ).rejects.toThrow('changed on desktop')
  expect(write).not.toHaveBeenCalled()
})
it('does not clear hidden attachment state', async () => {
  const write = vi.fn()
  await expect(
    finishNativeQueueEdit(
      { read: async () => screen('[Image #1] caption'), write, pause: async () => {} },
      'claude',
      '[Image #1] caption',
      'edited'
    )
  ).rejects.toThrow('attachment')
  expect(write).not.toHaveBeenCalled()
})

it('does not merge multiple entries in Claude’s legacy whole-queue recall', async () => {
  const write = vi.fn()
  const before = screen('Press up to edit queued messages', [
    '  ❯ first',
    '  ❯ second',
    '──────────',
    '❯',
    '──────────'
  ])
  await expect(
    recallNativeQueue({ read: async () => before, write, pause: async () => {} }, 'claude')
  ).rejects.toThrow('whole queue')
  expect(write).not.toHaveBeenCalled()
})
it('uses the host idle guard if Codex finishes while editing', async () => {
  let submitted = false
  const write = vi.fn(async (_text: string, idleOnly?: boolean) => {
    if (idleOnly) {
      submitted = true
    }
  })
  const read = async () => screen(submitted ? '' : 'original', ['gpt-6-astra high · /project'])
  await finishNativeQueueEdit(
    { read, write, pause: async () => {} },
    'codex',
    'original',
    'original'
  )
  expect(write.mock.calls).toEqual([['\t'], ['\r', true]])
})
it('rejects accumulated terminal output instead of treating it as a current queue', async () => {
  const write = vi.fn()
  await expect(
    recallNativeQueue(
      {
        read: async () => ({ ...queued('codex'), source: 'stream' }),
        write,
        pause: async () => {}
      },
      'codex'
    )
  ).rejects.toThrow('unavailable')
  expect(write).not.toHaveBeenCalled()
})
