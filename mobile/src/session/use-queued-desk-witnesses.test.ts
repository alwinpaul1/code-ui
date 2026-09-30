// A message the agent's queue box still lists is remembered where it arrived,
// so one the agent takes while the chat is closed is drawn there when the chat
// comes back (final review of fix/midturn-prompt-at-end, 2026-09-29). The
// overlay cases are in mobile-chat-midturn-prompt-after-reply.test.ts and
// mobile-chat-desk-same-words-remembered.test.ts.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import { claudeQueueBox, codexQueueBox } from './queue-box-screens.test-support'
import { echoMemoryId } from './mobile-native-chat-remember-echo'
import { useAbsorbedQueueWitness, type BoxSighting } from './use-absorbed-queue-echoes'
import { queuedDeskWitnesses } from './use-queued-desk-witnesses'
import { absorbedMemoryId, type WitnessToRemember } from './mobile-native-chat-witness-memory'

const row = (id: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [], timestamp: 1, source: 'transcript' })
const userRow = (id: string, text: string): NativeChatMessage => ({ id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 1, source: 'transcript' })

/** The box as the chat draws it, read through the queue-box witness whose
 *  sightings it remembers the messages at, as the overlay wires the two. */
function reader(scope = 'scope') {
  let renderer: ReactTestRenderer | null = null
  let out: WitnessToRemember[] = []
  function Probe({ entries, rows, scopeKey }: { entries: MobileChatQueueEntry[]; rows: NativeChatMessage[]; scopeKey: string }) {
    // The box as read: a row the phone's own send stands in is its caption.
    const queued = entries.map((entry) => (typeof entry === 'string' ? entry : entry.caption))
    const { box } = useAbsorbedQueueWitness(queued, [], rows, scopeKey, rows, [])
    out = queuedDeskWitnesses(entries, box, rows)
    return null
  }
  return (entries: MobileChatQueueEntry[], rows: NativeChatMessage[], scopeKey = scope) => {
    act(() => {
      const element = createElement(Probe, { entries, rows, scopeKey })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
    return out
  }
}

describe('a message the queue box lists', () => {
  it('is remembered where the chat first saw it, however long it stays', () => {
    const read = reader()
    expect(read(['check the logs'], [row('a1')])).toEqual([{ id: echoMemoryId('check the logs'), text: 'check the logs', anchorId: 'a1' }])
    expect(read(['check the logs'], [row('a1'), row('a2'), row('a3')]).map((witness) => witness.anchorId)).toEqual(['a1'])
  })

  it('is not a phone send the box stands in for, a reading run into the tool rows, or an empty row', () => {
    const read = reader()
    const ownSend: MobileChatQueueEntry = { text: 'mine', images: [], caption: 'mine' }
    expect(read([ownSend, 'taken\n⎿  $ ls', '   ', 'desk words'], [row('a1')]).map((witness) => witness.text)).toEqual(['desk words'])
  })

  // Degenerate: nothing listed, and no row to place it after yet.
  it('is not remembered with no row to place it after, and nothing is with an empty box', () => {
    const read = reader()
    expect(read([], [row('a1')])).toEqual([])
    expect(read(['first'], [])).toEqual([])
    expect(read(['first'], [row('a1')]).map((witness) => witness.anchorId)).toEqual(['a1'])
  })

  // Round 2 of the review of fix/midturn-gaps: the chat opened as Claude
  // dequeued a message at a turn's end, and its first box read still listed
  // it with its row already in the transcript. Remembered then, it was drawn
  // a second time under its own row.
  it('is not remembered when the transcript already holds its row, and is when a user row of other words is there', () => {
    const read = reader()
    const typed: NativeChatMessage = { id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'check  the\nlogs' }], timestamp: 1, source: 'transcript' }
    expect(read(['check the logs', 'and the build'], [row('a1'), typed]).map((witness) => witness.text)).toEqual(['and the build'])
  })

  it('starts over for another chat', () => {
    const read = reader()
    read(['check the logs'], [row('a1')], 'one')
    expect(read(['check the logs'], [row('b9')], 'two').map((witness) => witness.anchorId)).toEqual(['b9'])
  })

  // Review, 2026-09-30: the sighting was kept by the words for good, so a
  // later message of the same words was remembered at the first one's row,
  // under the first one's id, and never stored.
  it('gives a later message of the same words its own row and id once the first has left the box', () => {
    const read = reader()
    read([], [row('a1')])
    expect(read(['keep going'], [row('a1')])).toEqual([{ id: echoMemoryId('keep going', 'a1'), text: 'keep going', anchorId: 'a1' }])
    expect(read([], [row('a1'), row('a2')])).toEqual([])
    expect(read(['keep going'], [row('a1'), row('a2'), row('a3')])).toEqual([
      { id: echoMemoryId('keep going', 'a3'), text: 'keep going', anchorId: 'a3' }
    ])
  })

  it('gives two copies of the same words listed together a row and id each', () => {
    const read = reader()
    read([], [row('a1')])
    read(['keep going'], [row('a1')])
    expect(read(['keep going', 'keep going'], [row('a1'), row('a2')]).map((witness) => witness.id)).toEqual([
      echoMemoryId('keep going', 'a1'),
      echoMemoryId('keep going', 'a2')
    ])
  })

  // The limit, pinned: two copies of the same words the box first lists in
  // one read were first seen after the same row, so they share an id and the
  // store keeps one (mobile-native-chat-remember-echo.ts sightedApart).
  it('gives two copies of the same words the box first lists in one read one id (a limit)', () => {
    const read = reader()
    read([], [row('a1')])
    expect(read(['keep going', 'keep going'], [row('a1')]).map((witness) => witness.id)).toEqual([
      echoMemoryId('keep going', 'a1'),
      echoMemoryId('keep going', 'a1')
    ])
  })

  // A read that cannot see the box remembers nothing, and forgets nothing:
  // the box listed again keeps the row it was first seen at.
  it('keeps its row across a read that could not see the box', () => {
    let renderer: ReactTestRenderer | null = null
    let out: WitnessToRemember[] = []
    function Probe({ queued, rows, readable }: { queued: string[]; rows: NativeChatMessage[]; readable: boolean }) {
      const { box } = useAbsorbedQueueWitness(queued, [], rows, 'scope', rows, [], readable)
      out = queuedDeskWitnesses(queued, box, rows)
      return null
    }
    const show = (queued: string[], rows: NativeChatMessage[], readable = true) => {
      act(() => {
        const element = createElement(Probe, { queued, rows, readable })
        if (renderer) {
          renderer.update(element)
        } else {
          renderer = create(element)
        }
      })
      return out
    }
    show([], [row('a1')])
    expect(show(['keep going'], [row('a1')]).map((witness) => witness.anchorId)).toEqual(['a1'])
    expect(show([], [row('a1'), row('a2')], false)).toEqual([])
    expect(show(['keep going'], [row('a1'), row('a2'), row('a3')]).map((witness) => witness.id)).toEqual([echoMemoryId('keep going', 'a1')])
    act(() => renderer?.unmount())
  })
})

