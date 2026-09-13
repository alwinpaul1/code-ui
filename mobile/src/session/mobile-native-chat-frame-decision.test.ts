import { describe, expect, it } from 'vitest'
import { mobileNativeChatFrameToShow } from './mobile-native-chat-frame-decision'

describe('what the chat overlay shows', () => {
  it('draws a brand-new agent tab instead of leaving the screen black', () => {
    // Reported from the phone on 0.5.68: tapping + and creating a Claude Code
    // agent gave a tab with nothing in it at all — no messages, no composer.
    // The tab is a chat tab whose transcript has not been written yet, so it
    // reads as "reloading empty" on every render, and there was no earlier
    // frame to replay.
    expect(
      mobileNativeChatFrameToShow({ blank: true, showNativeChat: true, hasHeldFrame: false })
    ).toBe('draw')
  })

  it('still bridges a real reload with the frame it drew before', () => {
    expect(
      mobileNativeChatFrameToShow({ blank: true, showNativeChat: true, hasHeldFrame: true })
    ).toBe('hold')
  })

  it('gives the screen to the terminal on a tab that is not chat', () => {
    expect(
      mobileNativeChatFrameToShow({ blank: true, showNativeChat: false, hasHeldFrame: false })
    ).toBe('terminal')
  })

  it('prefers a held frame over the terminal while a chat tab is switching away', () => {
    // The blink guard: a view-mode read that has not settled must not show the
    // terminal for a frame and remount the whole list.
    expect(
      mobileNativeChatFrameToShow({ blank: true, showNativeChat: false, hasHeldFrame: true })
    ).toBe('hold')
  })

  it('draws whenever the source has something to show', () => {
    for (const showNativeChat of [true, false]) {
      for (const hasHeldFrame of [true, false]) {
        expect(mobileNativeChatFrameToShow({ blank: false, showNativeChat, hasHeldFrame })).toBe(
          'draw'
        )
      }
    }
  })
})
