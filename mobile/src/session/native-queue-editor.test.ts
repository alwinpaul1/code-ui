import { expect, it, vi } from 'vitest'
import {
  recallNativeQueue,
  finishNativeQueueEdit,
  segmentRecalledQueue,
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
        '  ❯ full original text',
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
  expect(
    (await recallNativeQueue({ read, write: vi.fn(), pause: async () => {} }, 'codex')).text
  ).toBe('original')
})
it.each(['claude', 'codex'] as const)(
  'reads the original %s draft instead of the shortened preview',
  async (agent) => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(queued(agent))
      .mockResolvedValue(screen('full original text'))
    const write = vi.fn().mockResolvedValue(undefined)
    expect((await recallNativeQueue({ read, write, pause: async () => {} }, agent)).text).toBe(
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
    await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      agent,
      { text: 'original', draft: 'original', segments: null, index: 0 },
      'edited'
    )
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
    await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      agent,
      { text: original, draft: original, segments: null, index: 0 },
      original
    )
    expect(write).toHaveBeenCalledExactlyOnceWith(agent === 'codex' ? '\t' : '\r')
  }
)
it.each(['claude', 'codex'] as const)(
  'deletes a recalled %s message without submitting or interrupting',
  async (agent) => {
    const read = vi.fn().mockResolvedValueOnce(screen('original')).mockResolvedValue(screen())
    const write = vi.fn().mockResolvedValue(undefined)
    await finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      agent,
      { text: 'original', draft: 'original', segments: null, index: 0 },
      null
    )
    expect(write).toHaveBeenCalledOnce()
    expect([...write.mock.calls[0]![0]].some((char) => ['\r', '\t', '\x03'].includes(char))).toBe(
      false
    )
  }
)
// Captured from Claude Code 2.1.263 at 80 columns, with Orca's composer split:
// the placeholder hint arrives in `draft`, never in the tail.
const CLAUDE_QUEUE_ROWS = [
  '  ❯ alpha this is a deliberately long first queued message that must wrap',
  '    across at least two rendered terminal lines to reveal the continuation',
  '    indent',
  '  ❯ bravo short second',
  '  ❯ charlie another very long third queued message written so that it also',
  '    wraps onto a second line inside the queue block for comparison purposes',
  '',
  '────────',
  '❯',
  '────────'
]
const ALPHA =
  'alpha this is a deliberately long first queued message that must wrap across at least two rendered terminal lines to reveal the continuation indent'
/** One entry keeps the marker; every other row drops to the same four-space
 * indent a wrapped line uses. That is what makes the block unparseable. */
const claudeSelecting = (marked: 0 | 1 | 2) =>
  screen(
    marked === 0
      ? 'Press Enter to edit the selected message, or up again for history'
      : 'Press Enter to edit the selected message, or up again for an older one',
    CLAUDE_QUEUE_ROWS.map((line, index) => {
      const rows = [0, 3, 4]
      const entry = rows.indexOf(index)
      if (entry === -1) {
        return line
      }
      return entry === marked ? line : line.replace('  ❯ ', '    ')
    })
  )
const claudeSelectable = screen('Press up to select a queued message, then Enter to edit it', [
  ...CLAUDE_QUEUE_ROWS
])

