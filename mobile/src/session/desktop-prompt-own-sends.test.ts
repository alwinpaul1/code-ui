import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DesktopPrompt } from './agent-hud-beacon'
import {
  inSendOrder,
  pairPendingWithHookPrompts,
  promptsNoCopyStandsFor
} from './desktop-prompt-own-sends'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'

type Copy = { id: string; text: string; images?: string[]; sentAt?: number }

/** The pending copies drawn and the hook prompts drawn beside them, with the
 *  queue box's rows left out the way the overlay leaves them out. */
function drawn(pending: Copy[], prompts: DesktopPrompt[], queued: string[] = []) {
  const pairing = pairPendingWithHookPrompts(pending, prompts)
  return {
    pending: pending.filter((item) => !pairing.steppedAside.has(item.id)).map((item) => item.id),
    hook: withoutLandedDesktopPrompts(promptsNoCopyStandsFor(prompts, pairing), [], queued).map((p) => p.nonce)
  }
}

describe('a pending copy the hook has a timed twin of', () => {
  // Device, 2026-09-19: "did you check the hold and copy scrolling issue on
  // phone" drew three turns under the reply that answered it. That echo had
  // no send time and guessed its place; the hook's copy is timed. An echo
  // restored from a build that did not record `sentAt` is still that echo.
  it('steps aside for the twin when it has no send time of its own', () => {
    const pending = [
      { id: 'pending-1', text: 'did you check the hold and copy scrolling issue on phone' },
      { id: 'pending-2', text: 'unrelated, still only ours' }
    ]
    const prompts = [
      { nonce: 'uuid-1', text: 'did you check the hold and copy scrolling issue on phone', anchorId: 'row', at: 1_000 },
      { nonce: 'pid-9', text: 'unrelated, still only ours' } // a beacon with no time
    ]
    // The timed twin replaces the first; the untimed one is the second's copy.
    expect(drawn(pending, prompts)).toEqual({ pending: ['pending-2'], hook: ['uuid-1'] })
  })

  it('keeps an echo that carries photos: the record has no bytes for them', () => {
    const pending = [{ id: 'pending-1', text: 'look at this', images: ['file:///a.jpg'] }]
    const prompts = [{ nonce: 'uuid-1', text: 'look at this', at: 1 }]
    expect(drawn(pending, prompts)).toEqual({ pending: ['pending-1'], hook: [] })
  })

  // Session 967668df, lines 8612–8617: rows stamped 0.2 s before a send and
  // written after it sit above the hook's copy and below the phone's.
  it("keeps a text send that knows when it left the phone, and hides the hook's copy of it", () => {
    const text = 'See this message to mahdi looked nicely formatted in claude mobile app'
    const pending = [{ id: 'phone-send', text, sentAt: 1_790_205_567_671 }]
    const hook = [{ nonce: 'status:s:1790205567700:0', text, at: 1_790_205_567_700 }]
    expect(drawn(pending, hook)).toEqual({ pending: ['phone-send'], hook: [] })
  })

  it('treats a send time read back from disk as anything but a number as none', () => {
    const pending = [{ id: 'restored', text: 'x', sentAt: 'soon' as unknown as number }]
    const hook = [{ nonce: 'status:s:1:0', text: 'x', at: 1 }]
    expect(drawn(pending, hook)).toEqual({ pending: [], hook: ['status:s:1:0'] })
  })

  it('matches on the normalised text, markers and all', () => {
    const pending = [{ id: 'pending-1', text: '[Image #4] Also see a message' }]
    const prompts = [{ nonce: 'uuid-1', text: '[Image #4]  Also see a message', at: 1 }]
    expect(drawn(pending, prompts)).toEqual({ pending: [], hook: ['uuid-1'] })
  })

  it('pairs a photo send with its hook copy when the copy puts the markers before a skill token', () => {
    const pending = [{ id: 'photo', text: '/codeui:review the placement', images: ['file:///a.jpg'], sentAt: 5 }]
    const prompts = [{ nonce: 'n', text: '[Image #20] /codeui:review the placement', at: 6 }]
    expect(drawn(pending, prompts)).toEqual({ pending: ['photo'], hook: [] })
  })

  it('changes nothing while the hook has reported nothing, or there is nothing pending', () => {
    expect(drawn([{ id: 'pending-1', text: 'x' }], [])).toEqual({ pending: ['pending-1'], hook: [] })
    expect(drawn([], [{ nonce: 'n', text: 'x', at: 1 }])).toEqual({ pending: [], hook: ['n'] })
    expect(drawn([], [])).toEqual({ pending: [], hook: [] })
  })
})

