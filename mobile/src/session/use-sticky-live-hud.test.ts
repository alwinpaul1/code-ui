import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { useStickyLiveHud, type StickyLiveHud } from './use-sticky-live-hud'

type Observation = {
  modelId: string | null
  effort: string | null
  context?: { usedPercent: number; usedLabel: string | null; windowLabel: string | null } | null
} | null

let latest: StickyLiveHud = { model: null, effort: null, context: null }
function Probe({
  observation,
  tabId,
  handle
}: {
  observation: Observation
  tabId: string | null
  handle: string | null
}) {
  latest = useStickyLiveHud(observation, tabId, handle)
  return null
}

describe('the model and effort the badge last stated', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    observation: Observation,
    tabId: string | null = 'tab-1',
    handle: string | null = 'term_a'
  ) {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { observation, tabId, handle }))
      } else {
        renderer = create(createElement(Probe, { observation, tabId, handle }))
      }
    })
    return latest
  }

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
    expect(render(null)).toEqual({ model: null, effort: null, context: null })
  })

  it('does not carry one tab\'s badge onto another', () => {
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-1')
    expect(render(null, 'tab-2')).toEqual({ model: null, effort: null, context: null })
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
