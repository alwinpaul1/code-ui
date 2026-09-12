import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  chatListDrawDistanceDp,
  nativeChatListHeaderExtraData,
  useChatListContentPosition
} from './mobile-native-chat-list-extra-data'

const BASE = {
  agentStatus: { state: 'working' },
  backgroundTaskReport: { finishedTaskIds: [], runningTaskIds: ['sec4-opus'] },
  hostBackgroundTasks: null,
  queuedMessages: [],
  unanchoredTurnStatus: null,
  turnActivity: null
}

describe('what the chat list header depends on outside its data', () => {
  it('changes when the agent reports a different set of running tasks', () => {
    // The symptom this exists for: two agent tasks running, the sheet listing
    // both, and the row under the last message still saying one.
    const before = nativeChatListHeaderExtraData(BASE)
    const after = nativeChatListHeaderExtraData({
      ...BASE,
      backgroundTaskReport: { finishedTaskIds: [], runningTaskIds: ['sec4-opus', 'sec4-sonnet'] }
    })

    expect(after).not.toEqual(before)
  })

  it('changes when the host roster changes', () => {
    expect(
      nativeChatListHeaderExtraData({ ...BASE, hostBackgroundTasks: { tasks: [{ id: 'a' }] } })
    ).not.toEqual(nativeChatListHeaderExtraData(BASE))
  })

  it('covers every header input that is not a message', () => {
    // Each of these drives something the header draws; a new one added to the
    // header without being added here goes stale exactly the same way.
    for (const key of [
      'agentStatus',
      'backgroundTaskReport',
      'hostBackgroundTasks',
      'queuedMessages',
      'unanchoredTurnStatus',
      'turnActivity'
    ] as const) {
      expect(
        nativeChatListHeaderExtraData({ ...BASE, [key]: { changed: key } })
      ).not.toEqual(nativeChatListHeaderExtraData(BASE))
    }
  })

  it('stays equal when nothing the header draws has changed', () => {
    expect(nativeChatListHeaderExtraData(BASE)).toEqual(nativeChatListHeaderExtraData({ ...BASE }))
  })
})

// FlashList's own typings: "A marker property for telling the list to
// re-render (since it implements PureComponent). If any of your renderItem,
// Header, Footer, etc. functions depend on anything outside of the `data`
// prop, stick it here." `data` is only the messages, so without this the
// header froze and the running-tasks row went stale.
describe('the chat list declares what its header depends on', () => {
  const source = readFileSync(join(import.meta.dirname, 'MobileNativeChatView.tsx'), 'utf8')

  it('hands FlashList the marker', () => {
    // The dock's height rides along: the spacer at the list's end lives in the header.
    expect(source).toContain('extraData={listExtraData}')
    expect(source).toContain('[headerExtraData, dockHeight]')
    expect(source).toContain('useChatListRenderStability({')
  })

  it('builds that marker from the same values it gives the header', () => {
    const listBlock = source.slice(
      source.indexOf('<FlashList'),
      source.indexOf('ListFooterComponent')
    )
    const headerProps = listBlock.slice(listBlock.indexOf('<MobileNativeChatListHeader'))
    const markerBlock = source.slice(
      source.indexOf('useChatListRenderStability({'),
      source.indexOf('const renderItem')
    )

    // Everything the header reads that is not `messages` has to be in the
    // marker, or that one prop silently stops repainting the row.
    for (const prop of [
      'agentStatus',
      'backgroundTaskReport',
      'hostBackgroundTasks',
      'queuedMessages',
      'turnActivity'
    ]) {
      expect(headerProps).toContain(prop)
      expect(markerBlock).toContain(prop)
    }
  })
})

// maintainVisibleContentPosition is a native scroll-anchoring config. Handing
// the list a new object re-sends it to the native scroll view, and with the
// keyboard up the chat re-renders on every keystroke and streamed frame — so
// an inline literal reconfigured anchoring under an active scroll.
describe('the list scroll-anchoring config', () => {
  function mount(initial: boolean) {
    const seen: { disabled: boolean }[] = []
    function Probe({ jump }: { jump: boolean }) {
      seen.push(useChatListContentPosition(jump))
      return null
    }
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(Probe, { jump: initial }))
    })
    return {
      seen,
      render(jump: boolean) {
        act(() => {
          renderer.update(createElement(Probe, { jump }))
        })
      }
    }
  }

  it('hands back the very same object while the flag holds', () => {
    const probe = mount(false)

    probe.render(false)
    probe.render(false)

    expect(probe.seen).toHaveLength(3)
    expect(probe.seen[1]).toBe(probe.seen[0])
    expect(probe.seen[2]).toBe(probe.seen[0])
  })

  it('changes only when the flag actually flips', () => {
    const probe = mount(false)

    probe.render(true)

    expect(probe.seen[1]).not.toBe(probe.seen[0])
    expect(probe.seen[0]).toEqual({ disabled: true })
    expect(probe.seen[1]).toEqual({ disabled: false })
  })

  it('is not written back as an inline literal on the list', () => {
    const source = readFileSync(join(import.meta.dirname, 'MobileNativeChatView.tsx'), 'utf8')

    expect(source).toContain('maintainVisibleContentPosition={contentPosition}')
    expect(source).not.toContain('maintainVisibleContentPosition={{')
  })
})

// Measured on a 120 Hz S23 with the keyboard up: native frames stayed clean
// (<1% janky) while the scroll still felt laggy — the signature of content
// arriving late, not of dropped frames. FlashList prepares 250dp past the
// window by default, under a third of a phone screen, and recycling is off
// here so every newly exposed message is a fresh mount.
describe('how far ahead the chat list prepares messages', () => {
  it('keeps a screen of runway on a phone', () => {
    // Galaxy S23: 2316px at density 2.8125.
    expect(chatListDrawDistanceDp(2316 / 2.8125)).toBe(823)
  })

  it('scales with the device rather than pinning one phone size', () => {
    const small = chatListDrawDistanceDp(640)
    const large = chatListDrawDistanceDp(900)

    expect(large).toBeGreaterThan(small)
  })

  it('never prepares less than FlashList would on its own', () => {
    // A short window — a small phone, a split screen, a foldable cover display.
    expect(chatListDrawDistanceDp(180)).toBe(250)
    expect(chatListDrawDistanceDp(0)).toBe(250)
  })

  it('does not mount half a conversation ahead on a tablet', () => {
    expect(chatListDrawDistanceDp(4000)).toBe(1200)
  })

  it('is measured against the window, so the keyboard cannot cut the runway', () => {
    // The keyboard shrinks the visible list but not how far a flick travels.
    // Sizing off the visible area would shorten the runway exactly when the
    // reported jitter appears.
    const source = readFileSync(join(import.meta.dirname, 'MobileNativeChatView.tsx'), 'utf8')

    expect(source).toContain('chatListDrawDistanceDp(useWindowDimensions().height)')
    expect(source).not.toContain('chatListDrawDistanceDp(keyboardInset')
  })
})
