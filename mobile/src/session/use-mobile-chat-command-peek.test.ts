import { describe, expect, it } from 'vitest'
import { chatCommandOpensOverlay } from './mobile-chat-command-overlay'

describe('leaving chat for the terminal on a slash command', () => {
  it('stays in chat for a Claude command that acts in the transcript', () => {
    // Why: reported 2026-09-11 — /btw switched the tab to terminal mode, and
    // so did every other Claude command, with nothing there to watch.
    for (const command of ['/btw is this right', '/clear', '/compact', '/copy', '/goal ship it', '/fast']) {
      expect(chatCommandOpensOverlay('claude', command), command).toBe(false)
    }
  })

  it('shows the terminal for a Claude command that draws a TUI picker', () => {
    for (const command of ['/model', '/config', '/resume', '/permissions', '/MODEL sonnet']) {
      expect(chatCommandOpensOverlay('claude', command), command).toBe(true)
    }
  })

  it('keeps the Codex rule it always had', () => {
    expect(chatCommandOpensOverlay('codex', '/clear')).toBe(false)
    expect(chatCommandOpensOverlay('codex', '/model')).toBe(true)
  })

  it('shows the terminal for a command neither list knows', () => {
    expect(chatCommandOpensOverlay('claude', '/some-plugin-command')).toBe(true)
  })
})
