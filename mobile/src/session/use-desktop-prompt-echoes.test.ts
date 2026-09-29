import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { useDesktopPromptEchoes, withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

// 2026-09-13: a desktop prompt with a pasted screenshot lands in the
// transcript with its `[Image #1]` marker and re-wrapped, and the hook's copy
// of it stayed on screen as a second bubble.
describe('withoutLandedDesktopPrompts', () => {
  it('retires a hook prompt whose transcript row carries image markers', () => {
    const prompts = [{ nonce: 'n1', text: 'See this  tooo' }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', '[Image #96] See this tooo')])).toEqual(
      []
    )
  })

  it('drops a prompt the phone itself sent, which already has its pending echo', () => {
    const prompts = [{ nonce: 'n1', text: 'from the phone' }]
    expect(withoutLandedDesktopPrompts(prompts, [], ['from the phone'])).toEqual([])
  })

  it('matches a prompt the hook says it shortened as a prefix of its row', () => {
    const long = 'x'.repeat(2400)
    const prompts = [{ nonce: 'n1', text: long.slice(0, 2000), cut: true }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', long)])).toEqual([])
  })

  // 2026-09-13: the cut was guessed from the text's length, and the guess was
  // wrong whenever JSON escapes or multibyte text moved the boundary. A prompt
  // the hook did NOT shorten must never be retired by a longer row.
  it('keeps a whole prompt that merely starts the same as a longer message', () => {
    const prompts = [{ nonce: 'n1', text: 'run the tests' }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', 'run the tests and deploy')])).toEqual(
      prompts
    )
  })

  it('keeps a prompt the transcript does not show', () => {
    const prompts = [{ nonce: 'n1', text: 'fix the dock' }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', 'something else')])).toEqual(prompts)
  })
})

// ─── Anchoring: where a queued desktop prompt lands ─────────────────────────


function assistant(id: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text: id }],
    timestamp: 0,
    source: 'transcript'
  }
}

let latest: MobileNativeChatPendingMessage[] = []
function Probe({
  prompts,
  raw
}: {
  prompts: readonly DesktopPrompt[]
  raw: readonly NativeChatMessage[]
}) {
  latest = useDesktopPromptEchoes(prompts, raw, raw)
  return null
}

describe('where a desktop prompt echo anchors', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  // 2026-09-14, compared against the Claude app on the same session: a prompt
  // queued while a turn ran showed in the Claude app right where its record
  // sits, but on the phone several turns LOWER. The echo had anchored to the
  // tail at the moment the beacon ARRIVED, and on a lagging link that tail
  // was already turns past the submit. The hook now beacons the row that was
  // last at submit time; the echo anchors there whatever has loaded since.
  it('anchors a queued prompt to the row that was last when it was typed, not the tail when the beacon arrived', () => {
    // The beacon says the prompt was typed right after row a3. By the time the
    // phone processes it, rows a4 and a5 (later turns) have already loaded.
    const raw = [assistant('a1'), assistant('a2'), assistant('a3'), assistant('a4'), assistant('a5')]
    const prompts: DesktopPrompt[] = [{ nonce: '7', text: 'queued while busy', anchorId: 'a3' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw }))
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]!.baselineTailMessageId).toBe('a3')
  })

  // 2026-09-19, on the device: the transcript names the row a queued prompt
  // was written after, but that row was a tool call the phone did not hold,
  // so the wait ran out, and the bubble fell to the arrival tail — three
  // turns under the reply that answered it. The record's own time places it
  // after the last row written before it. (Orca 1.4.216's decoder does make a
  // row of a tool call, keyed by its uuid, read 2026-09-29; this path is for
  // when the row is not held.)
  it('anchors by time when the row it names is one the phone never holds', () => {
    const at = (id: string, t: number): NativeChatMessage => ({ ...assistant(id), timestamp: t })
    const raw = [at('a1', 1000), at('a2', 2000), at('a3', 3000), at('a4', 4000)]
    const prompts: DesktopPrompt[] = [
      { nonce: 'u1', text: 'typed mid-turn', anchorId: 'toolu-row-never-projected', at: 2500 }
    ]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('a2')
    // Later rows arriving do not move it.
    act(() => {
      renderer!.update(createElement(Probe, { prompts, raw: [...raw, at('a5', 5000)] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('a2')
  })

  it('leads the conversation when it was typed before every held row', () => {
    const at = (id: string, t: number): NativeChatMessage => ({ ...assistant(id), timestamp: t })
    const raw = [at('a1', 1000), at('a2', 2000)]
    const prompts: DesktopPrompt[] = [{ nonce: 'u2', text: 'first', anchorId: 'x', at: 500 }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw }))
    })
    expect(latest[0]!.baselineTailMessageId).toBeNull()
  })

  it('falls back to the arrival tail when the beacon carries no anchor (older hook)', () => {
    const raw = [assistant('a1'), assistant('a2'), assistant('a3')]
    const prompts: DesktopPrompt[] = [{ nonce: '8', text: 'plain' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('a3')
  })

  // The fallback survives, but it is no longer IMMEDIATE. Taking the tail on the
  // first reading was the defect behind the stacked-prompts report of
  // 2026-09-15: a beacon normally arrives before the rows of its own turn, so
  // "not in the window yet" and "not in the window ever" looked identical and
  // every prompt of a turn froze onto the same tail. The prompt now waits, and
  // a row that truly never comes still gets a position.
  it('falls back to the tail once the beaconed row has clearly not come', () => {
    const raw = [assistant('a4'), assistant('a5')]
    const prompts: DesktopPrompt[] = [{ nonce: '9', text: 'old', anchorId: 'a1-paged-out' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw }))
    })
    // Shown at the tail meanwhile rather than hidden: an echo with no position
    // is not drawn, and waiting invisibly lost the message outright.
    expect(latest[0]!.baselineTailMessageId).toBe('a5')
    for (let attempt = 0; attempt < 40; attempt += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts, raw }))
      })
    }
    expect(latest[0]!.baselineTailMessageId).toBe('a5')
  })

  it('keeps the anchor once set, even as later rows keep arriving', () => {
    const prompts: DesktopPrompt[] = [{ nonce: '10', text: 'queued', anchorId: 'a2' }]
    act(() => {
      renderer = create(
        createElement(Probe, { prompts, raw: [assistant('a1'), assistant('a2'), assistant('a3')] })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('a2')
    // Two more turns land; the echo must not drift down with them.
    act(() => {
      renderer!.update(
        createElement(Probe, {
          prompts,
          raw: [assistant('a1'), assistant('a2'), assistant('a3'), assistant('a4'), assistant('a5')]
        })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('a2')
  })
})

// Reported 2026-09-15: "the follow up prompts send from the desktop werent
// correctly placed in the chat ui".
//
// The anchor map was a `useRef`, so it died with the component. FlashList
// recycles rows and the chat remounts on a tab switch, and on the next mount
// every anchor is derived again from nothing. While the beaconed row is still
// inside the live window (150 rows) that redraw is harmless. Once it has paged
// out, the fallback takes the CURRENT tail — so a prompt typed ten turns ago
// jumps to the bottom of the conversation, under replies it came before.
//
// This is the second time this exact shape has bitten today: the sticky HUD
// hold was a `useRef` for the same reason and lost its figures on remount. The
// rule says the second one is a sweep, not a patch.
describe('a desktop prompt whose chat view remounted', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps its anchor after a remount, once the beaconed row has paged out', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'remount-1', text: 'typed on the desktop', anchorId: 'a2' }]
    act(() => {
      renderer = create(
        createElement(Probe, {
          prompts,
          raw: [assistant('a1'), assistant('a2'), assistant('a3')]
        })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('a2')

    // The tab is switched away and back. a2 has since scrolled out of the live
    // window, so nothing on screen can rediscover where this prompt belonged.
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        createElement(Probe, { prompts, raw: [assistant('a8'), assistant('a9')] })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('a2')
  })

  it('still anchors a prompt it has never seen before', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'remount-2', text: 'brand new' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('b1'), assistant('b2')] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('b2')
  })

  it('keeps each follow-up on its own row rather than stacking them on one', () => {
    const prompts: DesktopPrompt[] = [
      { nonce: 'remount-3', text: 'first follow-up', anchorId: 'c1' },
      { nonce: 'remount-4', text: 'second follow-up', anchorId: 'c3' }
    ]
    act(() => {
      renderer = create(
        createElement(Probe, {
          prompts,
          raw: [assistant('c1'), assistant('c2'), assistant('c3')]
        })
      )
    })
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['c1', 'c3'])
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('c9')] }))
    })
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['c1', 'c3'])
  })
})

