// Coverage for five functions the suite did not touch at all, found by an
// invariant audit on 2026-09-15 while tracking down replies vanishing from the
// phone. Each one guards something the callers rely on and nothing else
// asserted: the identity-stability returns that stop an effect loop, the
// pre-session waiting bucket, and the echo list's array identity, which the
// transcript fold and the list's render data both take as a dependency — a new
// array on every 1 Hz screen poll refolds the whole conversation.
// Regression harness for scenario-matrix cells that had NO existing test as of
// 2026-09-15, written against CURRENT source (main @ b2abea7) so every case
// below passes today. Run again after the pending-echo placement fix lands:
// anything that flips from pass to fail is a regression the fix introduced.
//
// Targets (see mobile-native-chat-pending-echo.ts and use-stable-echoes.ts):
//   1. combineMobileNativeChatPending  — session pending + not-yet-assigned pending, deduped by id
//   2. mergeWaitingSessionPending      — moving a pre-session send onto its now-known session key
//   3. removeWaitingSessionPending     — clearing the pre-session bucket after the move
//   4. dropMobileNativeChatPending     — cancelling one queued echo (identity-stable no-op)
//   5. useStableEchoes                 — referential stability across a 1 Hz poll
//
// None of these five have a dedicated unit test anywhere in the repo today.
// combine/merge/remove are only ever exercised indirectly, end-to-end, through
// one scenario in use-mobile-native-chat-drafts.test.ts ("preserves first-send
// images through session assignment..."); drop is only ever exercised through
// a mocked removePending in use-mobile-native-chat-queue-editor.test.ts (the
// mock never touches the real function); useStableEchoes has no test file at
// all (confirmed: no use-stable-echoes.test.ts exists).
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import {
  combineMobileNativeChatPending,
  mergeWaitingSessionPending,
  removeWaitingSessionPending,
  dropMobileNativeChatPending,
  type MobileNativeChatPendingMessage
} from './mobile-native-chat-pending-echo'
import { useStableEchoes } from './use-stable-echoes'

function echo(id: string, overrides: Partial<MobileNativeChatPendingMessage> = {}): MobileNativeChatPendingMessage {
  return {
    id,
    text: overrides.text ?? `text-${id}`,
    expectedOccurrence: overrides.expectedOccurrence ?? 1,
    baselineTailMessageId: overrides.baselineTailMessageId ?? null,
    baselineResolved: overrides.baselineResolved ?? true,
    ...overrides
  }
}

describe('combineMobileNativeChatPending: a send made before the session id was known', () => {
  it('returns the session list untouched, by reference, when nothing is waiting', () => {
    const session = [echo('s1')]
    expect(combineMobileNativeChatPending(session, [])).toBe(session)
  })

  it('appends a waiting echo after the session echoes, in order', () => {
    const session = [echo('s1')]
    const waiting = [echo('w1')]
    expect(combineMobileNativeChatPending(session, waiting).map((item) => item.id)).toEqual([
      's1',
      'w1'
    ])
  })

  it('never draws the same echo twice while the move from waiting to session is in flight', () => {
    // The drafts hook's effect moves a waiting echo into `pendingBySession` and
    // then, on the SAME render, removes it from `pendingWaitingForSession` in a
    // second setState. Between those two updates both lists can legitimately
    // hold the id at once; the combined view must still show it once.
    const session = [echo('s1'), echo('w1')]
    const waiting = [echo('w1')]
    expect(combineMobileNativeChatPending(session, waiting).map((item) => item.id)).toEqual([
      's1',
      'w1'
    ])
  })
})

