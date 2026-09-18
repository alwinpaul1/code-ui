import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearStickyLiveHudForTests,
  useStickyLiveHud,
  type StickyLiveHud
} from './use-sticky-live-hud'

type Observation = {
  modelId: string | null
  effort: string | null
  context?: { usedPercent: number; usedLabel: string | null; windowLabel: string | null } | null
} | null

let latest: StickyLiveHud = { label: null,
      model: null, effort: null, context: null }
const S1 = '77954fea-1013-4225-b187-a8b3162a04ce'
const S2 = '8b19cb22-996c-40e5-a887-a5323a9845e1'
function Probe({
  observation,
  tabId,
  handle,
  sessionId
}: {
  observation: Observation
  tabId: string | null
  handle: string | null
  sessionId: string | null
}) {
  latest = useStickyLiveHud(observation, tabId, handle, sessionId)
  return null
}

describe('the model and effort the badge last stated', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => clearStickyLiveHudForTests())
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    observation: Observation,
    tabId: string | null = 'tab-1',
    handle: string | null = 'term_a',
    sessionId: string | null = S1
  ) {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { observation, tabId, handle, sessionId }))
      } else {
        renderer = create(createElement(Probe, { observation, tabId, handle, sessionId }))
      }
    })
    return latest
  }

  // 2026-09-18: the hold was keyed by tab and terminal, and both survive the
  // process changing underneath them. A phone-launched agent's last badge was
  // still held when a `claude` typed by hand into the same terminal took over
  // — same tab, same handle, a different session — and on a host with no
  // status line nothing ever came to replace it. The figures belong to one
  // SESSION of one process; a new session under the same handle starts empty.
  it('drops the figures when a different session takes over the same terminal', () => {
    const context = { usedPercent: 64, usedLabel: '650k', windowLabel: '1.0M' }
    render({ modelId: 'fable', effort: 'medium', context }, 'tab-1', 'term_a', S1)
    expect(render(null, 'tab-1', 'term_a', S2)).toEqual({
      label: null,
      model: null,
      effort: null,
      context: null
    })
  })

  it('keeps the figures while the session id is momentarily unknown, and when it comes back', () => {
    // `activeChatSessionId` dips to null while a tab resolves; that is "not
    // known yet", never "a different session".
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-1', 'term_a', S1)
    expect(render(null, 'tab-1', 'term_a', null)).toMatchObject({ model: 'opus', effort: 'xhigh' })
    expect(render(null, 'tab-1', 'term_a', S1)).toMatchObject({ model: 'opus', effort: 'xhigh' })
  })

  it('does not let the old session\'s figures come back once the new one has started', () => {
    render({ modelId: 'fable', effort: 'medium' }, 'tab-1', 'term_a', S1)
    render(null, 'tab-1', 'term_a', S2)
    // The id dips to null again on the NEW session: the last known is S2.
    expect(render(null, 'tab-1', 'term_a', null)).toEqual({
      label: null,
      model: null,
      effort: null,
      context: null
    })
  })

  // 2026-09-14, from the phone: the pill flipped between "Opus xhigh" (what
  // the badge said) and "Fable Medium" (the launch record) as screen reads
  // alternated between a real badge and nothing on a lagging session.
  it('keeps what the badge stated across an empty screen read', () => {
    expect(render({ modelId: 'opus', effort: 'xhigh' })).toMatchObject({
      model: 'opus',
      effort: 'xhigh'
    })
    // The next read comes back empty; the launch fallback must NOT win.
    expect(render(null)).toMatchObject({ model: 'opus', effort: 'xhigh' })
    expect(render({ modelId: null, effort: null })).toMatchObject({
      model: 'opus',
      effort: 'xhigh'
    })
  })

  it('follows a newer badge reading', () => {
    render({ modelId: 'fable', effort: 'medium' })
    expect(render({ modelId: 'opus', effort: 'xhigh' })).toMatchObject({
      model: 'opus',
      effort: 'xhigh'
    })
  })

  it('states nothing before the badge has been read', () => {
    expect(render(null)).toEqual({ label: null,
      model: null, effort: null, context: null })
  })

  it('does not carry one tab\'s badge onto another', () => {
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-1')
    expect(render(null, 'tab-2')).toEqual({ label: null,
      model: null, effort: null, context: null })
  })

  // 2026-09-15, still wrong on 0.5.98: model and effort were held SEPARATELY,
  // so an observation carrying an effort but no model — what the host's own
  // agent-status merge produces, and its effort is the launch-time one —
  // overwrote the effort while the model stayed. The pill then read a pair
  // that never existed, e.g. "Opus Medium" on a session running Opus xhigh.
  // Effort belongs to a model: only a reading that names a model may set it.
  it('does not let an effort with no model behind it change the pair', () => {
    render({ modelId: 'opus', effort: 'xhigh' })
    expect(render({ modelId: null, effort: 'medium' })).toMatchObject({
      model: 'opus',
      effort: 'xhigh'
    })
  })

  it('takes model and effort together from the reading that names the model', () => {
    render({ modelId: 'opus', effort: 'xhigh' })
    // A later reading names a model with no effort: the stale xhigh must not
    // survive onto it, because this reading is the authority on the pair.
    expect(render({ modelId: 'sonnet', effort: null })).toMatchObject({
      model: 'sonnet',
      effort: null
    })
  })

  // 2026-09-15: the figures are held per TAB, but the beacon they come from is
  // read per TERMINAL HANDLE (`useAgentHudBeacon(handleRef.current)`). When a
  // tab keeps its id and gets a new handle — a PTY restart, a reconnect, or
  // `use-mobile-session-close-actions.ts:86` moving the handle to a replacement
  // terminal without touching the tab id — the hold did not reset, and the new
  // handle has no beacon yet. So the pill kept stating the PREVIOUS agent's
  // model; on a hand-started replacement, which emits no beacon at all, it
  // stated it indefinitely. The handle is part of what these figures are about.
  it('drops the figures when the tab gets a new terminal', () => {
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-1', 'term_a')
    expect(render(null, 'tab-1', 'term_b')).toEqual({
      label: null,
      model: null,
      effort: null,
      context: null
    })
  })

  it('keeps the figures while the tab and its terminal both stand', () => {
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-1', 'term_a')
    expect(render(null, 'tab-1', 'term_a')).toMatchObject({
      model: 'opus',
      effort: 'xhigh'
    })
  })

  // 2026-09-15 from the phone: the pill "switches automatically when i send a
  // message and comes back randomly when the response ends". The hold lived in
  // a `useRef`, so it belonged to one component INSTANCE. Every chat/terminal
  // flip and route change threw it away, while the record and beacon caches
  // beside it — both module-level — survived. With the hold gone the pill fell
  // back to `agentStatus.model`, the model the tab was LAUNCHED as, and stated
  // Fable on a session running Opus. What the agent said about itself has to
  // outlive the view that happened to be mounted when it said it.
  it('still knows the model after the view is torn down and remounted', () => {
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-1', 'term_a')
    act(() => renderer?.unmount())
    renderer = null
    expect(render(null, 'tab-1', 'term_a')).toMatchObject({
      model: 'opus',
      effort: 'xhigh'
    })
  })

  // 2026-09-15 regression review: `activeHandle` is React state and can dip to
  // null on a tab whose id never changes — `use-mobile-session-tab-application`
  // nulls it whenever the active tab's `terminal` is not a string, which its own
  // type allows for a tab that is still resolving. Keying on a null handle threw
  // the whole hold away, MODEL AND CONTEXT RING, and the ring vanishing is
  // exactly what was reported and fixed in 0.5.99. A null handle is "not known
  // yet", not "a different terminal".
  it('holds on through a handle that is momentarily unknown', () => {
    const context = { usedPercent: 91, usedLabel: '914k', windowLabel: '1.0M' }
    render({ modelId: 'opus', effort: 'xhigh', context }, 'tab-1', 'term_a')
    expect(render(null, 'tab-1', null)).toMatchObject({
      model: 'opus',
      effort: 'xhigh',
      context
    })
    // And it is still there when the same terminal comes back.
    expect(render(null, 'tab-1', 'term_a')).toMatchObject({ model: 'opus', context })
  })

  // 2026-09-15 regression review: the cap shed by INSERTION order, so the entry
  // for a tab the user had open all session was the oldest key and the first
  // one thrown away — while dead handles, one per PTY restart or reconnect,
  // filled the 32 slots. Losing the entry drops the pill back to the launch
  // model, which is the whole bug this hold exists to prevent. The option-record
  // map beside it already documents the rule: delete-then-set on every read, so
  // eviction only sheds the oldest UNTOUCHED scope.
  it('keeps a tab that is still being read, however many others come and go', () => {
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-live', 'term_live')
    for (let i = 0; i < 40; i += 1) {
      render(null, `tab-${i}`, `term_${i}`)
      // The live tab is still being read between the others.
      render(null, 'tab-live', 'term_live')
    }
    expect(render(null, 'tab-live', 'term_live')).toMatchObject({
      model: 'opus',
      effort: 'xhigh'
    })
  })

  // 2026-09-15: the ring is read off the same badge, so an empty read blanked
  // it mid-conversation instead of keeping the figure the agent last stated.
  it('keeps the context figure across an empty screen read', () => {
    const context = { usedPercent: 91, usedLabel: '914k', windowLabel: '1.0M' }
    expect(render({ modelId: 'opus', effort: 'xhigh', context }).context).toEqual(context)
    expect(render(null).context).toEqual(context)
    expect(render({ modelId: 'opus', effort: 'xhigh', context: null }).context).toEqual(context)
    const next = { usedPercent: 93, usedLabel: '930k', windowLabel: '1.0M' }
    expect(render({ modelId: 'opus', effort: 'xhigh', context: next }).context).toEqual(next)
  })
})