// Reported 2026-09-15 with a screenshot: four desktop prompts stacked together
// with the agent's replies nowhere between them.
//
// The cause is the fallback. The hook beacons the row that was last at submit
// time, but a beacon usually arrives BEFORE the transcript rows of the turn it
// was typed into. The row was then not found, the arrival-time tail was frozen
// in its place, and — because that decision is permanent — several prompts from
// one turn all took the SAME tail and drew as one block.
describe('a desktop prompt whose row has not loaded yet', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('waits for the beaconed row instead of freezing the tail', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'late-1', text: 'typed mid-turn', anchorId: 'r5' }]
    // r5 has not arrived yet.
    act(() => {
      renderer = create(
        createElement(Probe, { prompts, raw: [assistant('r1'), assistant('r2')] })
      )
    })
    // At the tail provisionally — visible — but NOT committed there, which is
    // what the second half of this test proves.
    expect(latest[0]!.baselineTailMessageId).toBe('r2')
    // r5 lands with the rest of the turn.
    act(() => {
      renderer!.update(
        createElement(Probe, {
          prompts,
          raw: [assistant('r1'), assistant('r2'), assistant('r5'), assistant('r6')]
        })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('r5')
  })

  it('keeps prompts from one turn on their own rows', () => {
    const prompts: DesktopPrompt[] = [
      { nonce: 'late-a', text: 'first', anchorId: 'm2' },
      { nonce: 'late-b', text: 'second', anchorId: 'm4' },
      { nonce: 'late-c', text: 'third', anchorId: 'm6' }
    ]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('m1')] }))
    })
    act(() => {
      renderer!.update(
        createElement(Probe, {
          prompts,
          raw: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => assistant(id))
        })
      )
    })
    // Three separate anchors, in order — not three copies of the tail.
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['m2', 'm4', 'm6'])
  })

  it('gives up and shows the message rather than hiding it forever', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'gone-1', text: 'orphan', anchorId: 'never-arrives' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('z1')] }))
    })
    for (let attempt = 0; attempt < 40; attempt += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts, raw: [assistant('z1'), assistant('z2')] }))
      })
    }
    // A row that never comes must not strand the message with no position.
    // The position is where it was first seen, z1. This asserted z2, the tail
    // of the reading the wait ran out on, which pinned the defect of
    // 2026-09-29 (see "a waiting copy whose row never loads").
    expect(latest[0]!.baselineTailMessageId).toBe('z1')
  })

  it('still uses the tail at once when the beacon names no row', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'plain-1', text: 'older hook' }]
    act(() => {
      renderer = create(
        createElement(Probe, { prompts, raw: [assistant('p1'), assistant('p2')] })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('p2')
  })
})