// Review of 2026-09-30 (F13): a short desk message queued mid-turn with the
// words of an earlier turn, "keep going", was drawn in the queue box but never
// remembered. A user row of its words ANYWHERE in the transcript counted as
// its own landed row, so if the chat closed, the tab switched or the app
// relaunched before the agent's next row, the message was gone: Claude Code
// writes no transcript row for a message it takes mid-turn. Only a row from
// the one it arrived after on can be its own, the rule the queue-box
// witness's echoes are retired by (rowsFromAnchor).
describe('a message the queue box lists with the words of an earlier turn', () => {
  const WORDS = 'keep going'
  const slot = (sighting: string | null, firstRead = false): BoxSighting => ({ row: 0, text: WORDS, sighting, firstRead })
  const u1 = userRow('u1', WORDS)

  it('is remembered where it arrived though an earlier turn had the same words', () => {
    expect(queuedDeskWitnesses([WORDS], [slot('a2')], [u1, row('a1'), row('a2')])).toEqual([
      { id: absorbedMemoryId(WORDS, 'a2', false), text: WORDS, anchorId: 'a2' }
    ])
  })

  // Round 2 of the review of fix/midturn-gaps, kept: the chat opened as Claude
  // dequeued it at a turn's end, and the row Claude dequeued it as was already
  // the last row, the one the box first listed it after.
  it('is not remembered when the row it arrived after is its own, dequeued at a turn end', () => {
    expect(queuedDeskWitnesses([WORDS], [slot('u3', true)], [u1, row('a1'), row('a2'), userRow('u3', WORDS)])).toEqual([])
  })

  it('is not remembered once a row of its words lands after where it arrived', () => {
    expect(queuedDeskWitnesses([WORDS], [slot('a2')], [u1, row('a1'), row('a2'), userRow('u3', WORDS)])).toEqual([])
  })

  // The row it arrived after paged out above the loaded window: every row
  // held is after it, so a row of its words is its own, as before.
  it('is not remembered when the row it arrived after is no longer loaded and a row of its words is', () => {
    expect(queuedDeskWitnesses([WORDS], [slot('a0')], [u1, row('a1'), row('a2')])).toEqual([])
  })

  // Degenerate sizes: no box, no transcript, one row.
  it('remembers nothing for an empty box or an empty transcript, and after a single row only when that row is not its own', () => {
    expect(queuedDeskWitnesses([], [], [u1, row('a1')])).toEqual([])
    expect(queuedDeskWitnesses([WORDS], [slot(null)], [])).toEqual([])
    expect(queuedDeskWitnesses([WORDS], [slot('u1')], [u1])).toEqual([])
    expect(queuedDeskWitnesses([WORDS], [slot('a1')], [row('a1')])).toEqual([
      { id: absorbedMemoryId(WORDS, 'a1', false), text: WORDS, anchorId: 'a1' }
    ])
  })

  // Both agents' boxes, as the phone's own readers take them off the screen.
  for (const [agent, box] of [
    ['Claude Code', claudeQueueBox],
    ['Codex', codexQueueBox]
  ] as const) {
    it(`is remembered where it arrived though an earlier turn had the same words, on ${agent}`, () => {
      expect(box([WORDS])).toEqual([WORDS])
      expect(box([])).toEqual([])
      const read = reader()
      read(box([]), [u1, row('a1')])
      expect(read(box([WORDS]), [u1, row('a1'), row('a2')])).toEqual([{ id: echoMemoryId(WORDS, 'a2'), text: WORDS, anchorId: 'a2' }])
    })
  }
})
