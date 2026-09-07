import { expect, it, vi } from 'vitest'
import { typeAndSubmit } from './native-queue-input'
import {
  recallNativeQueue,
  finishNativeQueueEdit,
  QueueRebuildError,
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
  expect([...write.mock.calls[0]![0]].every((char) => char === '\u0015' || char === '\u000b')).toBe(
    true
  )
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

/** A Claude host that keeps a real queue: kills clear the input, a bracketed
 * paste fills it, and a submit key moves it into the queue. */
const claudeHost = (
  draft: string,
  drop?: string,
  swallowKey?: string,
  /** Hold each submit until the next read, the way a busy agent does: the
   *  composer still carries the message when the confirming read comes back. */
  lag = false
) => {
  const queue: string[] = []
  let input = draft
  let pending: string | null = null
  // A submit does not take effect until a later read: the composer is still
  // holding the message when its own confirming read comes back, which is the
  // window a presence-only check mistakes for success.
  let settleIn = 0
  const io = {
    read: vi.fn(async () => {
      if (pending !== null && --settleIn <= 0) {
        queue.push(pending)
        pending = null
        input = ''
      }
      return screen(input || 'Press up to edit queued messages', [
        ...queue.map((entry) => `  ❯ ${entry}`),
        '────────',
        '❯',
        '────────'
      ])
    }),
    write: vi.fn(async (text: string) => {
      if (text.length && [...text].every((char) => char === '\u0015' || char === '\u000b')) {
        input = ''
        return
      }
      if (text.startsWith('\x1b[200~')) {
        const end = text.indexOf('\x1b[201~')
        const value = text.slice('\x1b[200~'.length, end)
        if (value === drop) {
          // The write never reached the agent at all.
          return
        }
        // A paste that arrives while the composer still holds an unsubmitted
        // message joins it. This is the merge the count guard exists to stop.
        input += value
        // Claude sometimes keeps the paste and loses the key written after it.
        if (text.slice(end).includes('\r') && value !== swallowKey) {
          if (lag) {
            pending = input
            settleIn = 2
          } else {
            queue.push(input)
            input = ''
          }
        }
        return
      }
      if (text === '\r' && input) {
        queue.push(input)
        input = ''
      }
    }),
    pause: async () => {}
  }
  return { io, queue }
}

it('edits one message with no host configuration by retyping the queue in order', async () => {
  const read = vi.fn().mockResolvedValueOnce(legacyQueued).mockResolvedValue(screen(LEGACY_DRAFT))
  const write = vi.fn().mockResolvedValue(undefined)
  const recall = await recallNativeQueue({ read, write, pause: async () => {} }, 'claude', 1)
  expect(recall.text).toBe('bravo second')
  expect(recall.segments).toEqual(['alpha first', 'bravo second', 'charlie third'])
  expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[A')

  const host = claudeHost(LEGACY_DRAFT)
  await finishNativeQueueEdit(host.io, 'claude', recall, 'bravo EDITED')
  expect(host.queue).toEqual(['alpha first', 'bravo EDITED', 'charlie third'])
})

it('rebuilds the queue without a relay round trip per line or per keystroke', async () => {
  // The save took twelve seconds on a phone because every kill key and every
  // paste was confirmed by its own read. Three messages must stay in single
  // figures, or the editor sits there looking stalled.
  const host = claudeHost(LEGACY_DRAFT)
  await finishNativeQueueEdit(
    host.io,
    'claude',
    {
      text: 'bravo second',
      draft: LEGACY_DRAFT,
      segments: ['alpha first', 'bravo second', 'charlie third'],
      index: 1
    },
    'bravo EDITED'
  )
  const trips = host.io.read.mock.calls.length + host.io.write.mock.calls.length
  expect(host.queue).toHaveLength(3)
  expect(trips).toBeLessThanOrEqual(10)
})

it('drops just the deleted message and puts the rest of the queue back in order', async () => {
  const host = claudeHost(LEGACY_DRAFT)
  await finishNativeQueueEdit(
    host.io,
    'claude',
    {
      text: 'bravo second',
      draft: LEGACY_DRAFT,
      segments: ['alpha first', 'bravo second', 'charlie third'],
      index: 1
    },
    null
  )
  expect(host.queue).toEqual(['alpha first', 'charlie third'])
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

it('sends the submit key again when Claude keeps the paste but loses it', async () => {
  const host = claudeHost(LEGACY_DRAFT, undefined, 'bravo EDITED')
  await finishNativeQueueEdit(
    host.io,
    'claude',
    {
      text: 'bravo second',
      draft: LEGACY_DRAFT,
      segments: ['alpha first', 'bravo second', 'charlie third'],
      index: 1
    },
    'bravo EDITED'
  )
  expect(host.queue).toEqual(['alpha first', 'bravo EDITED', 'charlie third'])
  expect(host.io.write.mock.calls.map((call) => call[0])).toContain('\r')
})

it('names the messages left out of the queue when a retype fails part way', async () => {
  // The connection drops before the second message reaches the agent.
  const host = claudeHost(LEGACY_DRAFT, 'bravo EDITED')
  await expect(
    finishNativeQueueEdit(
      host.io,
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
  expect(host.queue).toEqual(['alpha first'])
})

it('will not confirm a submit while the composer still holds the text', async () => {
  // The confirmation is only safe today by accident: Claude draws its queue
  // hint as the composer placeholder, so a dirty composer hides the footer and
  // the parser reports no queue at all. Should that ever change, matching on
  // presence would let a repeated message confirm itself from the copy already
  // queued, and the next paste would join the one still in the composer.
  const dirty = screen('ping', [
    '  ❯ ping',
    '────────',
    '❯ Press up to edit queued messages',
    '────────'
  ])
  const read = vi.fn().mockResolvedValue(dirty)
  const write = vi.fn().mockResolvedValue(undefined)
  await expect(
    typeAndSubmit({ read, write, pause: async () => {} }, 'claude', 'ping', 2)
  ).rejects.toThrow('did not queue the message')
})

it('queues a message repeated in the queue twice, instead of confirming it from the first copy', async () => {
  // Characterisation: today the dirty-composer accident above already prevents
  // the merge, so this passes either way. It pins the outcome that matters.
  const host = claudeHost('continue\ncontinue\nwrap up', undefined, undefined, true)
  await finishNativeQueueEdit(
    host.io,
    'claude',
    {
      text: 'wrap up',
      draft: 'continue\ncontinue\nwrap up',
      segments: ['continue', 'continue', 'wrap up'],
      index: 2
    },
    'wrap up now'
  )
  expect(host.queue).toEqual(['continue', 'continue', 'wrap up now'])
})

it('marks a half-written rebuild so the editor cannot queue the landed messages twice', async () => {
  const host = claudeHost(LEGACY_DRAFT, 'bravo EDITED')
  const failure = await finishNativeQueueEdit(
    host.io,
    'claude',
    {
      text: 'bravo second',
      draft: LEGACY_DRAFT,
      segments: ['alpha first', 'bravo second', 'charlie third'],
      index: 1
    },
    'bravo EDITED'
  ).catch((cause: unknown) => cause)
  expect(failure).toBeInstanceOf(QueueRebuildError)
  expect((failure as QueueRebuildError).remaining).toEqual(['bravo EDITED', 'charlie third'])
  expect(host.queue).toEqual(['alpha first'])
})

it('keeps a queue holding a hard-wrapped URL instead of refusing after the recall', async () => {
  // Claude breaks a token longer than the pane with no space, so a word-by-word
  // match refused the split — after Up had already emptied the queue into the
  // composer, leaving the user's messages as one unsent draft.
  const caption =
    'see https://example.com/a/very/long/path/that/exceeds/the/pane/wid\nth/and/keeps/going'
  const draft =
    'see https://example.com/a/very/long/path/that/exceeds/the/pane/width/and/keeps/going'
  expect(segmentRecalledQueue(draft, [caption])).toEqual([draft])
})

it('hedges when a message may have run as a prompt, instead of telling the user not to re-send', async () => {
  // Claude finished its turn, so the submit became a live prompt: the message
  // is drawn in the transcript at column zero, not indented as a queue row.
  const delivered = screen('', ['⏺ Working on it', '❯ alpha first'])
  const read = vi.fn().mockResolvedValueOnce(screen('alpha first')).mockResolvedValue(delivered)
  const write = vi.fn().mockResolvedValue(undefined)
  await expect(
    finishNativeQueueEdit(
      { read, write, pause: async () => {} },
      'claude',
      { text: 'alpha first', draft: 'alpha first', segments: ['alpha first'], index: 0 },
      'alpha first'
    )
  ).rejects.toThrow('run this message as a prompt instead of queueing it')
})

it('counts a repeat that comes later in the queue, not just an earlier one', async () => {
  const host = claudeHost('ping\nmiddle\nping', undefined, undefined, true)
  await finishNativeQueueEdit(
    host.io,
    'claude',
    { text: 'middle', draft: 'ping\nmiddle\nping', segments: ['ping', 'middle', 'ping'], index: 1 },
    'middle EDITED'
  )
  expect(host.queue).toEqual(['ping', 'middle EDITED', 'ping'])
})

it('confirms a hard-wrapped message instead of stranding the queue it just let through', async () => {
  // The split was taught to ignore Claude's hard wrap but the confirmation was
  // not, so exactly the queue the split now accepts could never be confirmed:
  // it would paste, queue, spin to the deadline, and report the message lost.
  const url = 'see https://example.com/a/very/long/path/that/keeps/going/and/going'
  const wrapped = '  ❯ see https://example.com/a/very/long/path/that/keeps/go'
  const read = vi
    .fn()
    .mockResolvedValueOnce(screen(url))
    .mockResolvedValueOnce(screen('Press up to edit queued messages'))
    .mockResolvedValue(
      screen('Press up to edit queued messages', [
        wrapped,
        '    ing/and/going',
        '────────',
        '❯',
        '────────'
      ])
    )
  const write = vi.fn().mockResolvedValue(undefined)
  await finishNativeQueueEdit(
    { read, write, pause: async () => {} },
    'claude',
    { text: url, draft: url, segments: [url], index: 0 },
    url
  )
  expect(write.mock.calls.some((call) => call[0].includes(url))).toBe(true)
})

it('refuses a split whose boundary does not fall on whitespace in the draft', async () => {
  // Ignoring Claude's wrap inside a caption must not also let a caption that
  // was cut short slide every later boundary along, mis-splitting in silence.
  expect(segmentRecalledQueue('alphabravo', ['alpha', 'bravo'])).toBeNull()
  expect(segmentRecalledQueue('alpha\nbravo', ['alpha', 'bravo'])).toEqual(['alpha', 'bravo'])
})

it('refuses when the queue moved on between the tap and the recall', async () => {
  // The card's index comes from a poll up to a second old. If the agent takes a
  // message in between, that index addresses its neighbour — and Delete would
  // have trashed a message the user never chose.
  const write = vi.fn()
  const moved = screen('Press up to edit queued messages', [
    '  ❯ bravo second',
    '  ❯ charlie third',
    '────────',
    '❯',
    '────────'
  ])
  await expect(
    recallNativeQueue(
      { read: async () => moved, write, pause: async () => {} },
      'claude',
      0,
      'alpha first'
    )
  ).rejects.toThrow('queue moved on')
  expect(write).not.toHaveBeenCalled()
})

it('still opens when the tapped message is where the card said it was', async () => {
  const read = vi.fn().mockResolvedValueOnce(legacyQueued).mockResolvedValue(screen(LEGACY_DRAFT))
  const write = vi.fn().mockResolvedValue(undefined)
  const recall = await recallNativeQueue(
    { read, write, pause: async () => {} },
    'claude',
    1,
    'bravo second'
  )
  expect(recall.text).toBe('bravo second')
})

it('strands with every message when the link drops while the composer is being cleared', async () => {
  // The clear happened outside the guarded loop, so this threw a plain Error
  // saying the input "has been preserved" while the queue was already gone,
  // and left Save enabled to re-queue whatever had landed.
  let reads = 0
  const read = vi.fn(async () => {
    reads++
    if (reads === 1) {
      return screen(LEGACY_DRAFT)
    }
    throw new Error('Connection or session changed. The agent input has been preserved.')
  })
  const failure = await finishNativeQueueEdit(
    { read, write: vi.fn().mockResolvedValue(undefined), pause: async () => {} },
    'claude',
    {
      text: 'bravo second',
      draft: LEGACY_DRAFT,
      segments: ['alpha first', 'bravo second', 'charlie third'],
      index: 1
    },
    'bravo EDITED'
  ).catch((cause: unknown) => cause)
  expect(failure).toBeInstanceOf(QueueRebuildError)
  expect((failure as QueueRebuildError).remaining).toEqual([
    'alpha first',
    'bravo EDITED',
    'charlie third'
  ])
  expect((failure as Error).message).not.toMatch(/preserved/i)
})

it('accepts a message that queues on the very last read instead of calling it lost', async () => {
  // The save budget is shared across the whole rebuild, so on a slow link the
  // loop can run out one read before the queue is checked. The final read was
  // only tested for a delivered prompt, never for the queue, so a message that
  // did land was named as never put back — and the user was told to send it
  // again, which queues it twice.
  const landedLate = screen('', [
    '  ❯ charlie third',
    '────────',
    '❯ Press up to edit queued messages',
    '────────'
  ])
  const read = vi.fn().mockResolvedValue(landedLate)
  const write = vi.fn().mockResolvedValue(undefined)
  await expect(
    typeAndSubmit(
      { read, write, pause: async () => {} },
      'claude',
      'charlie third',
      1,
      Date.now() - 1
    )
  ).resolves.toBeUndefined()
})