// Regression reported 2026-09-15, right after the waiting was added: a queued
// desktop message was not shown AT ALL.
//
// While a prompt waited for the row its beacon named, it had no anchor, and an
// echo with no position is not drawn. That was meant to last a render or two.
// It does not: the wait ends after a fixed number of READINGS, and readings only
// happen while something re-renders — so once the turn went quiet the message
// stayed invisible with no way back.
describe('a queued prompt while it waits for its row', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('is shown straight away, at the end, rather than not at all', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'vis-1', text: 'queued', anchorId: 'not-here-yet' }]
    act(() => {
      renderer = create(
        createElement(Probe, { prompts, raw: [assistant('v1'), assistant('v2')] })
      )
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]!.baselineTailMessageId).toBe('v2')
  })

  it('moves to its real place once the row arrives', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'vis-2', text: 'queued', anchorId: 'w2' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('w9')] }))
    })
    // Visible meanwhile, at the tail.
    expect(latest[0]!.baselineTailMessageId).toBe('w9')
    act(() => {
      renderer!.update(
        createElement(Probe, {
          prompts,
          raw: [assistant('w1'), assistant('w2'), assistant('w3'), assistant('w9')]
        })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('w2')
  })

  it('settles for good once the wait is over', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'vis-3', text: 'queued', anchorId: 'never' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('x1')] }))
    })
    for (let attempt = 0; attempt < 40; attempt += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts, raw: [assistant('x1'), assistant('x2')] }))
      })
    }
    // Where it was first seen, x1. This asserted x2, the tail when the wait
    // ran out, which pinned the defect of 2026-09-29.
    expect(latest[0]!.baselineTailMessageId).toBe('x1')
    // A later turn must not drag it down now that it has settled.
    act(() => {
      renderer!.update(
        createElement(Probe, { prompts, raw: [assistant('x1'), assistant('x2'), assistant('x3')] })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('x1')
  })
})

