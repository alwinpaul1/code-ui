// Gap D of the final review of fix/midturn-prompt-at-end, 2026-09-29: the same
// words sent mid-turn, then typed at the desk as the next turn's prompt. The
// next turn's row retired the first turn's bubble. A desk message the agent
// took at a known time lands only on the row Claude dequeues it as. The
// overlay cases are in mobile-chat-midturn-prompt-after-reply.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { useDeskCopyReleases, withoutLandedDeskCopies } from './desk-copy-releases'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

const T = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)
const WORDS = 'Whats this'
const user = (id: string, clock: string, text = WORDS): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'text', text }],
  timestamp: T(clock),
  source: 'transcript'
})
const watched: DesktopPrompt = { nonce: 'status:s:1790660194891:1', text: WORDS, at: T('05:36:34.891'), seenAt: T('05:36:35.000') }

describe('a desk copy the agent took at a known time', () => {
  const releases = new Map([[watched.nonce, T('05:36:34.891')]])

  it('lands on the row stamped as it was taken, and on no later row of its words', () => {
    const own = user('own', '05:36:34.700')
    expect(withoutLandedDeskCopies([watched], releases, [own], [], [own])).toEqual([])
    const nextTurn = user('next', '05:49:46.995')
    expect(withoutLandedDeskCopies([watched], releases, [nextTurn], [], [nextTurn])).toEqual([watched])
  })

  it('leaves every other copy to land on any row of its words, and to the queue box', () => {
    const found: DesktopPrompt = { ...watched, nonce: 'status:s:1790658480600:0', at: T('05:08:00.600'), atStateStart: true }
    const nextTurn = user('next', '05:49:46.995')
    expect(withoutLandedDeskCopies([found], releases, [nextTurn], [], [nextTurn])).toEqual([])
    const other: DesktopPrompt = { ...watched, nonce: 'status:s:1:2', text: 'still queued' }
    expect(withoutLandedDeskCopies([watched, other], releases, [], ['still queued'], [])).toEqual([watched])
  })

  // Degenerate: nothing to filter, and no row at all.
  it('changes nothing with no copies, and keeps a taken copy with no rows', () => {
    expect(withoutLandedDeskCopies([], releases, [], [], [])).toEqual([])
    expect(withoutLandedDeskCopies([watched], releases, [], [], [])).toEqual([watched])
  })
})

describe('when the agent took a desk copy the chat watched arrive', () => {
  function reader(taken: [string, number][] = []) {
    let renderer: ReactTestRenderer | null = null
    let out: ReadonlyMap<string, number> = new Map()
    const take = (ids: readonly string[], at: number) => taken.push(...ids.map((id) => [id, at] as [string, number]))
    function Probe({ prompts, queued, stored }: { prompts: DesktopPrompt[]; queued: string[]; stored: string[] }) {
      out = useDeskCopyReleases(prompts, queued, take, new Set(stored))
      return null
    }
    return (prompts: DesktopPrompt[], queued: string[], stored: string[] = []) => {
      act(() => {
        const element = createElement(Probe, { prompts, queued, stored })
        if (renderer) {
          renderer.update(element)
        } else {
          renderer = create(element)
        }
      })
      return new Map(out)
    }
  }

  it('is its own stamp when the queue box never listed it, once the chat has waited for the box', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T('05:36:36.000'))
    const read = reader()
    expect(read([watched], [])).toEqual(new Map())
    vi.setSystemTime(T('05:36:41.000'))
    expect(read([watched], [])).toEqual(new Map([[watched.nonce, watched.at]]))
    vi.useRealTimers()
  })

  it('is when the box let it go, and again after it was listed again', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T('05:36:36.000'))
    const read = reader()
    read([watched], [WORDS])
    vi.setSystemTime(T('05:37:32.000'))
    expect(read([watched], [])).toEqual(new Map([[watched.nonce, T('05:37:32.000')]]))
    vi.setSystemTime(T('05:37:40.000'))
    expect(read([watched], [`${WORDS}`])).toEqual(new Map())
    vi.setSystemTime(T('05:37:45.000'))
    expect(read([watched], [])).toEqual(new Map([[watched.nonce, T('05:37:45.000')]]))
    vi.useRealTimers()
  })

  it('is unknown for a copy the chat found, held back, or read off the beacon', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T('05:50:00.000'))
    const read = reader()
    const copies: DesktopPrompt[] = [
      { ...watched, nonce: 'status:s:1790658480600:0', atStateStart: true },
      { nonce: 'status:s:x:1', text: WORDS, heldBack: true, seenAt: T('05:36:35.000') },
      { nonce: '48213', text: WORDS, anchorId: 'a1', seenAt: T('05:36:35.000') }
    ]
    expect(read(copies, [])).toEqual(new Map())
    vi.useRealTimers()
  })

  it('marks the stored witness of that copy taken then', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T('05:36:41.000'))
    const taken: [string, number][] = []
    reader(taken)([watched], [], [`desk-${watched.nonce}`])
    expect(taken).toEqual([[`desk-${watched.nonce}`, watched.at]])
    vi.useRealTimers()
  })
})

describe('a stored witness the agent took', () => {
  const witness = (takenAt?: number): MobileNativeChatPendingMessage => ({
    id: `desk-${watched.nonce}`,
    text: WORDS,
    expectedOccurrence: 1,
    baselineTailMessageId: 'a1',
    baselineResolved: true,
    ...(takenAt !== undefined ? { takenAt } : {})
  })

  it('is retired by the row Claude dequeued it as, not by a later row of its words', () => {
    const dequeued = user('own', '05:46:54.300')
    expect(retireLandedMobileNativeChatPending([dequeued], [witness(T('05:46:54.800'))], new Set())).toEqual([])
    const nextTurn = user('next', '05:49:46.995')
    const kept = witness(watched.at)
    expect(retireLandedMobileNativeChatPending([nextTurn], [kept], new Set())).toEqual([kept])
  })

  it('is retired by any row of its words when the chat never knew when it was taken, as before', () => {
    expect(retireLandedMobileNativeChatPending([user('next', '05:49:46.995')], [witness()], new Set())).toEqual([])
  })
})
