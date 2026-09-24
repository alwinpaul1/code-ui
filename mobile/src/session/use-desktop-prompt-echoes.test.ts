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

  // 2026-09-19, on the device: the transcript names the row a queued prompt
  // was written after, but that row is a tool call Orca never projects, so
  // the id was never held, the wait ran out, and the bubble fell to the
  // arrival tail — three turns under the reply that answered it. The record's
  // own time places it after the last row written before it.
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
    expect(latest[0]!.baselineTailMessageId).toBe('x2')
    // A later turn must not drag it down now that it has settled.
    act(() => {
      renderer!.update(
        createElement(Probe, { prompts, raw: [assistant('x1'), assistant('x2'), assistant('x3')] })
      )
    })
    expect(latest[0]!.baselineTailMessageId).toBe('x2')
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
