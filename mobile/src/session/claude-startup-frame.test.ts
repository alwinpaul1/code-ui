import { describe, expect, it } from 'vitest'
import { readClaudeStartupFrame } from './claude-startup-frame'
import { BOXED_FRAME, LOGO_FRAME, LOGO_FRAME_WITH_CONTEXT_NOTE, SCROLLED_PAST } from './fixtures/claude-startup-frame-2.1.290-modelled'

// Every screen here is MODELLED, none captured: see the fixture's header.
describe("a hand-typed Claude tab's startup frame states the model and effort it started with", () => {
  it('reads the model and effort off the unframed logo', () => {
    expect(readClaudeStartupFrame(LOGO_FRAME)).toEqual({ model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' })
  })

  it('reads the same pair whether or not the row carries a (1M context) note, which 2.1.290 dropped from the Opus row', () => {
    expect(readClaudeStartupFrame(LOGO_FRAME_WITH_CONTEXT_NOTE)).toEqual(readClaudeStartupFrame(LOGO_FRAME))
  })

  it('reads the model row of a framed box, never the release-notes panel beside it', () => {
    expect(readClaudeStartupFrame(BOXED_FRAME)).toEqual({ model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'medium' })
  })

  it('names "extra high" xhigh', () => {
    const rows = ['▝▜█████▛▘  Opus 5.5 with extra high effort · Claude Max'].map((row) => row)
    expect(readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', ...rows])).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('keeps the model of a row with no effort on it (a model that takes none)', () => {
    expect(
      readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  Haiku 4.5 · API Usage Billing', '  ▘▘ ▝▝    ~/p'])
    ).toEqual({ model: 'claude-haiku-4-5', label: 'Haiku 4.5', effort: null })
  })
})

describe('a frame that is not on the screen, or cannot be read whole', () => {
  it('reads nothing from an empty buffer', () => {
    expect(readClaudeStartupFrame([])).toBeNull()
    expect(readClaudeStartupFrame(['', '   '])).toBeNull()
  })

  it('reads nothing from a one-line buffer that is only the header', () => {
    expect(readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290'])).toBeNull()
  })

  it('reads a one-line buffer that holds the header and the model row joined (a cursor move dropped the gap)', () => {
    expect(readClaudeStartupFrame(['Claude Codev2.1.290Opus 5 with high effort · Claude Max'])).toEqual({
      model: 'claude-opus-5',
      label: 'Opus 5',
      effort: 'high'
    })
  })

  it('reads nothing from a conversation that has scrolled past the frame', () => {
    expect(readClaudeStartupFrame(SCROLLED_PAST)).toBeNull()
  })

  it('does not take a header quoted in the conversation for the frame', () => {
    expect(
      readClaudeStartupFrame(['⏺ The banner reads "Claude Code v2.1.290":', '  Opus 5 with max effort · Claude Max', '  ~/p'])
    ).toBeNull()
  })
})

describe('a pane too narrow for the whole row', () => {
  it('keeps the model and refuses the effort when "effort" is cut to an ellipsis', () => {
    expect(readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  Opus 5 with high… · Claude Max'])).toEqual({
      model: 'claude-opus-5',
      label: 'Opus 5',
      effort: null
    })
  })

  it('keeps the model and refuses the effort when the level itself is cut', () => {
    expect(readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  Opus 5 with xhi…'])).toEqual({
      model: 'claude-opus-5',
      label: 'Opus 5',
      effort: null
    })
  })

  it('keeps the model when the (1M context) note is cut mid-word', () => {
    expect(readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  Opus 5 (1M cont…'])).toMatchObject({
      model: 'claude-opus-5',
      effort: null
    })
  })
})

describe('a model this does not know', () => {
  it('refuses a family it has no name for, effort and all', () => {
    expect(
      readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  Gizmo 9 with high effort · Claude Max'])
    ).toBeNull()
  })

  it('refuses a known family with no version it can map', () => {
    expect(readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  Opus with high effort · Claude Max'])).toBeNull()
  })

  it('refuses a custom model id behind a proxy', () => {
    expect(
      readClaudeStartupFrame([' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  company/my-opus-5 · API Usage Billing'])
    ).toBeNull()
  })
})

describe('a Windows-style redraw of the frame', () => {
  it('reads CRLF rows with trailing blanks, and the frame painted twice', () => {
    const redraw = [...LOGO_FRAME, ...LOGO_FRAME].map((row) => `${row}   \r`)
    expect(readClaudeStartupFrame(redraw)).toEqual({ model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' })
  })

  it('reads rows still carrying SGR and OSC escapes (an oldest-first stream read keeps them)', () => {
    const painted = LOGO_FRAME.map((row) => `\u001b[38;5;174m${row}\u001b[39m\u001b]0;claude\u0007`)
    expect(readClaudeStartupFrame(painted)).toEqual({ model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' })
  })
})

describe('more than one frame in the buffer', () => {
  it('reads the newest, which a resume paints under the old one', () => {
    const resumed = [...LOGO_FRAME, ...SCROLLED_PAST, ...BOXED_FRAME]
    expect(readClaudeStartupFrame(resumed)).toMatchObject({ model: 'claude-sonnet-5', effort: 'medium' })
  })

  it('reads nothing when the newest cannot be read, rather than the older one it replaced', () => {
    const newestUnreadable = [...LOGO_FRAME, ' ▐▛███▜▌   Claude Code v2.1.290', '▝▜█████▛▘  Gizmo 9 · Plan']
    expect(readClaudeStartupFrame(newestUnreadable)).toBeNull()
  })
})