// Reported 2026-09-15 from the device, in the very session being fixed: two
// prompts stacked at the bottom with the reply to the first drawn ABOVE them.
//
// The provisional position added for the invisible-message regression was
// `rawMessages.at(-1)` read fresh on EVERY render. So a prompt waiting for its
// row did not hold still — it followed the tail down as the turn wrote new
// rows, and ended up below the reply it had caused. The old code froze the
// arrival tail at once, which was roughly right; the waiting has to keep that
// and only UPGRADE to the beaconed row when it appears.
describe('where a waiting prompt sits while rows keep arriving', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('holds the tail it first saw instead of sliding down the turn', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'hold-1', text: 'typed mid-turn', anchorId: 'gone' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('t1'), assistant('t2')] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('t2')
    // The turn writes its reply. The prompt must stay above it.
    act(() => {
      renderer!.update(
        createElement(Probe, {
          prompts,
          raw: [assistant('t1'), assistant('t2'), assistant('t3'), assistant('t4')]
        })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('t2')
  })

  it('keeps two prompts of one turn on the rows they were typed after', () => {
    const first: DesktopPrompt[] = [{ nonce: 'hold-a', text: 'first', anchorId: 'gone-a' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts: first, raw: [assistant('u1')] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('u1')
    // A reply lands, then the second prompt is typed.
    const both: DesktopPrompt[] = [
      ...first,
      { nonce: 'hold-b', text: 'second', anchorId: 'gone-b' }
    ]
    act(() => {
      renderer!.update(
        createElement(Probe, { prompts: both, raw: [assistant('u1'), assistant('u2')] })
      )
    })
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['u1', 'u2'])
  })

  it('still upgrades to the beaconed row when it finally arrives', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'hold-2', text: 'queued', anchorId: 'y2' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('y9')] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('y9')
    act(() => {
      renderer!.update(
        createElement(Probe, { prompts, raw: [assistant('y1'), assistant('y2'), assistant('y9')] })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('y2')
  })
})

// 2026-09-29, the session behind mobile-chat-midturn-prompt-after-reply.test.ts
// (Claude Code 2.1.284): the beacon's copy of a message typed at 05:36:34 named
// the prompt that opened the turn (a hook that skipped every text row of a
// working turn), on a page the chat never loaded. The copy waited, drawn where
// the chat first saw it, after the call written at 05:36:25. When the wait ran
// out it settled on the tail of that reading instead, which with the phone
// asleep through the turn was the last reply, eleven minutes and the answer to
// the message below where it arrived. Only the witness memory, which had
// stored the first place, kept the chat right. On its own this hook must place
// the copy where it was first seen: the wait may only upgrade that to the
// named row, never move it to wherever the tail happens to be.
describe('a waiting copy whose row never loads', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  // The session's own raw rows around the message (ids only).
  const BEFORE_SECOND = [
    'fed3dc95-5dba-4516-8d8d-4cebbbae8078',
    '0465a647-17fa-40a0-b277-87f5fd3561b2',
    'fb42a005-40bf-4394-9b6c-f75dbb436f95',
    'c87c6d3e-1a98-4946-a845-df1e58f12acc',
    'c23a95c6-02db-4b9d-9c85-eb30b5d479ce'
  ].map(assistant)
  const WHOLE_TURN = [
    ...BEFORE_SECOND,
    ...[
      'b2fc1eee-5953-4f0f-8c7f-030e47884fd2',
      '99b501a9-d5cb-4092-a1f1-2aa6898f24e8',
      '60a7be7b-a870-40e0-ad3d-b3278fb1c02a',
      '00899e40-73d4-4924-ad6a-fa4c04c98134',
      'c221689d-cbea-4fdb-8df2-d1971b70cc45',
      '2a7ab6a0-cf20-459c-8eca-bbcf60d7838c',
      'bfe5cd40-04d9-4340-8b3f-2b89bb2e4c62'
    ].map(assistant)
  ]
  const OPENING_ROW = 'd01807a3-bea6-4f29-8a97-bc9a106d86ae'

  it('settles where it was first seen, not on the tail of its last reading', () => {
    const prompts: DesktopPrompt[] = [{ nonce: '48213', text: 'Whats this', anchorId: OPENING_ROW }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: BEFORE_SECOND }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('c23a95c6-02db-4b9d-9c85-eb30b5d479ce')
    // The phone wakes after the turn with every row in, and the chat is read
    // again and again, well past the wait.
    for (let reading = 0; reading < 40; reading += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts, raw: WHOLE_TURN }))
      })
    }
    expect(latest[0]!.baselineTailMessageId).toBe('c23a95c6-02db-4b9d-9c85-eb30b5d479ce')
    // And it stays there after a remount, when nothing can rediscover it.
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: WHOLE_TURN }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('c23a95c6-02db-4b9d-9c85-eb30b5d479ce')
  })

  it('holds its first place while the turn writes a row on every reading', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'grow-1', text: 'typed mid-turn', anchorId: 'never-loads' }]
    const rows = (count: number) => Array.from({ length: count }, (_, index) => assistant(`g${index + 1}`))
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: rows(2) }))
    })
    for (let reading = 0; reading < 40; reading += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts, raw: rows(3 + reading) }))
      })
    }
    expect(latest[0]!.baselineTailMessageId).toBe('g2')
  })

  // The degenerate reading: the copy is seen before the chat holds a single
  // row (a tab opened while its transcript loads). Nothing was seen to place
  // it after, so its first place is the first reading that holds a row. It
  // must never lead the conversation: a null anchor over held rows draws it
  // at the very top.
  it('takes its first place from the first reading that holds a row, never the top of the chat', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'empty-1', text: 'typed mid-turn', anchorId: 'never-loads' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [] }))
    })
    // No row to sit after, so it is drawn at the end of an empty chat.
    expect(latest[0]!.baselineTailMessageId).toBeNull()
    act(() => {
      renderer!.update(createElement(Probe, { prompts, raw: [assistant('e1'), assistant('e2')] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('e2')
    for (let reading = 0; reading < 40; reading += 1) {
      act(() => {
        renderer!.update(
          createElement(Probe, { prompts, raw: [assistant('e1'), assistant('e2'), assistant('e3'), assistant('e4')] })
        )
      })
    }
    expect(latest[0]!.baselineTailMessageId).toBe('e2')
  })

  // Second review of 34c80e97: a copy drawn over a chat still loading left no
  // mark once an empty reading stopped recording its first place, so when the
  // first reading with rows came more than ten minutes after the copy
  // arrived (the tab left and come back, or a long outage), the copy counted
  // as "found long after it arrived" and was never drawn again. The chat had
  // drawn it; it was seen arrive.
  describe('when the rows come more than ten minutes after a copy it drew over an empty chat', () => {
    const T0 = Date.parse('2026-09-29T05:36:35.000Z')
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(T0)
    })
    afterEach(() => {
      vi.useRealTimers()
    })
    function Loading({ prompts, raw, readSettled }: { prompts: readonly DesktopPrompt[]; raw: readonly NativeChatMessage[]; readSettled: boolean }) {
      latest = useDesktopPromptEchoes(prompts, raw, raw, false, readSettled)
      return null
    }

    it('keeps drawing it after a remount, at the first row it sees', () => {
      const prompts: DesktopPrompt[] = [{ nonce: 'loading-remount', text: 'typed at the desk', anchorId: 'never-loads', seenAt: T0 }]
      act(() => {
        renderer = create(createElement(Loading, { prompts, raw: [], readSettled: false }))
      })
      expect(latest).toHaveLength(1)
      act(() => renderer?.unmount())
      vi.setSystemTime(T0 + 11 * 60_000)
      act(() => {
        renderer = create(createElement(Loading, { prompts, raw: [assistant('l1'), assistant('l2')], readSettled: true }))
      })
      expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['l2'])
    })

    it('keeps drawing it on the same mount, at the first row it sees', () => {
      const prompts: DesktopPrompt[] = [{ nonce: 'loading-slow', text: 'typed at the desk', anchorId: 'never-loads', seenAt: T0 }]
      act(() => {
        renderer = create(createElement(Loading, { prompts, raw: [], readSettled: false }))
      })
      vi.setSystemTime(T0 + 11 * 60_000)
      act(() => {
        renderer!.update(createElement(Loading, { prompts, raw: [assistant('s1'), assistant('s2')], readSettled: true }))
      })
      expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['s2'])
    })
  })

  it('settles on the only row when there is one', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'one-1', text: 'typed mid-turn', anchorId: 'never-loads' }]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw: [assistant('o1')] }))
    })
    for (let reading = 0; reading < 40; reading += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts, raw: [assistant('o1')] }))
      })
    }
    expect(latest[0]!.baselineTailMessageId).toBe('o1')
  })
})

