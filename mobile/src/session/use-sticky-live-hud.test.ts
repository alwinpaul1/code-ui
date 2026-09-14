import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { useStickyLiveHud, type StickyLiveHud } from './use-sticky-live-hud'

type Observation = { modelId: string | null; effort: string | null } | null

let latest: StickyLiveHud = { model: null, effort: null }
function Probe({ observation, tabId }: { observation: Observation; tabId: string | null }) {
  latest = useStickyLiveHud(observation, tabId)
  return null
}

describe('the model and effort the badge last stated', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(observation: Observation, tabId: string | null = 'tab-1') {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { observation, tabId }))
      } else {
        renderer = create(createElement(Probe, { observation, tabId }))
      }
    })
    return latest
  }

  // 2026-09-14, from the phone: the pill flipped between "Opus xhigh" (what
  // the badge said) and "Fable Medium" (the launch record) as screen reads
  // alternated between a real badge and nothing on a lagging session.
  it('keeps what the badge stated across an empty screen read', () => {
    expect(render({ modelId: 'opus', effort: 'xhigh' })).toEqual({ model: 'opus', effort: 'xhigh' })
    // The next read comes back empty; the launch fallback must NOT win.
    expect(render(null)).toEqual({ model: 'opus', effort: 'xhigh' })
    expect(render({ modelId: null, effort: null })).toEqual({ model: 'opus', effort: 'xhigh' })
  })

  it('follows a newer badge reading', () => {
    render({ modelId: 'fable', effort: 'medium' })
    expect(render({ modelId: 'opus', effort: 'xhigh' })).toEqual({ model: 'opus', effort: 'xhigh' })
  })

  it('states nothing before the badge has been read', () => {
    expect(render(null)).toEqual({ model: null, effort: null })
  })

  it('does not carry one tab\'s badge onto another', () => {
    render({ modelId: 'opus', effort: 'xhigh' }, 'tab-1')
    expect(render(null, 'tab-2')).toEqual({ model: null, effort: null })
  })
})
