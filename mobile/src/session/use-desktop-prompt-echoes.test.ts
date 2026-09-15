import { afterEach, describe, expect, it } from 'vitest'
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
    expect(latest[0]!.baselineTailMessageId).toBe(null)
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
    expect(latest[0]!.baselineTailMessageId).not.toBe('r2')
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
    expect(latest[0]!.baselineTailMessageId).toBe('z2')
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