// Review, 2026-09-24: matched as a set of texts, one pending "yes" hid every
// hook "yes", the desk's later one and a remembered earlier one included.
describe('copies of the same text pair one to one', () => {
  const at = (seconds: number) => 1_790_205_500_000 + seconds * 1_000

  it("hides only the phone send's own copy, and draws a later message typed elsewhere with the same text", () => {
    const pending = [{ id: 'phone-yes', text: 'yes', sentAt: at(5) }]
    const prompts = [
      { nonce: 'own', text: 'yes', at: at(5.05) },
      { nonce: 'other', text: 'now look at the logs', at: at(12) },
      { nonce: 'later', text: 'yes', at: at(20) }
    ]
    expect(drawn(pending, prompts)).toEqual({ pending: ['phone-yes'], hook: ['other', 'later'] })
  })

  // `desk-older` is the pending store's memory of the desk's earlier "yes".
  it('leaves an older message with the same text to its own copy', () => {
    const pending = [{ id: 'desk-older', text: 'yes' }, { id: 'phone-yes', text: 'yes', sentAt: at(20) }]
    const prompts = [
      { nonce: 'older', text: 'yes', at: at(19) },
      { nonce: 'own', text: 'yes', at: at(20.05) }
    ]
    expect(drawn(pending, prompts)).toEqual({ pending: ['phone-yes'], hook: ['older'] })
  })

  it("keeps both drawn while the phone send's own copy has not arrived", () => {
    const pending = [{ id: 'desk-older', text: 'yes' }, { id: 'phone-yes', text: 'yes', sentAt: at(20) }]
    const prompts = [{ nonce: 'older', text: 'yes', at: at(19) }]
    expect(drawn(pending, prompts)).toEqual({ pending: ['phone-yes'], hook: ['older'] })
  })

  // After a relaunch the status copy is read at first sight and timed by when
  // the pane's state began (agent-status-prompts.ts), minutes before the send.
  it('pairs a restored send with the status copy re-read after a relaunch, however early it is timed', () => {
    const pending = [{ id: 'phone-send', text: 'check the fold again please', sentAt: at(300) }]
    const prompts = [{ nonce: 'status:s:1790205500000:0', text: 'check the fold again please', at: at(0) }]
    expect(drawn(pending, prompts)).toEqual({ pending: ['phone-send'], hook: [] })
  })

  it('pairs a long send with the copy the status cut at 200 characters, and nothing else with it', () => {
    const long = `${'word '.repeat(60)}end`
    const cut = { nonce: 'status:s:1:0', text: long.slice(0, 200), cut: true, at: at(5.1) }
    expect(drawn([{ id: 'phone-long', text: long, sentAt: at(5) }], [cut])).toEqual({ pending: ['phone-long'], hook: [] })
    expect(drawn([{ id: 'other', text: 'word word', sentAt: at(5) }], [cut])).toEqual({ pending: ['other'], hook: ['status:s:1:0'] })
  })

  // A phone-launched session reports each submission twice, and
  // mergeDesktopPrompts keeps both when the texts differ (one of them cut).
  it("hides the status copy and the beacon's copy of one send", () => {
    const long = `${'word '.repeat(60)}end`
    const prompts = [
      { nonce: 'status:s:1:0', text: long.slice(0, 200), cut: true, at: at(5.1) },
      { nonce: '4242', text: long, at: at(5.05) }
    ]
    expect(drawn([{ id: 'phone-long', text: long, sentAt: at(5) }], prompts)).toEqual({ pending: ['phone-long'], hook: [] })
  })

  it('takes the nearest copy, not the first', () => {
    const pending = [{ id: 'phone-yes', text: 'yes', sentAt: at(20) }]
    const prompts = [
      { nonce: 'desk', text: 'yes', at: at(15) },
      { nonce: 'own', text: 'yes', at: at(20.05) }
    ]
    expect(drawn(pending, prompts)).toEqual({ pending: ['phone-yes'], hook: ['desk'] })
  })

  it('takes an untimed copy only when no timed one fits', () => {
    const pending = [{ id: 'phone-yes', text: 'yes', sentAt: at(20) }]
    expect(drawn(pending, [{ nonce: 'beacon', text: 'yes' }])).toEqual({ pending: ['phone-yes'], hook: [] })
    expect(
      drawn(pending, [{ nonce: 'beacon', text: 'yes' }, { nonce: 'own', text: 'yes', at: at(21) }])
    ).toEqual({ pending: ['phone-yes'], hook: ['beacon'] })
  })

  it('pairs two phone sends of one text with one copy each', () => {
    const pending = [
      { id: 'first', text: 'yes', sentAt: at(5) },
      { id: 'second', text: 'yes', sentAt: at(30) }
    ]
    const prompts = [
      { nonce: 'a', text: 'yes', at: at(5.1) },
      { nonce: 'b', text: 'yes', at: at(30.1) }
    ]
    expect(drawn(pending, prompts)).toEqual({ pending: ['first', 'second'], hook: [] })
  })
})

