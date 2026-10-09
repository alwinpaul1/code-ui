import { describe, expect, it, vi } from 'vitest'
import {
  liveNativeChatDrafts,
  registerLiveNativeChatDrafts,
  type MobileNativeChatLiveDrafts
} from './mobile-native-chat-live-drafts'

const screen = (): MobileNativeChatLiveDrafts => ({
  setDrafts: vi.fn(),
  setPendingBySession: vi.fn(),
  setPendingWaitingForSession: vi.fn()
})

describe("a send's draft writes go to the chat screen showing its scope now", () => {
  it("writes into the sender's own screen when no screen shows the scope", () => {
    const own = screen()
    expect(liveNativeChatDrafts('h\0w\0nobody', own)).toBe(own)
  })

  it('writes into the screen mounted since the tap, not the one that went away', () => {
    const old = screen()
    const unregisterOld = registerLiveNativeChatDrafts('h\0w\0tab-remount', old)
    unregisterOld()
    const next = screen()
    const unregisterNext = registerLiveNativeChatDrafts('h\0w\0tab-remount', next)

    expect(liveNativeChatDrafts('h\0w\0tab-remount', old)).toBe(next)
    unregisterNext()
  })

  it("keeps the newer screen when the older one's unmount runs after it mounted", () => {
    const old = screen()
    const unregisterOld = registerLiveNativeChatDrafts('h\0w\0tab-overlap', old)
    const next = screen()
    const unregisterNext = registerLiveNativeChatDrafts('h\0w\0tab-overlap', next)
    unregisterOld()

    expect(liveNativeChatDrafts('h\0w\0tab-overlap', old)).toBe(next)
    unregisterNext()
    expect(liveNativeChatDrafts('h\0w\0tab-overlap', old)).toBe(old)
  })

  it('keeps each scope to its own screen', () => {
    const a = screen()
    const b = screen()
    const unregisterA = registerLiveNativeChatDrafts('h\0w\0tab-a', a)
    const unregisterB = registerLiveNativeChatDrafts('h\0w\0tab-b', b)

    expect(liveNativeChatDrafts('h\0w\0tab-a', b)).toBe(a)
    expect(liveNativeChatDrafts('h\0w\0tab-b', a)).toBe(b)
    unregisterA()
    unregisterB()
  })

  // Opus review of 4103c597b: the history panel pushes a second session screen over the first,
  // so two screens show one tab, and going back leaves the first one on view.
  it('goes back to the screen underneath when a second screen for the same tab goes away', () => {
    const under = screen()
    const unregisterUnder = registerLiveNativeChatDrafts('h\0w\0tab-stacked', under)
    const over = screen()
    const unregisterOver = registerLiveNativeChatDrafts('h\0w\0tab-stacked', over)
    expect(liveNativeChatDrafts('h\0w\0tab-stacked', screen())).toBe(over)

    unregisterOver()

    expect(liveNativeChatDrafts('h\0w\0tab-stacked', screen())).toBe(under)
    unregisterUnder()
  })
})
