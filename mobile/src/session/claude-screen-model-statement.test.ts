import { describe, expect, it } from 'vitest'
import { readClaudeModelToast, readClaudeScreenModelStatement, readClaudeSpinnerEffort } from './claude-screen-model-statement'
import { FULLSCREEN_SPINNER_HOOK, FULLSCREEN_TOAST_SONNET, NARROW_TOAST_SONNET, QUOTED_IN_REPLY, WIDE_TOAST_OPUS, WIDE_TOAST_SONNET } from './fixtures/claude-model-toast-2.1.294'
import { NARROW_SPINNER_HIGH, NARROW_SPINNER_WRAPPED, WIDE_IDLE_AFTER_TURN, WIDE_SONNET_THINKING_NO_EFFORT, WIDE_SPINNER_HIGH_AFTER_PICK, WIDE_SPINNER_XHIGH, WIDE_THOUGHT_NO_EFFORT } from './fixtures/claude-spinner-effort-2.1.294'
import { APPROVAL_0158, IDLE_AFTER_TURN_0158, QUOTED_IN_ANSWER_0158, WORKING_0158, withoutBlankRows } from './fixtures/codex-composer-screens'

// Every screen here is a real Claude Code 2.1.294 capture (the fixture file says
// how it was taken). Orca's `terminal.read --screen` drops blank rows, so each
// screen is read both as tmux painted it and as Orca hands it over.
const bothWays = (lines: readonly string[]) => [lines, withoutBlankRows(lines)]

describe('the effort Claude Code 2.1.294 states on its working spinner', () => {
  it('reads the effort of a thinking turn, at desktop width, in the default and the fullscreen TUI', () => {
    for (const screen of bothWays(WIDE_SPINNER_XHIGH)) {
      expect(readClaudeSpinnerEffort(screen)).toEqual({ spinner: true, effort: 'xhigh' })
    }
    for (const screen of bothWays(FULLSCREEN_SPINNER_HOOK)) {
      expect(readClaudeSpinnerEffort(screen)).toEqual({ spinner: true, effort: 'xhigh' })
    }
  })

  it('follows a picker effort-slider switch on the next thinking turn', () => {
    for (const screen of bothWays(WIDE_SPINNER_HIGH_AFTER_PICK)) {
      expect(readClaudeSpinnerEffort(screen)).toEqual({ spinner: true, effort: 'high' })
    }
  })

  it('states no effort for a spinner between thinking phases, or for a model that thinks without one', () => {
    for (const screen of [...bothWays(WIDE_THOUGHT_NO_EFFORT), ...bothWays(WIDE_SONNET_THINKING_NO_EFFORT)]) {
      expect(readClaudeSpinnerEffort(screen)).toEqual({ spinner: true, effort: null })
    }
  })

  it('reads a phone-width spinner whose effort still fits on its row', () => {
    for (const screen of bothWays(NARROW_SPINNER_HIGH)) {
      expect(readClaudeSpinnerEffort(screen)).toEqual({ spinner: true, effort: 'high' })
    }
  })

  it('gives no effort when a phone-width spinner wraps its effort onto the next row', () => {
    for (const screen of bothWays(NARROW_SPINNER_WRAPPED)) {
      expect(readClaudeSpinnerEffort(screen).effort).toBeNull()
    }
  })

  it('does not read a spinner row quoted in a reply', () => {
    for (const screen of bothWays(QUOTED_IN_REPLY)) {
      expect(readClaudeSpinnerEffort(screen)).toEqual({ spinner: false, effort: null })
    }
  })

  it('reads no spinner once the turn has ended', () => {
    for (const screen of bothWays(WIDE_IDLE_AFTER_TURN)) {
      expect(readClaudeSpinnerEffort(screen)).toEqual({ spinner: false, effort: null })
    }
  })

  it('reads nothing from an empty screen or one with no input box', () => {
    expect(readClaudeSpinnerEffort([])).toEqual({ spinner: false, effort: null })
    expect(readClaudeSpinnerEffort([''])).toEqual({ spinner: false, effort: null })
    // The spinner row alone, cut from its screen: no box under it, so not read.
    expect(readClaudeSpinnerEffort(['· Inferring… (2s · ↓ 113 tokens · thinking with xhigh effort)'])).toEqual({
      spinner: false,
      effort: null
    })
  })
})

describe('the alt+p model toast of Claude Code 2.1.294', () => {
  it('reads the model a session-only switch set, in the default TUI at desktop and phone width and in fullscreen', () => {
    for (const screen of [...bothWays(WIDE_TOAST_SONNET), ...bothWays(NARROW_TOAST_SONNET), ...bothWays(FULLSCREEN_TOAST_SONNET)]) {
      expect(readClaudeModelToast(screen)).toEqual({ model: 'claude-sonnet-5-5', label: 'Sonnet 5.5' })
    }
    for (const screen of bothWays(WIDE_TOAST_OPUS)) {
      expect(readClaudeModelToast(screen)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5' })
    }
  })

  it('reads the "saved as your default" wording the same way', () => {
    // The wording is the user's live 2.1.294 row, laid on the captured footer at
    // the captured right edge (158 of 160 columns). Not captured here: pressing
    // Enter in the picker saves the user's global default.
    const toast = 'Model set to opus (claude-opus-5-5) and saved as your default for new sessions'
    const footer = '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'
    const screen = WIDE_TOAST_SONNET.map((row) =>
      row.includes('Model set to') ? footer + ' '.repeat(158 - footer.length - toast.length) + toast : row
    )
    expect(readClaudeModelToast(screen)).toEqual({ model: 'claude-opus-5-5', label: 'Opus 5.5' })
  })

  it('does not read a toast quoted in a reply', () => {
    for (const screen of bothWays(QUOTED_IN_REPLY)) {
      expect(readClaudeModelToast(screen)).toBeNull()
    }
  })

  it('does not read the toast wording on a footer row that is not flush with the right edge of the box', () => {
    // The captured row, one column short of the edge Claude pads it to.
    const shifted = WIDE_TOAST_SONNET.map((row) => (row.includes('Model set to') ? row.replace('  Model set to', ' Model set to') : row))
    expect(readClaudeModelToast(WIDE_TOAST_SONNET)).not.toBeNull()
    expect(readClaudeModelToast(shifted)).toBeNull()
  })

  it('reads no toast from an empty screen, or from screens with none', () => {
    expect(readClaudeModelToast([])).toBeNull()
    for (const screen of [WIDE_SPINNER_XHIGH, WIDE_IDLE_AFTER_TURN, NARROW_SPINNER_WRAPPED]) {
      expect(readClaudeModelToast(screen)).toBeNull()
    }
  })
})

describe('Codex screens', () => {
  it('state no spinner, effort or toast', () => {
    for (const screen of [IDLE_AFTER_TURN_0158, WORKING_0158, QUOTED_IN_ANSWER_0158, APPROVAL_0158]) {
      expect(readClaudeScreenModelStatement(screen)).toEqual({ composer: false, spinner: false, effort: null, toast: null })
    }
  })
})