// 2026-09-20, phone beside the desk: the desk read "Ran 10 shell commands"
// and then the queued message; the phone drew the message after 8. From the
// transcript (7449d614…jsonl): nine Bash calls before the send
// (08:23:04…08:23:58.4), the send at 08:23:59.6, one more call at 08:24:32.3,
// and the queue absorbed it at 08:24:32.5 — after the tenth. The echo was
// anchored by its hook time against the rows the phone HELD at first sight
// (the ninth had not loaded, 1.2 s old), and the anchor was then final.
// That fix then moved the message to where the agent's queue box let it go,
// matching the desk's terminal. On 2026-09-23 the user chose the Claude app's
// order instead: a message sent mid-turn sits where it was SENT, with the calls
// that ran while it waited below it (their screenshots: the app shows "Created a
// file, ran a command" between two messages the phone drew back to back).
describe('where a queued send lands', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const T = (clock: string) => Date.parse(`2026-09-20T${clock}Z`)
  const call = (id: string, clock: string): NativeChatMessage => ({ ...assistant(id), timestamp: T(clock) })
  const first8 = [
    call('c1', '08:23:04.245'), call('c2', '08:23:08.121'), call('c3', '08:23:12.794'), call('c4', '08:23:28.644'),
    call('c5', '08:23:34.525'), call('c6', '08:23:38.300'), call('c7', '08:23:42.801'), call('c8', '08:23:46.406')
  ]
  const c9 = call('c9', '08:23:58.446')
  const c10 = call('c10', '08:24:32.294')
  const text = 'actaully ran 10 shell commands my mobile shows only 8 see what happened and fix that bug confirm with jev'
  const prompts: DesktopPrompt[] = [{ nonce: 'status:s:1789892639646:3', text, at: T('08:23:59.646') }]

  function ProbeAbsorbed({ raw }: { raw: readonly NativeChatMessage[] }) {
    latest = useDesktopPromptEchoes(prompts, raw, raw)
    return null
  }

  it('follows a row that loads late but was written before the send', () => {
    act(() => {
      renderer = create(createElement(ProbeAbsorbed, { raw: first8 }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('c8')
    act(() => {
      renderer!.update(createElement(ProbeAbsorbed, { raw: [...first8, c9] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('c9')
  })

  it('stays where it was sent after its queue row leaves the box, as the Claude app draws it', () => {
    act(() => {
      renderer = create(createElement(ProbeAbsorbed, { raw: [...first8, c9] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('c9')
    // The agent takes it after c10; the queue box letting it go must not move it.
    act(() => {
      renderer!.update(createElement(ProbeAbsorbed, { raw: [...first8, c9, c10] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('c9')
  })
})

// 2026-09-23, this very session (Claude Code 2.1.280, 967668df…jsonl): the user
// sent "I also need this unlock search on web and find a way" at 17:03:39.384,
// nine seconds after a Bash call; a Write (17:04:03) and a Bash (17:04:05) ran
// before the agent took it at 17:04:12, with that Bash's result. Its only
// transcript record is a queued_command attachment, which Orca's reader drops,
// so the hook's copy is what draws it. It must sit after the first call, with
// the Write and the Bash below it — the Claude app's order.
describe('a message sent mid-turn, from this session', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const T = (clock: string) => Date.parse(`2026-09-23T${clock}Z`)
  const at = (id: string, clock: string): NativeChatMessage => ({ ...assistant(id), timestamp: T(clock) })
  const readHudTest = at('bash-read-hud', '17:03:30.100')
  const createTestFile = at('write-windows-test', '17:04:03.000')
  const runTests = at('bash-vitest', '17:04:05.000')
  const text = 'I also need this unlock search on web and find a way'
  const prompts: DesktopPrompt[] = [{ nonce: 'status:s:1790183019384:0', text, at: T('17:03:39.384') }]
  function ProbeSession({ raw }: { raw: readonly NativeChatMessage[] }) {
    latest = useDesktopPromptEchoes(prompts, raw, raw)
    return null
  }

  it('sits after the call it was sent after, not after the calls that ran while it waited', () => {
    act(() => {
      renderer = create(createElement(ProbeSession, { raw: [readHudTest] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('bash-read-hud')
    // The agent takes it with the Bash result; the queue box lets it go then.
    act(() => {
      renderer!.update(createElement(ProbeSession, { raw: [readHudTest, createTestFile, runTests] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('bash-read-hud')
  })
})

// 2026-09-20, phone: a tab opened on a session already an hour into its
// turn showed the prompt CUT at the hook's 200 characters, under the tool
// fold, with nothing above. The prompt's own row (2,858 characters, 09:19:09)
// was above the page the phone had loaded (the tail of 122 rows); the echo
// could not retire against it, and its time was the status clock at first
// sight — a tool ping minutes later — so it anchored at the tail. A prompt
// older than every loaded row, on a page with rows above it, is a row the
// phone has not loaded yet: not a bubble to guess.
describe('a prompt older than the loaded page', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const T = (clock: string) => Date.parse(`2026-09-20T${clock}Z`)
  const raw = [
    { ...assistant('a-fetch-1'), timestamp: T('09:36:47.526') },
    { ...assistant('a-fetch-2'), timestamp: T('09:36:49.774') }
  ]
  const prompts: DesktopPrompt[] = [
    { nonce: 'status:6116568a:1789895949068:0', text: '<pasted_content id="329c"> Find me a men\'s insulated winter jacket', cut: true, at: T('09:19:09.068') }
  ]
  function ProbeEarlier({ hasEarlier }: { hasEarlier: boolean }) {
    latest = useDesktopPromptEchoes(prompts, raw, raw, hasEarlier)
    return null
  }

  it('is not drawn while earlier rows are still unloaded', () => {
    act(() => {
      renderer = create(createElement(ProbeEarlier, { hasEarlier: true }))
    })
    expect(latest).toEqual([])
  })

  it('leads the conversation when the page is the whole transcript', () => {
    act(() => {
      renderer = create(createElement(ProbeEarlier, { hasEarlier: false }))
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]!.baselineTailMessageId).toBeNull()
  })
})

// 2026-09-23, the same session: the user sent "Also i observed i dont get
// notifications…" at 17:23:21.228, 1.6 s after the agent's "All 9 tests pass…"
// row was written (17:23:19.618) and before the phone had loaded it. The chat
// drew the message above that reply; the terminal drew it below. Anchored by
// its send time, it follows the late row once it loads.
describe('a message sent just after a reply the phone had not loaded yet', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const T = (clock: string) => Date.parse(`2026-09-23T${clock}Z`)
  const toolResult = { ...assistant('bash-result'), timestamp: T('17:23:09.702') }
  const reply = { ...assistant('all-9-pass'), timestamp: T('17:23:19.618') }
  const nextCall = { ...assistant('bash-sightings'), timestamp: T('17:23:24.672') }
  const prompts: DesktopPrompt[] = [
    {
      nonce: 'status:s:1790184201228:0',
      text: 'Also i observed i dont get notifications when code ui is working in bg and not in recent apps',
      at: T('17:23:21.228')
    }
  ]
  function ProbeLate({ raw }: { raw: readonly NativeChatMessage[] }) {
    latest = useDesktopPromptEchoes(prompts, raw, raw)
    return null
  }

  it('sits below the reply written before it, once that reply loads', () => {
    act(() => {
      renderer = create(createElement(ProbeLate, { raw: [toolResult] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('bash-result')
    act(() => {
      renderer!.update(createElement(ProbeLate, { raw: [toolResult, reply, nextCall] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('all-9-pass')
  })

  it('still follows that reply when the hook named the row before it', () => {
    // The hook names the transcript's last record at submit; a reply still
    // streaming is not one yet, so the row it names is the tool result above.
    const named = [{ ...prompts[0]!, nonce: 'status:s:1790184201228:1', anchorId: 'bash-result' }]
    function ProbeNamed({ raw }: { raw: readonly NativeChatMessage[] }) {
      latest = useDesktopPromptEchoes(named, raw, raw)
      return null
    }
    act(() => {
      renderer = create(createElement(ProbeNamed, { raw: [toolResult] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('bash-result')
    act(() => {
      renderer!.update(createElement(ProbeNamed, { raw: [toolResult, reply, nextCall] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('all-9-pass')
  })
})

// Session 967668df, 2026-09-23 (Claude Code 2.1.281): the user sent "See this
// message to mahdi…" from the Claude app at 23:19:27.671. A thinking block and
// a tool call stamped 23:19:27.450 and .458, a fifth of a second earlier, were
// written after the enqueue. The Claude app drew them below the message, since
// they appear when written and not as they stream; Code UI pulled them above
// because they were stamped first. Only a row stamped a second or more before
// the send ("All 9 tests", 1.6 s) is the reply the reader saw before sending.
describe('a message sent a moment before the rows under it were written', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const T = (clock: string) => Date.parse(`2026-09-23T${clock}Z`)
  const listed = { ...assistant('list-hook-events'), timestamp: T('23:19:14.200') }
  const thinking = { ...assistant('i-confirmed-orca'), timestamp: T('23:19:27.450') }
  const call = { ...assistant('read-turn-boundary'), timestamp: T('23:19:27.458') }
  const prompts: DesktopPrompt[] = [
    {
      nonce: 'status:s:1790205567671:0',
      text: 'See this message to mahdi looked nicely formatted in claude mobile app',
      at: T('23:19:27.671'),
      anchorId: 'list-hook-events'
    }
  ]
  function ProbeJustBefore({ raw }: { raw: readonly NativeChatMessage[] }) {
    latest = useDesktopPromptEchoes(prompts, raw, raw)
    return null
  }

  it('stays above a thinking block and a call stamped a fifth of a second before the send', () => {
    act(() => {
      renderer = create(createElement(ProbeJustBefore, { raw: [listed] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeJustBefore, { raw: [listed, thinking, call] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('list-hook-events')
  })
})

// 2026-09-29, "All 3 prompts stacked together with no responses in between
// them": the prompt hook now says when it ran, by the desk's clock (`typedAt`,
// from `ts=`), which places a copy whose named row the chat does not hold.
// The desk clock stamps both the rows and the hook's second.
describe('a beacon copy that says when it was typed', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  // Whole seconds of 2026-09-29, as the hook sends them; the rows' stamps are
  // offsets from the same start.
  const T0 = Date.parse('2026-09-29T05:36:00.000Z')
  const row = (id: string, offset: number): NativeChatMessage => ({ ...assistant(id), timestamp: T0 + offset })
  function Paged({ prompts, raw, hasEarlier }: { prompts: readonly DesktopPrompt[]; raw: readonly NativeChatMessage[]; hasEarlier: boolean }) {
    latest = useDesktopPromptEchoes(prompts, raw, raw, hasEarlier, true)
    return null
  }
  const draw = (prompts: DesktopPrompt[], raw: NativeChatMessage[], hasEarlier = false) => {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Paged, { prompts, raw, hasEarlier }))
      } else {
        renderer = create(createElement(Paged, { prompts, raw, hasEarlier }))
      }
    })
  }

  it('sits after the last row written before it when the row it names is not held', () => {
    draw([{ nonce: 'typed-1', text: 'typed', anchorId: 'not-held', typedAt: T0 + 2000, seenAt: Date.now() }], [row('t1', 1000), row('t2', 2000), row('t3', 3000)])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['t2'])
  })

  it('is not drawn under a page it was typed before, while earlier rows are not loaded', () => {
    draw([{ nonce: 'typed-2', text: 'typed', anchorId: 'not-held', typedAt: T0, seenAt: Date.now() }], [row('p1', 1000)], true)
    expect(latest).toEqual([])
    // The page above loads: it goes where it was typed.
    draw([{ nonce: 'typed-2', text: 'typed', anchorId: 'not-held', typedAt: T0, seenAt: Date.now() }], [row('p0', -1000), row('p1', 1000)], true)
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['p0'])
  })

  it('leads a whole chat whose only row was written after it', () => {
    draw([{ nonce: 'typed-3', text: 'typed', anchorId: 'not-held', typedAt: T0, seenAt: Date.now() }], [row('o1', 1000)])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual([null])
  })

  it('is drawn at the end of an empty chat, then where it was typed once rows load', () => {
    const prompts: DesktopPrompt[] = [{ nonce: 'typed-4', text: 'typed', anchorId: 'not-held', typedAt: T0 + 1000, seenAt: Date.now() }]
    draw(prompts, [])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual([null])
    draw(prompts, [row('e1', 1000), row('e2', 2000), row('e3', 3000)])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['e1'])
  })

  // The warm start restores a stored copy's fields unchecked: a `typedAt` the
  // beacon never writes is no time at all, not the start of the epoch.
  it('treats a stored typedAt that is not a time as no time', () => {
    draw([{ nonce: 'typed-6', text: 'typed', anchorId: 'not-held', typedAt: 0, seenAt: Date.now() }], [row('z1', 1000), row('z2', 2000)])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['z2'])
    draw([{ nonce: 'typed-7', text: 'typed', anchorId: 'not-held', typedAt: 1790660194, seenAt: Date.now() }], [row('z1', 1000), row('z2', 2000)])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['z2'])
  })

  // Found long after it arrived (a relaunch restores it from the warm start):
  // a copy with no time was held back while its row was not loaded, and with
  // every row loaded it was never drawn. With a time it has a place.
  it('is placed by its time when found long after it arrived, not refused', () => {
    const longAgo = Date.now() - 11 * 60_000
    draw([{ nonce: 'typed-5', text: 'typed', anchorId: 'not-held', typedAt: T0 + 2000, seenAt: longAgo }], [row('f1', 1000), row('f2', 2000), row('f3', 3000)])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['f2'])
  })
})

// Review of 15fcfbea: the "drawn where first seen" line fired on the first
// reading a copy with no time waited, and most such copies find their row a
// reading later. It is said when the wait runs out, where it is true.
describe('the log line for a copy drawn where it was first seen', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })
  const row = (id: string, t: number): NativeChatMessage => ({ ...assistant(id), timestamp: t })

  it('is not written for a copy that finds its named row on the next reading', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const copy: DesktopPrompt[] = [{ nonce: 'log-1', text: 'typed at the desk', anchorId: 'n2', seenAt: Date.now() }]
    act(() => {
      renderer = create(createElement(Probe, { prompts: copy, raw: [row('n1', 1000)] }))
    })
    act(() => {
      renderer!.update(createElement(Probe, { prompts: copy, raw: [row('n1', 1000), row('n2', 2000)] }))
    })
    expect(latest[0]!.baselineTailMessageId).toBe('n2')
    expect(warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('drawn where first seen'))).toEqual([])
  })

  it('is written once when the wait runs out with the row never held', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const copy: DesktopPrompt[] = [{ nonce: 'log-2', text: 'typed at the desk', anchorId: 'never', seenAt: Date.now() }]
    act(() => {
      renderer = create(createElement(Probe, { prompts: copy, raw: [row('m1', 1000)] }))
    })
    for (let reading = 0; reading < 40; reading += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts: copy, raw: [row('m1', 1000)] }))
      })
    }
    expect(warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('drawn where first seen'))).toHaveLength(1)
  })
})