// 2026-09-19, phone screenshot: "Ask jev to confirm these fixes and bugs…"
// drawn as a bubble AND listed in the queue box below it for the 19 s the
// agent took to absorb it (transcript: enqueue 22:38:47, absorbed 22:39:06).
// The own bubble had stepped aside for the hook's timed copy, and that copy
// knew nothing of the queue box. A message typed elsewhere has only the hook's
// copy, and it queues the same way.
describe('a send still in the agent queue box', () => {
  const typed =
    'Ask jev to confirm these fixes and bugs if no dig deeper and find the bugs and confirm it and then fix and bump the version to 0.9.4'
  // As the box paints it at the phone's width, joined by the parser.
  const painted = [
    'Ask jev to confirm these fixes and',
    'bugs if no dig deeper and find the',
    'bugs and confirm it and then fix and',
    'bump the version to 0.9.4'
  ].join('\n')
  const hook = [{ nonce: 'status:s:1789857527552:0', text: typed, at: 1789857527552 }]

  it('is not drawn as a desktop-prompt bubble while the queue box shows it', () => {
    expect(drawn([{ id: 'p', text: typed }], hook, [painted]).hook).toEqual([])
    expect(drawn([], hook, [painted]).hook).toEqual([])
  })

  // The defect was one of STRUCTURE: the overlay excluded only the pending
  // texts, so the pure filter was right and never told the queue. Pin the
  // call site, on code not commentary.
  it('is what the overlay excludes, queue rows included', () => {
    const source = readFileSync(new URL('./MobileNativeChatOverlay.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(
      /withoutLandedDesktopPrompts\(\s*promptsNoCopyStandsFor\(desktopPrompts, hookPairing\),\s*baseFolded,\s*queuedMessages \?\? \[\]\s*\)/
    )
  })

  it('is drawn from the hook once the row leaves the box, when no copy of its own has a send time', () => {
    expect(drawn([{ id: 'p', text: typed }], hook)).toEqual({ pending: [], hook: [hook[0]!.nonce] })
  })

  it("is drawn as the phone's own send once the row leaves the box, and the hook's copy stays out", () => {
    expect(drawn([{ id: 'p', text: typed, sentAt: 1789857527400 }], hook)).toEqual({ pending: ['p'], hook: [] })
  })
})

describe('bubbles that follow the same row', () => {
  const own = (id: string, sentAt?: number) => ({ id, ...(sentAt === undefined ? {} : { sentAt }) })
  const times: Record<string, number | undefined> = { 'desk-1': 10, 'desk-2': 30, 'desk-x': undefined }
  const order = (mine: { id: string; sentAt?: number }[], theirs: string[]) =>
    inSendOrder(mine, theirs.map((id) => ({ id })), (copy) => times[copy.id]).map((copy) => copy.id)

  it('draw in the order they were sent, each list keeping its own order', () => {
    expect(order([own('p-1', 20), own('p-2', 40)], ['desk-1', 'desk-2'])).toEqual(['desk-1', 'p-1', 'desk-2', 'p-2'])
  })

  // An untimed hook copy is a beacon's, which mergeDesktopPrompts puts last.
  it("keep a phone copy with no time ahead of the hook's, and a hook copy with no time last", () => {
    expect(order([own('restored'), own('p-1', 20)], ['desk-1', 'desk-x'])).toEqual(['restored', 'desk-1', 'p-1', 'desk-x'])
  })

  it('keep one list as it is when the other is empty', () => {
    expect(order([], ['desk-2', 'desk-1'])).toEqual(['desk-2', 'desk-1'])
    expect(order([own('p-2', 40), own('p-1', 20)], [])).toEqual(['p-2', 'p-1'])
    expect(order([], [])).toEqual([])
  })
})