describe('mergeWaitingSessionPending: assigning a session id to an already-sent echo', () => {
  it('moves a waiting echo onto its newly-known session key', () => {
    const previous = {}
    const next = mergeWaitingSessionPending(previous, 'session-1', [echo('w1')])
    expect(next['session-1']?.map((item) => item.id)).toEqual(['w1'])
  })

  it('appends after whatever the session already holds, not replacing it', () => {
    const previous = { 'session-1': [echo('s1')] }
    const next = mergeWaitingSessionPending(previous, 'session-1', [echo('w1')])
    expect(next['session-1']?.map((item) => item.id)).toEqual(['s1', 'w1'])
  })

  it('returns the SAME previous reference when the session already has every waiting id', () => {
    // Guards an effect-loop: the drafts hook re-runs this every render while
    // `waitingForSession` is non-empty, keyed off its own result. A new object
    // here when nothing actually moved would re-trigger the effect forever.
    const previous = { 'session-1': [echo('w1')] }
    expect(mergeWaitingSessionPending(previous, 'session-1', [echo('w1')])).toBe(previous)
  })
})

describe('removeWaitingSessionPending: clearing the pre-session bucket after the move', () => {
  it('drops only the moved ids, keeping any echo sent after the session was assigned', () => {
    const previous = { 'draft-1': [echo('w1'), echo('w2')] }
    const next = removeWaitingSessionPending(previous, 'draft-1', new Set(['w1']))
    expect(next['draft-1']?.map((item) => item.id)).toEqual(['w2'])
  })

  it('deletes the draft key entirely once its bucket empties, rather than leaving []', () => {
    const previous = { 'draft-1': [echo('w1')] }
    const next = removeWaitingSessionPending(previous, 'draft-1', new Set(['w1']))
    expect('draft-1' in next).toBe(false)
  })

  it('returns the SAME previous reference when the draft key was never a waiting bucket', () => {
    // Same effect-loop hazard as mergeWaitingSessionPending's no-op case.
    const previous = { 'other-draft': [echo('x1')] }
    expect(removeWaitingSessionPending(previous, 'draft-1', new Set(['w1']))).toBe(previous)
  })
})

describe('dropMobileNativeChatPending: the user cancels one queued echo from the editor', () => {
  it('drops the bubble for the cancelled id and leaves its neighbours in place', () => {
    const previous = { key: [echo('a'), echo('b'), echo('c')] }
    const next = dropMobileNativeChatPending(previous, 'b')
    expect(next.key?.map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('finds the id under whichever key actually holds it', () => {
    const previous = { keyA: [echo('a')], keyB: [echo('b')] }
    const next = dropMobileNativeChatPending(previous, 'b')
    expect(next.keyA?.map((item) => item.id)).toEqual(['a'])
    expect(next.keyB?.map((item) => item.id)).toEqual([])
  })

  it('returns the exact SAME object reference when the id is not found anywhere', () => {
    // Documented at the call site: "a cancelled queued entry must not leave
    // its bubble behind" — the flip side is that dropping an id no bubble
    // used must not manufacture a state change either.
    const previous = { key: [echo('a'), echo('b')] }
    expect(dropMobileNativeChatPending(previous, 'does-not-exist')).toBe(previous)
  })
})

let latestFromHook: MobileNativeChatPendingMessage[] = []
function StableEchoesProbe({ echoes }: { echoes: MobileNativeChatPendingMessage[] }) {
  latestFromHook = useStableEchoes(echoes)
  return null
}

describe('useStableEchoes: the 1 Hz screen poll must not thrash list identity', () => {
  it('hands back the SAME array across renders while the content is unchanged', () => {
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(StableEchoesProbe, { echoes: [echo('e1')] }))
    })
    const first = latestFromHook
    // A fresh array every call, same content — exactly what the echo hooks do
    // on every render per use-stable-echoes.ts's own comment.
    act(() => {
      renderer!.update(createElement(StableEchoesProbe, { echoes: [echo('e1')] }))
    })
    expect(latestFromHook).toBe(first)
    act(() => renderer?.unmount())
  })

  it('hands back a NEW array once the content actually changes', () => {
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(StableEchoesProbe, { echoes: [echo('e1')] }))
    })
    const first = latestFromHook
    act(() => {
      renderer!.update(createElement(StableEchoesProbe, { echoes: [echo('e1'), echo('e2')] }))
    })
    expect(latestFromHook).not.toBe(first)
    expect(latestFromHook.map((item) => item.id)).toEqual(['e1', 'e2'])
    act(() => renderer?.unmount())
  })
})
