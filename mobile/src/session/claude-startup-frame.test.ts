import { describe, expect, it } from 'vitest'
import { readClaudeStartupFrame } from './claude-startup-frame'
import {
  AGENT_NAME_FRAME,
  FULLSCREEN_STATUS_FRAME,
  LOGO_FRAME,
  LOGO_FRAME_WITH_CONTEXT_NOTE,
  OLDER_LOGO_FRAME,
  SCROLLED_PAST,
  SECOND_RUN_FRAME,
  SPLIT_FRAME_CENTERED,
  SPLIT_FRAME_TOP
} from './fixtures/claude-startup-frame-2.1.290-modelled'

const OPUS_XHIGH = { model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' }
const HEADER = LOGO_FRAME[0]!

// Every screen here is MODELLED, none captured: see the fixture's header.
describe("a hand-typed Claude tab's startup frame states the model and effort it started with", () => {
  it('reads the model and effort off the frame as 2.1.290 lays it out', () => {
    expect(readClaudeStartupFrame(LOGO_FRAME)).toEqual(OPUS_XHIGH)
  })

  it('reads the same pair with the (1M context) note 2.1.290 still appends to a 1M id, or without it', () => {
    expect(readClaudeStartupFrame(LOGO_FRAME_WITH_CONTEXT_NOTE)).toEqual(OPUS_XHIGH)
  })

  it('reads the pair of a session started with --agent, where the third row names the agent and carries a "·"', () => {
    expect(readClaudeStartupFrame(AGENT_NAME_FRAME)).toEqual(OPUS_XHIGH)
  })

  it('reads the pair in fullscreen, where the third row ends in a status after a "·"', () => {
    expect(readClaudeStartupFrame(FULLSCREEN_STATUS_FRAME)).toEqual(OPUS_XHIGH)
  })

  it("reads an older build's mascot, which sits in the same nine columns", () => {
    expect(readClaudeStartupFrame(OLDER_LOGO_FRAME)).toEqual({ model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'medium' })
  })

  it('names "extra high" xhigh', () => {
    const rows = [HEADER, '▝▜██████▀  Opus 5.5 with extra high effort · Claude Max', LOGO_FRAME[2]!]
    expect(readClaudeStartupFrame(rows)).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('keeps the model of a row with no effort on it (a model that takes none)', () => {
    expect(readClaudeStartupFrame([HEADER, '▝▜██████▀  Haiku 4.5 · API Usage Billing', LOGO_FRAME[2]!])).toEqual({
      model: 'claude-haiku-4-5',
      label: 'Haiku 4.5',
      effort: null
    })
  })

  it('reads a phone-width frame whose billing wrapped onto its own row, with the mascot at the top of the four text rows', () => {
    expect(readClaudeStartupFrame(SPLIT_FRAME_TOP)).toEqual(OPUS_XHIGH)
  })

  it('reads the same frame with the mascot centred one row down (the 0.5 offset rounded up)', () => {
    expect(readClaudeStartupFrame(SPLIT_FRAME_CENTERED)).toEqual(OPUS_XHIGH)
  })
})

describe('a frame that is not on the screen, or cannot be read whole', () => {
  it('reads nothing from an empty buffer', () => {
    expect(readClaudeStartupFrame([])).toBeNull()
    expect(readClaudeStartupFrame(['', '   '])).toBeNull()
  })

  it('reads nothing from a one-line buffer that is only the header', () => {
    expect(readClaudeStartupFrame([HEADER])).toBeNull()
  })

  it('reads nothing from a one-line buffer that holds the header and the model row joined, which has no columns to check', () => {
    expect(readClaudeStartupFrame(['Claude Codev2.1.290Opus 5 with high effort · Claude Max'])).toBeNull()
  })

  it('reads nothing from a conversation that has scrolled past the frame', () => {
    expect(readClaudeStartupFrame(SCROLLED_PAST)).toBeNull()
  })
})

describe('a frame QUOTED or CAPTURED in the conversation is not the session\'s own', () => {
  // The reviewer's P1: an assistant reply whose continuation rows are indented, with no ⏺ on them.
  it('does not read a frame an assistant reply quotes, on indented continuation rows', () => {
    const screen = [
      ...LOGO_FRAME.slice(0, 3),
      '',
      '⏺ The new tab painted this frame:',
      '',
      '  Claude Code v2.1.290',
      '  Sonnet 5 with low effort · Claude Pro',
      '',
      '  so the effort parser should read low.',
      '',
      '❯ '
    ]
    expect(readClaudeStartupFrame(screen)).toEqual(OPUS_XHIGH)
    expect(readClaudeStartupFrame(screen.slice(3))).toBeNull()
  })

  // The reviewer's P2: `tmux capture-pane` of a nested claude, in a Bash result block.
  it('does not read a nested claude captured by tmux in a Bash tool result', () => {
    const screen = [
      '⏺ Bash(tmux capture-pane -p -t probe)',
      '  ⎿  ',
      '      ▐▛███▜▌   Claude Code v2.1.290',
      '     ▝▜█████▛▘  Fable 5.1 with low effort · Claude Pro',
      '       ▘▘ ▝▝    ~/scratch',
      '     … +12 lines (ctrl+o to expand)',
      '',
      '❯ '
    ]
    expect(readClaudeStartupFrame(screen)).toBeNull()
  })

  it('does not read a frame that sits at column 0 under a ⏺ or ⎿ block with no prompt between (a pasted capture)', () => {
    const screen = ['⏺ Bash(cat banner.txt)', '  ⎿  (output)', ...SECOND_RUN_FRAME, '', '❯ ']
    expect(readClaudeStartupFrame(screen)).toBeNull()
  })

  it('does read a column-0 frame once a prompt closes the conversation above it (the second claude of a terminal)', () => {
    const screen = [...SCROLLED_PAST, '$ claude --model sonnet --effort low', ...SECOND_RUN_FRAME]
    expect(readClaudeStartupFrame(screen)).toMatchObject({ model: 'claude-sonnet-5', effort: 'low' })
  })

  // The reviewer's P5: a copy indented by 1 or 2 columns passed because the text was trimmed, and when a long
  // reply's ⏺ has scrolled off the top nothing above it says it is a block.
  it('does not read a frame quoted two columns in, in a reply whose ⏺ has scrolled off', () => {
    const screen = [
      '  that the parser now requires. The fixture reads:',
      '',
      '   ▐▛███▛█   Claude Code v2.1.290',
      '  ▝▜██████▀  Sonnet 5 with low effort · Claude Max',
      '   ▝▝   ▝▝   ~/projects/example-app',
      '',
      '  which is the shape 2.1.290 paints.',
      '',
      '────────────────────────────────',
      '❯ ',
      '────────────────────────────────'
    ]
    expect(readClaudeStartupFrame(screen)).toBeNull()
  })

  it('does not read the same quote indented one column', () => {
    expect(
      readClaudeStartupFrame(['  text', '  ▐▛███▛█   Claude Code v2.1.290', ' ▝▜██████▀  Sonnet 5 with low effort · Claude Max', '  ▝▝   ▝▝   ~/x'])
    ).toBeNull()
  })

  it('does not read a frame whose model row does not start with art in column 0 or 1', () => {
    expect(readClaudeStartupFrame([HEADER, '   ▝▜██████▀Sonnet 5 with low effort · Claude Max', LOGO_FRAME[2]!])).toBeNull()
  })

  it('does not take a header quoted behind a ⏺ for the frame', () => {
    expect(readClaudeStartupFrame(['⏺ The banner reads "Claude Code v2.1.290":', '  Opus 5 with max effort · Claude Max', '  ~/p'])).toBeNull()
  })

  it('does not read a header whose mascot columns are not the three art rows (text where the art should be)', () => {
    expect(readClaudeStartupFrame(['Claude Code v2.1.290', 'Opus 5 with max effort · Claude Max', '~/p'])).toBeNull()
    expect(readClaudeStartupFrame([HEADER, '           Opus 5 with max effort · Claude Max', '           ~/p'])).toBeNull()
  })

  it('does not read the Apple Terminal fallback mascot, whose text column this has not verified', () => {
    expect(
      readClaudeStartupFrame(['   ▗   ▖  Claude Code v2.1.290', '  ▗▖▖▖▗▖  Opus 5 with high effort · Claude Max', '  ▘▘   ▝▝  ~/p'])
    ).toBeNull()
  })
})

describe('a pane too narrow for the whole row', () => {
  it('keeps the model and refuses the effort when "effort" is cut to an ellipsis', () => {
    expect(readClaudeStartupFrame([HEADER, '▝▜██████▀  Opus 5 with high… · Claude Max', LOGO_FRAME[2]!])).toEqual({
      model: 'claude-opus-5',
      label: 'Opus 5',
      effort: null
    })
  })

  it('keeps the model and refuses the effort when the level itself is cut', () => {
    expect(readClaudeStartupFrame([HEADER, '▝▜██████▀  Opus 5 with xhi…', LOGO_FRAME[2]!])).toMatchObject({
      model: 'claude-opus-5',
      effort: null
    })
  })

  it('keeps the model when the (1M context) note is cut mid-word', () => {
    expect(readClaudeStartupFrame([HEADER, '▝▜██████▀  Opus 5 (1M cont…', LOGO_FRAME[2]!])).toMatchObject({
      model: 'claude-opus-5',
      effort: null
    })
  })
})

describe('a model this does not know', () => {
  it('refuses a family it has no name for, effort and all', () => {
    expect(readClaudeStartupFrame([HEADER, '▝▜██████▀  Gizmo 9 with high effort · Claude Max', LOGO_FRAME[2]!])).toBeNull()
  })

  it('refuses a known family with no version it can map', () => {
    expect(readClaudeStartupFrame([HEADER, '▝▜██████▀  Opus with high effort · Claude Max', LOGO_FRAME[2]!])).toBeNull()
  })

  it('refuses a custom model id behind a proxy', () => {
    expect(readClaudeStartupFrame([HEADER, '▝▜██████▀  company/my-opus-5 · API Usage Billing', LOGO_FRAME[2]!])).toBeNull()
  })
})

describe('a Windows-style redraw of the frame', () => {
  it('reads CRLF rows with trailing blanks, and the frame painted twice', () => {
    const redraw = [...LOGO_FRAME, ...LOGO_FRAME].map((row) => `${row}   \r`)
    expect(readClaudeStartupFrame(redraw)).toEqual(OPUS_XHIGH)
  })

  it('reads rows still carrying SGR and OSC escapes, which take no column', () => {
    const painted = LOGO_FRAME.map((row) => `\u001b[38;5;174m${row}\u001b[39m\u001b]0;claude\u0007`)
    expect(readClaudeStartupFrame(painted)).toEqual(OPUS_XHIGH)
  })
})

describe('more than one frame on the screen', () => {
  it('reads the newest, which a second claude in the same terminal paints under the first', () => {
    const rows = [...LOGO_FRAME, ...SCROLLED_PAST, '$ claude --model sonnet --effort low', ...SECOND_RUN_FRAME]
    expect(readClaudeStartupFrame(rows)).toMatchObject({ model: 'claude-sonnet-5', effort: 'low' })
  })

  it('reads nothing when the newest cannot be read, rather than the older one it replaced', () => {
    const newestUnreadable = [...LOGO_FRAME, ...SCROLLED_PAST, HEADER, '▝▜██████▀  Gizmo 9 · Plan', LOGO_FRAME[2]!]
    expect(readClaudeStartupFrame(newestUnreadable)).toBeNull()
  })
})