it('walks Claude’s selector to the message the user tapped, not the newest one', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(claudeSelectable)
    .mockResolvedValueOnce(claudeSelecting(2))
    .mockResolvedValueOnce(claudeSelecting(1))
    .mockResolvedValue(screen('bravo short second'))
  const write = vi.fn().mockResolvedValue(undefined)
  expect((await recallNativeQueue({ read, write, pause: async () => {} }, 'claude', 1)).text).toBe(
    'bravo short second'
  )
  expect(write.mock.calls).toEqual([['\x1b[A'], ['\x1b[A'], ['\r']])
})
it('walks all the way to Claude’s oldest queued message', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(claudeSelectable)
    .mockResolvedValueOnce(claudeSelecting(2))
    .mockResolvedValueOnce(claudeSelecting(1))
    .mockResolvedValueOnce(claudeSelecting(0))
    .mockResolvedValue(screen(ALPHA))
  const write = vi.fn().mockResolvedValue(undefined)
  expect((await recallNativeQueue({ read, write, pause: async () => {} }, 'claude', 0)).text).toBe(
    ALPHA
  )
  expect(write.mock.calls).toEqual([['\x1b[A'], ['\x1b[A'], ['\x1b[A'], ['\r']])
})
it('defaults to Claude’s newest queued message with a single press', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(claudeSelectable)
    .mockResolvedValueOnce(claudeSelecting(2))
    .mockResolvedValue(screen('charlie another very long third queued message'))
  const write = vi.fn().mockResolvedValue(undefined)
  await recallNativeQueue({ read, write, pause: async () => {} }, 'claude')
  expect(write.mock.calls).toEqual([['\x1b[A'], ['\r']])
})
it('escapes out of the walk instead of editing the wrong message', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(claudeSelectable)
    // The running turn consumed a message, so one press lands a row early.
    .mockResolvedValueOnce(claudeSelecting(1))
    .mockResolvedValue(claudeSelecting(1))
  const write = vi.fn().mockResolvedValue(undefined)
  await expect(
    recallNativeQueue({ read, write, pause: async () => {} }, 'claude', 1)
  ).rejects.toThrow('queue changed')
  expect(write.mock.calls).toEqual([['\x1b[A'], ['\x1b']])
  expect(write.mock.calls.flat()).not.toContain('\r')
})
it('refuses to open while the desktop already has an entry selected', async () => {
  const write = vi.fn()
  await expect(
    recallNativeQueue(
      { read: async () => claudeSelecting(1), write, pause: async () => {} },
      'claude',
      1
    )
  ).rejects.toThrow('already selected')
  expect(write).not.toHaveBeenCalled()
})
it('refuses a Codex entry that is not its latest queued message', async () => {
  const write = vi.fn()
  await expect(
    recallNativeQueue(
      {
        read: async () =>
          screen('', [
            '• Queued follow-up inputs',
            '  ↳ first',
            '  ↳ second',
            '    ⌥ + ↑ edit last queued message'
          ]),
        write,
        pause: async () => {}
      },
      'codex',
      0
    )
  ).rejects.toThrow('most recent')
  expect(write).not.toHaveBeenCalled()
})
it('refuses to replace a draft edited on desktop', async () => {
  const write = vi.fn()
  await expect(
    finishNativeQueueEdit(
      { read: async () => screen('desktop change'), write, pause: async () => {} },
      'codex',
      { text: 'original', draft: 'original', segments: null, index: 0 },
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
      { text: '[Image #1] caption', draft: '[Image #1] caption', segments: null, index: 0 },
      'edited'
    )
  ).rejects.toThrow('attachment')
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
    { text: 'original', draft: 'original', segments: null, index: 0 },
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

it('does not lose the message when Claude repaints its hint over the cleared input', async () => {
  // Live regression, Claude Code 2.1.263 through Orca: clearing the input makes
  // the placeholder hint reappear, and Orca publishes that hint as the draft.
  // Reading it as text made the input look like it grew, so the save aborted
  // after the entry had already left the queue and the message was lost.
  const hint = 'Press up to select a queued message, then Enter to edit it'
  const reads = [
    screen('alpha oldest'),
    screen(hint),
    screen(hint),
    screen('alpha EDITED'),
    screen('alpha EDITED'),
    screen(hint, ['  ❯ alpha EDITED', '────────', '❯', '────────'])
  ]
  const read = vi.fn(async () => reads.shift() ?? screen(hint))
  const write = vi.fn().mockResolvedValue(undefined)
  await finishNativeQueueEdit(
    { read, write, pause: async () => {} },
    'claude',
    { text: 'alpha oldest', draft: 'alpha oldest', segments: null, index: 0 },
    'alpha EDITED'
  )
  expect(write.mock.calls[0]).toEqual(['\x15'])
  expect(write.mock.calls[1]![0]).toContain('\x1b[200~alpha EDITED\x1b[201~')
  expect(write.mock.calls[2]).toEqual(['\r'])
})

// Claude Code 2.1.263 with no host configuration: one Up empties the whole
// queue into a single multiline draft. Captured live, three plain messages.
const LEGACY_QUEUE = [
  '  ❯ alpha first',
  '  ❯ bravo second',
  '  ❯ charlie third',
  '────────',
  '❯',
  '────────'
]
const LEGACY_DRAFT = 'alpha first\nbravo second\ncharlie third'
const legacyQueued = screen('Press up to edit queued messages', LEGACY_QUEUE)

it('splits a whole-queue recall back into the messages it was built from', () => {
  expect(
    segmentRecalledQueue(LEGACY_DRAFT, ['alpha first', 'bravo second', 'charlie third'])
  ).toEqual(['alpha first', 'bravo second', 'charlie third'])
})
it('keeps a queued message that wrapped in the caption but not in the draft', () => {
  // The caption's line break is display wrapping; the draft holds the author's.
  expect(
    segmentRecalledQueue('one long message that wrapped\nsecond', [
      'one long message that\nwrapped',
      'second'
    ])
  ).toEqual(['one long message that wrapped', 'second'])
})
it('refuses to split a recall that does not account for every queued word', () => {
  expect(segmentRecalledQueue('alpha first\nbravo second', ['alpha first'])).toBeNull()
  expect(segmentRecalledQueue('alpha first', ['alpha first', 'bravo second'])).toBeNull()
  expect(segmentRecalledQueue('alpha first', ['alpha shortened…'])).toBeNull()
})

it('edits one message with no host configuration by retyping the queue in order', async () => {
  const read = vi.fn().mockResolvedValueOnce(legacyQueued).mockResolvedValue(screen(LEGACY_DRAFT))
  const write = vi.fn().mockResolvedValue(undefined)
  const recall = await recallNativeQueue({ read, write, pause: async () => {} }, 'claude', 1)
  expect(recall.text).toBe('bravo second')
  expect(recall.segments).toEqual(['alpha first', 'bravo second', 'charlie third'])
  expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[A')

  const hint = 'Press up to edit queued messages'
  const typed: string[] = []
  const finishRead = vi.fn(async () => screen(typed.at(-1) ?? LEGACY_DRAFT))
  const finishWrite = vi.fn(async (text: string) => {
    if (text.startsWith('\x1b[200~')) {
      typed.push(text.slice('\x1b[200~'.length, -'\x1b[201~'.length))
    } else if (text === '\x15' || text === '\x0b' || text === '\r') {
      typed.push(hint)
    }
  })
  await finishNativeQueueEdit(
    { read: finishRead, write: finishWrite, pause: async () => {} },
    'claude',
    recall,
    'bravo EDITED'
  )
  expect(finishWrite.mock.calls.map((call) => call[0])).toEqual([
    '\x15',
    '\x1b[200~alpha first\x1b[201~',
    '\r',
    '\x1b[200~bravo EDITED\x1b[201~',
    '\r',
    '\x1b[200~charlie third\x1b[201~',
    '\r'
  ])
})

it('drops just the deleted message and puts the rest of the queue back in order', async () => {
  const hint = 'Press up to edit queued messages'
  const typed: string[] = []
  const read = vi.fn(async () => screen(typed.at(-1) ?? LEGACY_DRAFT))
  const write = vi.fn(async (text: string) => {
    if (text.startsWith('\x1b[200~')) {
      typed.push(text.slice('\x1b[200~'.length, -'\x1b[201~'.length))
    } else {
      typed.push(hint)
    }
  })
  await finishNativeQueueEdit(
    { read, write, pause: async () => {} },
    'claude',
    {
      text: 'bravo second',
      draft: LEGACY_DRAFT,
      segments: ['alpha first', 'bravo second', 'charlie third'],
      index: 1
    },
    null
  )
  expect(
    write.mock.calls.map((call) => call[0]).filter((text) => text.startsWith('\x1b[200~'))
  ).toEqual(['\x1b[200~alpha first\x1b[201~', '\x1b[200~charlie third\x1b[201~'])
})

it('refuses to retype a queue holding an attachment', async () => {
  const write = vi.fn()
  await expect(
    recallNativeQueue(
      {
        read: async () =>
          screen('Press up to edit queued messages', [
            '  ❯ alpha first',
            '  ❯ [Image #1] look at this',
            '────────',
            '❯',
            '────────'
          ]),
        write,
        pause: async () => {}
      },
      'claude',
      0
    )
  ).rejects.toThrow('attachment')
  expect(write).not.toHaveBeenCalled()
})

it('names the messages left out of the queue when a retype fails part way', async () => {
  const hint = 'Press up to edit queued messages'
  const typed: string[] = []
  const read = vi.fn(async () => screen(typed.at(-1) ?? LEGACY_DRAFT))
  const write = vi.fn(async (text: string) => {
    if (text.startsWith('\x1b[200~')) {
      const value = text.slice('\x1b[200~'.length, -'\x1b[201~'.length)
      // The connection drops before the second message reaches the agent.
      typed.push(value === 'alpha first' ? value : 'something else')
    } else {
      typed.push(hint)
    }
  })
  await expect(
    finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      'claude',
      {
        text: 'bravo second',
        draft: LEGACY_DRAFT,
        segments: ['alpha first', 'bravo second', 'charlie third'],
        index: 1
      },
      'bravo EDITED'
    )
  ).rejects.toThrow('"bravo EDITED", "charlie third"')
})
