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
      mobileNativeChatFrameToShow({ blank: true, showNativeChat: true, hasHeldFrame: false, hasTerminalUnderneath: false, ptyTab: true })
    ).toBe('draw')
  })

  it('still bridges a real reload with the frame it drew before', () => {
    expect(
      mobileNativeChatFrameToShow({ blank: true, showNativeChat: true, hasHeldFrame: true, hasTerminalUnderneath: true, ptyTab: true })
    ).toBe('hold')
  })

  it('gives the screen to the terminal on a tab that is not chat', () => {
    expect(
      mobileNativeChatFrameToShow({
        blank: true,
        showNativeChat: false,
        hasHeldFrame: false,
        hasTerminalUnderneath: true,
        ptyTab: true
      })
    ).toBe('terminal')
  })

  it('still draws when there is no terminal under us to yield to', () => {
    // 0.5.69 fixed the chat-tab half and the screen was STILL black on an agent
    // tab (screen recording, 2026-09-14): an agent-session tab has no terminal
    // pane, so "yield to the terminal" rendered nothing at all.
    expect(
      mobileNativeChatFrameToShow({
        blank: true,
        showNativeChat: false,
        hasHeldFrame: false,
        hasTerminalUnderneath: false,
        // An agent-session tab, not a PTY tab.
        ptyTab: false
      })
    ).toBe('draw')
  })

  it('yields a terminal tab that is not a chat even before its pane has mounted', () => {
    // 0.9.131 (2026-10-13), an Antigravity tab: the "nothing to yield to"
    // rule drew an empty chat and its composer over a PTY tab whose pane had
    // not mounted, above the terminal's own input bar. A PTY tab always has
    // its terminal frame to yield to; the pane mounts into it.
    expect(
      mobileNativeChatFrameToShow({
        blank: true,
        showNativeChat: false,
        hasHeldFrame: false,
        hasTerminalUnderneath: false,
        ptyTab: true
      })
    ).toBe('terminal')
  })

  it('prefers a held frame over the terminal while a chat tab is switching away', () => {
    // The blink guard: a view-mode read that has not settled must not show the
    // terminal for a frame and remount the whole list.
    expect(
      mobileNativeChatFrameToShow({ blank: true, showNativeChat: false, hasHeldFrame: true, hasTerminalUnderneath: true, ptyTab: true })
    ).toBe('hold')
  })

  it('draws whenever the source has something to show', () => {
    for (const showNativeChat of [true, false]) {
      for (const hasHeldFrame of [true, false]) {
        expect(mobileNativeChatFrameToShow({ blank: false, showNativeChat, hasHeldFrame, hasTerminalUnderneath: true, ptyTab: true })).toBe(
          'draw'
        )
      }
    }
  })
})
