import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nativeChatListHeaderExtraData } from './mobile-native-chat-list-extra-data'

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
    expect(source).toContain('extraData={headerExtraData}')
    expect(source).toContain('useNativeChatListHeaderExtraData({')
  })

  it('builds that marker from the same values it gives the header', () => {
    const listBlock = source.slice(
      source.indexOf('<FlashList'),
      source.indexOf('ListFooterComponent')
    )
    const headerProps = listBlock.slice(listBlock.indexOf('<MobileNativeChatListHeader'))
    const markerBlock = source.slice(
      source.indexOf('useNativeChatListHeaderExtraData({'),
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
