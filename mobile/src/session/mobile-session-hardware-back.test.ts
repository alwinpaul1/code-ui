import { describe, expect, it } from 'vitest'
import { hardwareBackAction } from './mobile-session-hardware-back'

describe('hardware back inside a session', () => {
  it('returns a Claude tab from terminal mode to its chat view instead of leaving', () => {
    expect(
      hardwareBackAction({ activeTabId: 't1', chatEligible: true, chatVisible: false })
    ).toEqual({ kind: 'show-chat', tabId: 't1' })
  })

  it('leaves the session from the chat view, and from a tab with no chat view', () => {
    expect(
      hardwareBackAction({ activeTabId: 't1', chatEligible: true, chatVisible: true })
    ).toEqual({ kind: 'leave' })
    expect(
      hardwareBackAction({ activeTabId: 'shell', chatEligible: false, chatVisible: false })
    ).toEqual({ kind: 'leave' })
    expect(hardwareBackAction({ activeTabId: null, chatEligible: true, chatVisible: false })).toEqual({
      kind: 'leave'
    })
  })
})
